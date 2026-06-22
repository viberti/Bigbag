// Carrega a lista CMED/ANVISA (preços-teto de TODO medicamento registado no Brasil)
// para a tabela `medicamento` (identidade por EAN + PF/PMC). Fonte autoritativa e
// pública — o "registo-jackpot" dos remédios. Idempotente (UPSERT); re-correr com a
// lista do mês seguinte atualiza preços e apanha novos registos.
//
// Uso (no SERVIDOR):
//   sudo -u dev node --env-file=.env scripts/carregar_cmed.mjs            # descobre o xlsx mais recente
//   sudo -u dev node --env-file=.env scripts/carregar_cmed.mjs <url|path> # força um ficheiro
//
// Precisa do pacote `xlsx`: (cd backend && npm i xlsx)
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { getPool, closePool } from '../src/db.js';
import { parseApresentacao, ehGenerico } from '../src/normaliza/medicamento.js';

const PAGINA = 'https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/cmed/precos';
const UA = 'Mozilla/5.0 (compatible; BigBag-cmed/1.0)';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const digits = (v) => String(v == null ? '' : v).replace(/\D/g, '');
// número PT-BR ("1.234,56" → 1234.56); aceita já-número.
const numBR = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[^\d.,-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); // vírgula decimal
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const eanOk = (e) => { const d = digits(e); return d.length >= 12 && d.length <= 14 && !/^0+$/.test(d) ? d : null; };

async function descobrirUrl() {
  const html = await (await fetch(PAGINA, { headers: { 'user-agent': UA } })).text();
  const achados = [...html.matchAll(/arquivos\/(xls_conformidade_site_\d+[^"'\/\\]*\.xlsx)/g)].map((m) => m[1]);
  if (!achados.length) throw new Error('não encontrei o link xls_conformidade_site na página da CMED');
  achados.sort(); // o nome embute a data (…_YYYYMMDD_…) → o último é o mais recente
  const f = achados[achados.length - 1];
  return `${PAGINA}/arquivos/${f}/@@download/file`;
}

function versaoDe(s) {
  const m = String(s).match(/(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

async function obterBuffer(arg) {
  if (arg && !/^https?:\/\//i.test(arg)) return { buf: readFileSync(arg), versao: versaoDe(arg) };
  const url = arg || (await descobrirUrl());
  console.log('[cmed] a baixar', url);
  const r = await fetch(url, { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error('download HTTP ' + r.status);
  return { buf: Buffer.from(await r.arrayBuffer()), versao: versaoDe(url) };
}

function lerPlanilha(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  // a CMED tem várias linhas de título/legenda antes do cabeçalho real — procura-o.
  let hi = -1;
  for (let i = 0; i < Math.min(rows.length, 100); i++) {
    const cells = (rows[i] || []).map(norm);
    if (cells.includes('SUBSTANCIA') && cells.some((c) => c.startsWith('APRESENTAC'))) { hi = i; break; }
  }
  if (hi < 0) throw new Error('cabeçalho CMED não encontrado (procurei SUBSTÂNCIA + APRESENTAÇÃO)');
  const H = (rows[hi] || []).map(norm);
  const idx = (pred) => H.findIndex(pred);
  const col = {
    substancia: idx((h) => h === 'SUBSTANCIA'),
    lab: idx((h) => h.startsWith('LABORATORIO')),
    ggrem: idx((h) => h.includes('GGREM')),
    registro: idx((h) => h === 'REGISTRO'),
    produto: idx((h) => h === 'PRODUTO'),
    apres: idx((h) => h.startsWith('APRESENTAC')),
    classe: idx((h) => h.includes('CLASSE TERAP')),
    tipo: idx((h) => h.includes('TIPO DE PRODUTO')),
    tarja: idx((h) => h === 'TARJA'),
    restr: idx((h) => h.includes('RESTRICAO HOSPITALAR')),
    comerc: idx((h) => h.includes('COMERCIALIZ')),
    pfSemImp: idx((h) => h.includes('PF SEM IMPOSTO')),
  };
  const eanCols = H.map((h, i) => ({ h, i })).filter((x) => /^EAN ?\d?$/.test(x.h)).map((x) => x.i);
  const pmcCols = H.map((h, i) => { const m = h.match(/^PMC (\d+(?:[.,]\d+)?)\s*%?$/); return m ? { ali: m[1].replace(',', '.'), i } : null; }).filter(Boolean);
  const pfCols = H.map((h, i) => { const m = h.match(/^PF (\d+(?:[.,]\d+)?)\s*%?$/); return m ? { ali: m[1].replace(',', '.'), i } : null; }).filter(Boolean);
  if (col.substancia < 0 || col.apres < 0 || !eanCols.length) throw new Error('colunas essenciais em falta (substância/apresentação/EAN)');
  console.log(`[cmed] cabeçalho na linha ${hi}; EANs em ${eanCols.length} colunas; PMC por ${pmcCols.length} alíquotas.`);
  return { dados: rows.slice(hi + 1), col, eanCols, pmcCols, pfCols };
}

async function main() {
  const arg = process.argv[2];
  const { buf, versao } = await obterBuffer(arg);
  const { dados, col, eanCols, pmcCols, pfCols } = lerPlanilha(buf);

  const pool = getPool();
  const cell = (r, i) => (i >= 0 ? r[i] : null);
  const simNao = (v) => { const n = norm(v); return n.startsWith('SIM') ? 1 : n.startsWith('NAO') ? 0 : null; };

  const vals = [];
  let linhas = 0, semEan = 0, eans = 0;
  for (const r of dados) {
    if (!r || r.every((c) => c == null || c === '')) continue;
    const substancia = String(cell(r, col.substancia) ?? '').slice(0, 300) || null;
    const apres = String(cell(r, col.apres) ?? '').slice(0, 600) || null;
    if (!substancia && !apres) continue;
    linhas++;
    const p = parseApresentacao(apres);
    const tipo = String(cell(r, col.tipo) ?? '').slice(0, 40) || null;
    const pmc_por_icms = {}; for (const c of pmcCols) { const v = numBR(cell(r, c.i)); if (v != null) pmc_por_icms[c.ali] = v; }
    const pf_por_icms = {}; for (const c of pfCols) { const v = numBR(cell(r, c.i)); if (v != null) pf_por_icms[c.ali] = v; }
    const base = {
      registro: String(cell(r, col.registro) ?? '').slice(0, 20) || null,
      ggrem: String(cell(r, col.ggrem) ?? '').slice(0, 20) || null,
      substancia, produto: String(cell(r, col.produto) ?? '').slice(0, 300) || null,
      apresentacao: apres, laboratorio: String(cell(r, col.lab) ?? '').slice(0, 255) || null,
      classe: String(cell(r, col.classe) ?? '').slice(0, 255) || null, tipo,
      generico: ehGenerico(tipo) ? 1 : 0, tarja: String(cell(r, col.tarja) ?? '').slice(0, 80) || null,
      dosagem: p.dosagem, dose_valor: p.dose_valor, dose_unidade: p.dose_unidade, forma: p.forma, qtd: p.qtd_embalagem,
      pf: col.pfSemImp >= 0 ? numBR(cell(r, col.pfSemImp)) : (pf_por_icms['0'] ?? null),
      pmc_18: pmc_por_icms['18'] ?? pmc_por_icms['18.0'] ?? null,
      pmc_json: Object.keys(pmc_por_icms).length ? JSON.stringify(pmc_por_icms) : null,
      pf_json: Object.keys(pf_por_icms).length ? JSON.stringify(pf_por_icms) : null,
      restr: simNao(cell(r, col.restr)) ?? 0, comerc: simNao(cell(r, col.comerc)) ?? 1,
    };
    const eansLinha = [...new Set(eanCols.map((i) => eanOk(r[i])).filter(Boolean))];
    if (!eansLinha.length) { semEan++; continue; }
    for (const ean of eansLinha) {
      eans++;
      vals.push([
        ean, base.registro, base.ggrem, base.substancia, base.produto, base.apresentacao, base.laboratorio,
        base.classe, base.tipo, base.generico, base.tarja, base.dosagem, base.dose_valor, base.dose_unidade,
        base.forma, base.qtd, base.pf, base.pmc_18, base.pmc_json, base.pf_json, base.restr, base.comerc, versao,
      ]);
    }
  }
  console.log(`[cmed] versão ${versao} · ${linhas} registos · ${eans} EANs (${semEan} registos sem EAN, ignorados).`);

  const COLS = `ean, registro, ggrem, substancia, produto, apresentacao, laboratorio, classe_terapeutica, tipo,
    generico, tarja, dosagem, dose_valor, dose_unidade, forma, qtd_embalagem, pf, pmc_18, pmc_por_icms, pf_por_icms,
    restricao_hospitalar, comercializado, cmed_versao`;
  const UPD = `registro=VALUES(registro), ggrem=VALUES(ggrem), substancia=VALUES(substancia), produto=VALUES(produto),
    apresentacao=VALUES(apresentacao), laboratorio=VALUES(laboratorio), classe_terapeutica=VALUES(classe_terapeutica),
    tipo=VALUES(tipo), generico=VALUES(generico), tarja=VALUES(tarja), dosagem=VALUES(dosagem), dose_valor=VALUES(dose_valor),
    dose_unidade=VALUES(dose_unidade), forma=VALUES(forma), qtd_embalagem=VALUES(qtd_embalagem), pf=VALUES(pf),
    pmc_18=VALUES(pmc_18), pmc_por_icms=VALUES(pmc_por_icms), pf_por_icms=VALUES(pf_por_icms),
    restricao_hospitalar=VALUES(restricao_hospitalar), comercializado=VALUES(comercializado), cmed_versao=VALUES(cmed_versao)`;
  let gravados = 0;
  for (let i = 0; i < vals.length; i += 500) {
    const lote = vals.slice(i, i + 500);
    const ph = lote.map(() => '(' + '?,'.repeat(22) + '?)').join(',');
    const [res] = await pool.query(`INSERT INTO medicamento (${COLS}) VALUES ${ph} ON DUPLICATE KEY UPDATE ${UPD}`, lote.flat());
    gravados += lote.length;
    if (i % 5000 === 0) process.stdout.write(`\r[cmed] gravados ~${gravados}/${vals.length}…`);
  }
  const [[c]] = await pool.query('SELECT COUNT(*) n, COUNT(DISTINCT substancia) subs, SUM(generico) gen FROM medicamento');
  console.log(`\n✅ [cmed] medicamento: ${c.n} EANs · ${c.subs} princípios ativos · ${c.gen} genéricos.`);
  await closePool();
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

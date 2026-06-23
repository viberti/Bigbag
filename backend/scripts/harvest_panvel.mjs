// ADAPTADOR Panvel (panvel.com) — #5 do varejo farma BR (gaúcha, grupo Dimed). NÃO é VTEX
// nem JSON-LD: é Angular SSR com API privada (BFF). Colhe preço por EAN de forma LEGÍTIMA
// e DIRECIONADA pela API PÚBLICA que o próprio site usa: `POST /api/v2/search` (a v2 não
// exige cookies de WAF; a v3 sim — usamos a v2). Para cada EAN faz uma busca por código de
// barras → o produto exato (totalItems===1) → preço (discount.dealPrice ‖ originalPrice).
// O EAN é a própria query (certeza). NÃO resolve desafios; se o host se defender (403/503
// seguidos), ABORTA. Grava no MESMO pipeline: catalogo_produto (UPSERT) + catalogo_preco_hist.
//
// Uso (no SERVIDOR):
//   sudo -u dev node --env-file=.env scripts/harvest_panvel.mjs [--limite=N] [--atualizar] [--eans=a,b,c]
//     --limite=N    quantos EANs (default 200; 0 = todos os alvo)
//     --atualizar   re-buscar EANs que já temos da Panvel (refrescar preço); senão só os em falta
//     --eans=...    lista explícita de EANs (ignora os alvos da BD) — p/ testes
import { readFileSync } from 'node:fs';
import { getPool, closePool } from '../src/db.js';
import { tituloProduto } from '../src/normaliza/titulo.js';

const FONTE = 'panvel';
const UF = process.env.PANVEL_UF || '03';              // UF de referência (preço varia por estado)
const DELAY = Number(process.env.DELAY || 600);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FARMACIAS = JSON.parse(readFileSync(new URL('./fontes_farmacia.json', import.meta.url), 'utf8')).map((f) => f.fonte);

// Headers da API pública do BFF (valores genéricos — sem sessão real, sem cookies de WAF).
const PH = {
  accept: 'application/json, text/plain, */*', 'app-token': 'ZYkPuDaVJEiD', 'client-ip': '1',
  'content-type': 'application/json', 'search-new': 'A', source: 'mobile', 'user-id': '0',
  sessionid: '00000000-0000-4000-8000-000000000000', origin: 'https://www.panvel.com',
  'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
};

async function precoDoEan(ean) {
  const r = await fetch(`https://www.panvel.com/api/v2/search?type=CSR&uf=${UF}`, {
    method: 'POST', headers: PH, signal: AbortSignal.timeout(12000),
    body: JSON.stringify({ term: String(ean), itemsPerPage: 5, currentPage: 1, assortment: 'mais relevantes', filters: [], searchOffers: false, searchType: 'term' }),
  });
  if (r.status !== 200) return { status: r.status };
  const j = await r.json();
  // busca por código de barras: exigimos match EXATO (1 item) — senão é texto fuzzy, não confiar.
  if (!j || j.totalItems !== 1 || !Array.isArray(j.items) || !j.items[0]) return { naoEncontrado: true };
  const it = j.items[0];
  const preco = Number(it.discount && it.discount.dealPrice != null ? it.discount.dealPrice : it.originalPrice);
  return {
    preco: Number.isFinite(preco) && preco > 0 ? preco : null,
    nome: it.name ? tituloProduto(String(it.name).slice(0, 255)) : null,
    marca: it.brandName ? tituloProduto(String(it.brandName).slice(0, 140)) : null,
    sku: String(it.panvelCode || ean).slice(0, 24),
    imagem: it.image ? String(it.image).split('?')[0] : null,
    url: it.link || null,
  };
}

async function alvos(pool, { limite, atualizar, eans }) {
  if (eans && eans.length) return eans.map((ean) => ({ ean }));
  const inFar = '(' + FARMACIAS.map(() => '?').join(',') + ')';
  const cond = atualizar ? '' : `AND NOT EXISTS (SELECT 1 FROM catalogo_produto pv WHERE pv.ean=m.ean AND pv.fonte='${FONTE}')`;
  const [rows] = await pool.query(
    `SELECT DISTINCT m.ean FROM medicamento m
       JOIN catalogo_produto cp ON cp.ean=m.ean AND cp.preco > 0 AND cp.fonte IN ${inFar}
      WHERE 1=1 ${cond}
      ORDER BY m.ean ${limite ? 'LIMIT ' + limite : ''}`,
    FARMACIAS,
  );
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k, d) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
  const limite = Number(arg('limite', '200'));
  const atualizar = args.includes('--atualizar');
  const eans = (arg('eans', '') || '').split(',').map((s) => s.replace(/\D/g, '')).filter(Boolean);

  const pool = getPool();
  const lista = await alvos(pool, { limite, atualizar, eans });
  console.log(`[${FONTE}] ${lista.length} EANs alvo (${eans.length ? 'lista explícita' : atualizar ? 'incl. atualização' : 'só em falta'}). UF ${UF}. Delay ${DELAY}ms.`);

  const [cur] = await pool.query('SELECT ean, preco FROM catalogo_produto WHERE fonte=?', [FONTE]);
  const precoAtual = new Map(cur.map((r) => [r.ean, r.preco == null ? null : Number(r.preco)]));

  const upserts = []; const hist = [];
  let ok = 0, naoTem = 0, semPreco = 0, erros = 0, consecErro = 0;
  for (let i = 0; i < lista.length; i++) {
    const { ean } = lista[i];
    let r;
    try { r = await precoDoEan(ean); }
    catch (e) { erros++; consecErro++; if (consecErro >= 6) { console.log(`\n⚠️ ${consecErro} erros seguidos — ABORTO (não martelar).`); break; } await sleep(DELAY * 2); continue; }
    if (r.status === 403 || r.status === 503 || r.status === 429) {
      consecErro++; if (consecErro >= 6) { console.log(`\n⚠️ ${consecErro}× ${r.status} seguidos — ABORTO (proteção do host; não evadir).`); break; }
      await sleep(DELAY * 3); continue;
    }
    consecErro = 0;
    if (r.naoEncontrado) naoTem++;
    else if (r.preco == null) semPreco++;
    else {
      ok++;
      upserts.push([FONTE, r.sku, ean, r.nome, r.marca, r.preco, 'BRL', r.url, r.imagem]);
      const ant = precoAtual.has(ean) ? precoAtual.get(ean) : undefined;
      if (ant === undefined || ant === null || Number(ant) !== Number(r.preco)) hist.push([FONTE, r.sku, ean, r.preco, 'BRL']);
    }
    if (i % 25 === 0) process.stdout.write(`\r[${FONTE}] ${i + 1}/${lista.length} · ok ${ok} · sem ${naoTem} · s/preço ${semPreco} · err ${erros}   `);
    await sleep(DELAY);
  }

  for (let i = 0; i < upserts.length; i += 300) {
    const lote = upserts.slice(i, i + 300);
    await pool.query(
      `INSERT INTO catalogo_produto (fonte, sku_fonte, ean, nome, marca, preco, moeda, url, imagem_url, scraped_at)
       VALUES ${lote.map(() => '(?,?,?,?,?,?,?,?,?,NOW())').join(',')}
       ON DUPLICATE KEY UPDATE ean=VALUES(ean), nome=VALUES(nome), marca=VALUES(marca), preco=VALUES(preco),
         moeda=VALUES(moeda), url=VALUES(url), imagem_url=VALUES(imagem_url), scraped_at=NOW()`,
      lote.flat(),
    );
  }
  for (let i = 0; i < hist.length; i += 300) {
    const lote = hist.slice(i, i + 300);
    await pool.query(
      `INSERT INTO catalogo_preco_hist (fonte, sku_fonte, ean, preco, moeda, visto_em) VALUES ${lote.map(() => '(?,?,?,?,?,NOW())').join(',')}`,
      lote.flat(),
    );
  }
  console.log(`\n✅ [${FONTE}] ${ok} preços gravados (${hist.length} mudanças no histórico) · não tem ${naoTem} · sem preço ${semPreco} · erros ${erros}.`);
  await closePool();
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

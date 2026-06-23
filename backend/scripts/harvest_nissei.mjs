// ADAPTADOR Nissei (farmaciasnissei.com.br) — #6 do varejo farma BR (PR/SC). Next.js: a
// busca `/pesquisa/<EAN>` é server-rendered (dá o slug da PDP) e a PDP traz schema.org
// Product (gtin+price) server-rendered. Colhe por EAN: busca → PDP → gtin (confirma) +
// preço. Ver ingest/precoNissei.js. UPSERT + catalogo_preco_hist; guard anti-defesa.
//
// Uso (no SERVIDOR):
//   sudo -u dev node --env-file=.env scripts/harvest_nissei.mjs [--limite=N] [--atualizar] [--eans=a,b]
import { readFileSync } from 'node:fs';
import { getPool, closePool } from '../src/db.js';
import { tituloProduto } from '../src/normaliza/titulo.js';
import { precoNisseiEan } from '../src/ingest/precoNissei.js';

const FONTE = 'nissei';
const DELAY = Number(process.env.DELAY || 700);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FARMACIAS = JSON.parse(readFileSync(new URL('./fontes_farmacia.json', import.meta.url), 'utf8')).map((f) => f.fonte);

async function precoDoEan(ean) {
  const r = await precoNisseiEan(ean);
  if (r === null) return { status: 0 };
  if (!r.existe) return { naoEncontrado: true };
  return {
    preco: r.preco,
    nome: r.nome ? tituloProduto(String(r.nome).slice(0, 255)) : null,
    marca: r.marca ? tituloProduto(String(r.marca).slice(0, 140)) : null,
    sku: r.sku, imagem: r.imagem, url: r.url,
  };
}

async function alvos(pool, { limite, atualizar, eans }) {
  if (eans && eans.length) return eans.map((ean) => ({ ean }));
  const inFar = '(' + FARMACIAS.map(() => '?').join(',') + ')';
  const cond = atualizar ? '' : `AND NOT EXISTS (SELECT 1 FROM catalogo_produto ns WHERE ns.ean=m.ean AND ns.fonte='${FONTE}')`;
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
  console.log(`[${FONTE}] ${lista.length} EANs alvo (${eans.length ? 'lista explícita' : atualizar ? 'incl. atualização' : 'só em falta'}). Delay ${DELAY}ms.`);

  const [cur] = await pool.query('SELECT ean, preco FROM catalogo_produto WHERE fonte=?', [FONTE]);
  const precoAtual = new Map(cur.map((r) => [r.ean, r.preco == null ? null : Number(r.preco)]));

  const upserts = []; const hist = [];
  let ok = 0, naoTem = 0, semPreco = 0, erros = 0, consecErro = 0;
  for (let i = 0; i < lista.length; i++) {
    const { ean } = lista[i];
    let r;
    try { r = await precoDoEan(ean); }
    catch (e) { erros++; consecErro++; if (consecErro >= 6) { console.log(`\n⚠️ ${consecErro} erros seguidos — ABORTO.`); break; } await sleep(DELAY * 2); continue; }
    if (r.status === 403 || r.status === 503 || r.status === 429) {
      consecErro++; if (consecErro >= 6) { console.log(`\n⚠️ ${consecErro}× ${r.status} seguidos — ABORTO (proteção do host).`); break; }
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

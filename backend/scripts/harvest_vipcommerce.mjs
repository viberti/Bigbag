// HARVESTER VipCommerce (plataforma white-label de supermercado BR) — GENÉRICO, reutilizável
// para qualquer loja VipCommerce (Superprix e outras). Decifrado 2026-06-17 (captura do browser
// do dono). Ver memória [[metodologia-descoberta-fontes]] / docs/Metodologia.
//
// API (host PARTILHADO services.vipcommerce.com.br — alcançável do nosso servidor; só o storefront
//  `www.<loja>` é que tem WAF anti-datacenter):
//   BASE = https://services.vipcommerce.com.br/api-admin/v1/org/<ORG>/filial/1/centro_distribuicao/1/loja/
//   Headers: authorization: Bearer <jwt anónimo> · domainkey: <dominio> · organizationid: <ORG> · sessao-id
//   Árvore de departamentos: GET classificacoes_mercadologicas/departamentos/arvore  → [{classificacao_mercadologica_id,descricao,...}]
//   Browse:                  GET classificacoes_mercadologicas/departamentos/<id>/produtos?page=N → data.produtos[] (20/pág) + paginator{total_pages}
//   Item de lista JÁ TRAZ:   produto_id, descricao, codigo_barras (EAN), preco (R$), marca_id, imagem(UUID), link(slug)
//   (nutrição/ingredientes: a VipCommerce TEM o campo mas o retalhista raramente preenche → fonte EAN+preço+imagem)
//
// O token JWT é anónimo (sub fixo, sem exp) e captura-se do DevTools do storefront (o dono cola o cURL).
// Passa-se por ficheiro (--token-file) para não ir na linha de comando.
//   sudo -u dev node --env-file=.env scripts/harvest_vipcommerce.mjs \
//     --org 388 --domain superprix.com.br --fonte superprix --token-file /tmp/vip.tok [--img-base <url>] [--delay 130]
import { getPool, closePool } from '../src/db.js';
import { eanValido } from '../src/normaliza/ean.js';
import { readFile } from 'node:fs/promises';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ORG = arg('--org', '388');
const DOMAIN = arg('--domain', 'superprix.com.br');
const FONTE = arg('--fonte', 'superprix');
const TOKEN_FILE = arg('--token-file', '/tmp/vip.tok');
const IMG_BASE = arg('--img-base', ''); // base do CDN de imagem; vazio → imagem_url null (backfill depois)
const DELAY = Number(arg('--delay', '130'));
const FILIAL = arg('--filial', '1');
const CD = arg('--cd', '1');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let H;
const BASE = `https://services.vipcommerce.com.br/api-admin/v1/org/${ORG}/filial/${FILIAL}/centro_distribuicao/${CD}/loja/`;
async function api(path) {
  for (let t = 0; ; t++) {
    try {
      const r = await fetch(BASE + path, { headers: H, signal: AbortSignal.timeout(20000) });
      if ((r.status === 429 || r.status >= 500) && t < 4) { await sleep(1500 * (t + 1)); continue; }
      const txt = await r.text();
      if (r.status === 401) throw new Error('401 — token inválido/expirado (recapturar o cURL do browser)');
      let j; try { j = JSON.parse(txt); } catch { /* não-JSON */ }
      return { status: r.status, j, txt };
    } catch (e) { if (String(e.message).startsWith('401')) throw e; if (t >= 4) return { status: 0, txt: String(e.message) }; await sleep(1000 * (t + 1)); }
  }
}
const produtosDe = (j) => (Array.isArray(j?.data) ? j.data : (j?.data?.produtos || []));

async function upsert(pool, vals) {
  if (!vals.length) return;
  await pool.query(
    `INSERT INTO catalogo_produto (fonte, sku_fonte, ean, nome, categoria, preco, moeda, url, imagem_url, scraped_at)
     VALUES ${vals.map(() => '(?,?,?,?,?,?,?,?,?,NOW())').join(',')}
     ON DUPLICATE KEY UPDATE nome=VALUES(nome), ean=VALUES(ean), preco=VALUES(preco), moeda=VALUES(moeda),
       url=VALUES(url), imagem_url=VALUES(imagem_url), categoria=VALUES(categoria), scraped_at=NOW()`,
    vals.flat(),
  );
}

async function main() {
  const tok = (await readFile(TOKEN_FILE, 'utf8')).trim();
  H = { accept: 'application/json', 'content-type': 'application/json', authorization: tok.startsWith('Bearer') ? tok : `Bearer ${tok}`,
    domainkey: DOMAIN, organizationid: String(ORG), origin: `https://www.${DOMAIN}`, referer: `https://www.${DOMAIN}/`, 'user-agent': UA };

  const tree = await api('classificacoes_mercadologicas/departamentos/arvore');
  const deps = (tree.j?.data || []).filter((d) => d.classificacao_mercadologica_id);
  if (!deps.length) { console.error('sem árvore de departamentos:', tree.status, (tree.txt || '').slice(0, 120)); process.exit(1); }
  console.log(`${FONTE} (org ${ORG}): ${deps.length} departamentos`);

  await getPool().query('DELETE FROM catalogo_produto WHERE fonte = ?', [FONTE]); // crawl fresco, idempotente
  const vistos = new Set();
  let total = 0; let comEan = 0;
  for (const d of deps) {
    const id = d.classificacao_mercadologica_id;
    const p1 = await api(`classificacoes_mercadologicas/departamentos/${id}/produtos?page=1`);
    const tp = Math.min(p1.j?.paginator?.total_pages || 1, 2000);
    process.stderr.write(`  ${String(d.descricao).padEnd(22)} ${p1.j?.paginator?.total_items || 0} produtos, ${tp} págs\n`);
    for (let pg = 1; pg <= tp; pg++) {
      const r = pg === 1 ? p1 : await api(`classificacoes_mercadologicas/departamentos/${id}/produtos?page=${pg}`);
      const prods = produtosDe(r.j);
      const vals = [];
      for (const x of prods) {
        const pid = x.produto_id; if (!pid || vistos.has(pid)) continue; vistos.add(pid);
        const eanCru = String(x.codigo_barras || '').replace(/\D/g, '');
        const ean = eanValido(eanCru) ? eanCru : null; if (ean) comEan++;
        const preco = x.preco != null ? Number(x.preco) : null;
        const url = x.link ? `https://www.${DOMAIN}/produto/${pid}/${x.link}`.slice(0, 600) : null;
        const img = (IMG_BASE && x.imagem) ? (IMG_BASE + x.imagem).slice(0, 600) : null;
        vals.push([FONTE, `vip-${pid}`.slice(0, 24), ean, String(x.descricao || `vip-${pid}`).slice(0, 255),
          String(d.descricao || '').slice(0, 120), preco, 'BRL', url, img]);
      }
      await upsert(getPool(), vals);
      total += vals.length;
      if (pg % 20 === 0) process.stderr.write(`\r    pág ${pg}/${tp} (total ${total})        `);
      await sleep(DELAY);
    }
    process.stderr.write('\n');
  }
  const [[c]] = await getPool().query(
    'SELECT COUNT(*) n, SUM(ean IS NOT NULL) ean, SUM(imagem_url IS NOT NULL) img, SUM(preco IS NOT NULL) preco FROM catalogo_produto WHERE fonte = ?', [FONTE]);
  console.log(`\n✅ ${FONTE}: ${c.n} linhas | ${c.ean} c/ EAN | ${c.img} c/ imagem | ${c.preco} c/ preço`);
  await closePool();
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });

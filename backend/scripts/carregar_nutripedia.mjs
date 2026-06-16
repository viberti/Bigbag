// CARREGADOR da Nutripedia: le o NDJSON produzido por harvest_nutripedia.mjs (no PC)
// e insere em catalogo_produto com fonte='nutripedia'. CORRE NO SERVIDOR (tem BD).
//
// Uma linha por (produto, EAN) — varios EANs do mesmo produto (tamanhos) sao codigos
// distintos que resolvem para a mesma nutricao (por 100<base>, igual em todos os tamanhos).
// Assim, ler qualquer um desses EANs resolve nome+marca+nutricao+ingredientes+foto, e a
// fusao do fichaEan apanha-os automaticamente (catalogo_produto e fonte de nutricao por EAN).
//
// Mapa id->macro DERIVADO por triangulacao (scripts/derive, 102/120 cruzados com off_full;
// votos decisivos). Base nutricional = por 100 <unidade> (g/ml), vinda do campo `unidade`.
//
// Idempotente: DELETE fonte='nutripedia' + INSERT. Uso (no servidor):
//   sudo -u dev node --env-file=.env scripts/carregar_nutripedia.mjs /tmp/nutripedia.ndjson
import { readFileSync } from 'node:fs';
import { getPool, closePool } from '../src/db.js';
import { tituloProduto } from '../src/normaliza/titulo.js';

const FICHEIRO = process.argv[2] || '/tmp/nutripedia.ndjson';
const FONTE = 'nutripedia';
// id de nutriente (Nutripedia) -> chave da nossa nutricao. Derivado, nao adivinhado.
const MAP = { energia_kcal: 14, gordura: 31, gordura_saturada: 34, hidratos: 20, acucares: 21, proteina: 42, sal: 45, fibra: 17 };

function nutricaoDe(nutrientes) {
  if (!nutrientes) return null;
  const out = {};
  for (const [chave, id] of Object.entries(MAP)) {
    const o = nutrientes[id];
    if (o && o.q != null && Number.isFinite(Number(o.q))) out[chave] = Number(o.q);
  }
  return Object.keys(out).length ? out : null;
}

async function main() {
  const linhas = readFileSync(FICHEIRO, 'utf8').split('\n').filter((l) => l.trim());
  console.log(`[nutripedia] ${linhas.length} produtos no ficheiro.`);
  const pool = getPool();
  const vistos = new Set();
  const vals = [];
  let comNut = 0, comImg = 0, eansTot = 0;
  for (const ln of linhas) {
    let r; try { r = JSON.parse(ln); } catch { continue; }
    const nut = nutricaoDe(r.nutrientes);
    const nutJson = nut ? JSON.stringify(nut) : null;
    const nutBase = nut && r.base ? `por 100 ${r.base}` : null;
    if (nut) comNut++;
    if (r.imagem) comImg++;
    const nome = tituloProduto((r.nome || '').slice(0, 255)) || String(r.eans[0]);
    const marca = r.marca ? tituloProduto(String(r.marca).slice(0, 140)) : null;
    const ingred = r.ingredientes ? String(r.ingredientes).slice(0, 3000) : null;
    const url = `https://nutripedia.pt/produtos/${r.id}`;
    const img = r.imagem ? String(r.imagem).slice(0, 600) : null;
    r.eans.forEach((ean, idx) => {
      const sku = `np-${r.id}-${idx}`.slice(0, 24);
      if (vistos.has(sku)) return; vistos.add(sku); eansTot++;
      vals.push([FONTE, sku, ean, nome, marca, ingred, nutJson, nutBase, url, img]);
    });
  }
  console.log(`[nutripedia] linhas a inserir: ${eansTot} (${comNut} produtos c/ nutricao, ${comImg} c/ imagem).`);
  await pool.query('DELETE FROM catalogo_produto WHERE fonte = ?', [FONTE]);
  for (let i = 0; i < vals.length; i += 500) {
    await pool.query(
      'INSERT INTO catalogo_produto (fonte, sku_fonte, ean, nome, marca, ingredientes, nutricao, nutricao_base, url, imagem_url, scraped_at) VALUES ' +
        vals.slice(i, i + 500).map(() => '(?,?,?,?,?,?,?,?,?,?,NOW())').join(','),
      vals.slice(i, i + 500).flat(),
    );
  }
  const [[c]] = await pool.query('SELECT COUNT(*) n, COUNT(DISTINCT ean) eans, SUM(nutricao IS NOT NULL) nut FROM catalogo_produto WHERE fonte = ?', [FONTE]);
  console.log(`✅ [nutripedia] no catalogo: ${c.n} linhas | ${c.eans} EANs distintos | ${c.nut} c/ nutricao.`);
  await closePool();
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

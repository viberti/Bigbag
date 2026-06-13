// HIPÓTESE "match por imagem (aparência pura)" — gera o manifesto do experimento.
// 200 produtos com imagem em Auchan E Continente (gabarito = mesmo EAN), com a
// família (2.º nível do categoria_path) para construir negativos DIFÍCEIS
// (produtos parecidos da mesma família). Escreve /tmp/exp_img_manifesto.json.
import { writeFileSync } from 'node:fs';
import { getPool } from '../src/db.js';
const pool = getPool();

const [rows] = await pool.query(`
  SELECT a.ean, a.nome,
         a.imagem_url AS url_a,
         b.imagem_url AS url_b,
         COALESCE(NULLIF(a.categoria_path,''), a.categoria) AS path
  FROM catalogo_produto a
  JOIN catalogo_produto b ON b.ean = a.ean AND b.fonte = 'continente'
  WHERE a.fonte = 'auchan'
    AND a.imagem_url IS NOT NULL AND a.imagem_url <> ''
    AND b.imagem_url IS NOT NULL AND b.imagem_url <> ''
    AND a.imagem_url <> b.imagem_url
  ORDER BY RAND() LIMIT 200`);

const familia = (p) => {
  if (!p) return null;
  const n = String(p).split('/').map((x) => x.trim()).filter((x) => x && x.toLowerCase() !== 'alimentacao');
  return n.length >= 2 ? n[1].toLowerCase() : (n[0] || '').toLowerCase();
};
const out = rows.map((r) => ({ ean: r.ean, nome: r.nome, familia: familia(r.path), url_a: r.url_a, url_b: r.url_b }));
writeFileSync('/tmp/exp_img_manifesto.json', JSON.stringify(out, null, 0));
const fams = {};
for (const o of out) fams[o.familia] = (fams[o.familia] || 0) + 1;
console.log(`manifesto: ${out.length} produtos · ${Object.keys(fams).length} famílias`);
console.log('famílias com ≥4 (suporte p/ negativo difícil):', Object.entries(fams).filter(([, n]) => n >= 4).map(([f, n]) => `${f}:${n}`).join(', '));
process.exit(0);

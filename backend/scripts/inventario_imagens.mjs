// HIPÓTESE "match por imagem entre lojas" — Fase 0: inventário do terreno.
// (1) cobertura de imagem por fonte; (2) EANs com imagem em ≥2 lojas (= o
// dataset de teste com gabarito-EAN); (3) os URLs do mesmo EAN em lojas
// diferentes são DISTINTOS (foto da loja) ou o MESMO ficheiro (fabricante —
// tornaria o teste trivial)? Só leitura.
import { getPool } from '../src/db.js';
const pool = getPool();

const [cob] = await pool.query(`
  SELECT fonte, COUNT(*) total, SUM(imagem_url IS NOT NULL AND imagem_url <> '') com_img
  FROM catalogo_produto GROUP BY fonte ORDER BY com_img DESC`);
console.log('— Cobertura de imagem por fonte:');
for (const r of cob) console.log(`  ${String(r.fonte).padEnd(14)} ${String(r.com_img).padStart(6)}/${String(r.total).padStart(6)} (${Math.round(100 * r.com_img / r.total)}%)`);

// EANs com imagem em ≥2 fontes distintas
const [[par]] = await pool.query(`
  SELECT COUNT(*) n FROM (
    SELECT ean FROM catalogo_produto
    WHERE ean IS NOT NULL AND ean <> '' AND imagem_url IS NOT NULL AND imagem_url <> ''
    GROUP BY ean HAVING COUNT(DISTINCT fonte) >= 2) t`);
console.log(`\n— EANs com imagem em ≥2 lojas (dataset de positivos): ${par.n}`);

// por par de fontes
const [pares] = await pool.query(`
  SELECT a.fonte fa, b.fonte fb, COUNT(*) n,
         SUM(a.imagem_url = b.imagem_url) iguais
  FROM catalogo_produto a
  JOIN catalogo_produto b ON b.ean = a.ean AND b.fonte > a.fonte
  WHERE a.ean IS NOT NULL AND a.ean <> ''
    AND a.imagem_url IS NOT NULL AND a.imagem_url <> ''
    AND b.imagem_url IS NOT NULL AND b.imagem_url <> ''
  GROUP BY a.fonte, b.fonte HAVING n >= 5 ORDER BY n DESC`);
console.log('\n— Pares de lojas (EANs c/ imagem em ambas) · URLs IGUAIS = mesmo ficheiro (trivial):');
for (const r of pares) console.log(`  ${r.fa} ∩ ${r.fb}: ${String(r.n).padStart(5)} EANs · ${r.iguais} URLs idênticos (${Math.round(100 * r.iguais / r.n)}%)`);

// amostra: 5 EANs partilhados, mostrar os 2 URLs lado a lado
const [amostra] = await pool.query(`
  SELECT a.ean, a.fonte fa, a.imagem_url ua, b.fonte fb, b.imagem_url ub
  FROM catalogo_produto a
  JOIN catalogo_produto b ON b.ean = a.ean AND b.fonte > a.fonte
  WHERE a.ean IS NOT NULL AND a.imagem_url IS NOT NULL AND b.imagem_url IS NOT NULL
    AND a.imagem_url <> b.imagem_url
  LIMIT 5`);
console.log('\n— Amostra de pares com URLs DIFERENTES (o teste real):');
for (const r of amostra) console.log(`  EAN ${r.ean}\n    ${r.fa}: ${String(r.ua).slice(0, 90)}\n    ${r.fb}: ${String(r.ub).slice(0, 90)}`);
process.exit(0);

// EXPLORAÇÃO (2026-06-13): EANs partilhados entre lojas = pares de categorias
// EQUIVALENTES (o mesmo produto está em "Mercearia/Conservas" no Continente e
// em ".../polpa-tomate" no Auchan → as categorias co-ocorrem). Mede se dá para
// MINERAR o mapa de equivalência em vez de o escrever à mão. Só leitura.
import { getPool } from '../src/db.js';

const pool = getPool();

// 1) interseção de EANs entre fontes
const [inter] = await pool.query(`
  SELECT a.fonte fa, b.fonte fb, COUNT(DISTINCT a.ean) n
  FROM catalogo_produto a
  JOIN catalogo_produto b ON b.ean = a.ean AND b.fonte > a.fonte
  WHERE a.ean IS NOT NULL AND a.ean <> ''
  GROUP BY a.fonte, b.fonte ORDER BY n DESC`);
console.log('— EANs partilhados entre fontes:');
for (const r of inter) console.log(`  ${r.fa} ∩ ${r.fb} = ${r.n}`);

// 2) pares de categorias co-ocorrentes (Continente×Auchan, top)
const [pares] = await pool.query(`
  SELECT COALESCE(NULLIF(a.categoria_path,''), a.categoria) ca,
         COALESCE(NULLIF(b.categoria_path,''), b.categoria) cb, COUNT(*) n
  FROM catalogo_produto a
  JOIN catalogo_produto b ON b.ean = a.ean AND b.fonte = 'auchan'
  WHERE a.fonte = 'continente' AND a.ean IS NOT NULL AND a.ean <> ''
    AND COALESCE(NULLIF(a.categoria_path,''), NULLIF(a.categoria,'')) IS NOT NULL
    AND COALESCE(NULLIF(b.categoria_path,''), NULLIF(b.categoria,'')) IS NOT NULL
  GROUP BY ca, cb HAVING n >= 5 ORDER BY n DESC LIMIT 15`);
console.log('\n— Pares de categorias co-ocorrentes Continente×Auchan (≥5 EANs):');
for (const r of pares) console.log(`  ${String(r.n).padStart(3)}×  ${String(r.ca).slice(0, 50).padEnd(50)} ≡ ${String(r.cb).slice(0, 60)}`);

// 3) quantos pares ≥3 no total (tamanho do mapa minerável)
const [[tot]] = await pool.query(`
  SELECT COUNT(*) pares FROM (
    SELECT 1 FROM catalogo_produto a
    JOIN catalogo_produto b ON b.ean = a.ean AND b.fonte = 'auchan'
    WHERE a.fonte = 'continente' AND a.ean IS NOT NULL AND a.ean <> ''
      AND COALESCE(NULLIF(a.categoria_path,''), NULLIF(a.categoria,'')) IS NOT NULL
      AND COALESCE(NULLIF(b.categoria_path,''), NULLIF(b.categoria,'')) IS NOT NULL
    GROUP BY COALESCE(NULLIF(a.categoria_path,''), a.categoria), COALESCE(NULLIF(b.categoria_path,''), b.categoria)
    HAVING COUNT(*) >= 3) t`);
console.log(`\n— Pares Continente≡Auchan com ≥3 EANs de suporte: ${tot.pares}`);
process.exit(0);

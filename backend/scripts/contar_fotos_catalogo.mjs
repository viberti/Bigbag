// Dimensiona o banco de vetores de imagem (visão do dono): quantas FOTOS há para
// vetorizar (1 vetor/foto preserva as vistas), quantos EANs distintos, e quantos
// têm multi-foto natural (mesmo EAN em ≥2 fontes = galeria multi de graça).
import { getPool } from '../src/db.js';
const pool = getPool();

const [[tot]] = await pool.query(`
  SELECT COUNT(*) fotos,
         COUNT(DISTINCT ean) eans_distintos,
         SUM(ean IS NULL OR ean = '') fotos_sem_ean
  FROM catalogo_produto WHERE imagem_url IS NOT NULL AND imagem_url <> ''`);
console.log('— Fotos de catálogo com imagem:');
console.log(`  fotos (linhas c/ imagem)   : ${tot.fotos}`);
console.log(`  EANs distintos             : ${tot.eans_distintos}`);
console.log(`  fotos sem EAN (descartar)  : ${tot.fotos_sem_ean}`);

// distribuição de nº de fotos por EAN (só EANs válidos)
const [dist] = await pool.query(`
  SELECT nfotos, COUNT(*) n_eans FROM (
    SELECT ean, COUNT(*) nfotos FROM catalogo_produto
    WHERE imagem_url IS NOT NULL AND imagem_url <> '' AND ean IS NOT NULL AND ean <> ''
    GROUP BY ean) t GROUP BY nfotos ORDER BY nfotos`);
console.log('\n— Fotos por EAN (multi-foto natural = ≥2):');
let multi = 0, totEan = 0, totFotos = 0;
for (const r of dist) {
  console.log(`  ${r.nfotos} foto(s): ${r.n_eans} EANs`);
  totEan += r.n_eans; totFotos += r.nfotos * r.n_eans;
  if (r.nfotos >= 2) multi += r.n_eans;
}
console.log(`  → ${multi}/${totEan} EANs (${Math.round(100*multi/totEan)}%) têm ≥2 fotos · média ${(totFotos/totEan).toFixed(2)} fotos/EAN`);

// custo/tamanho estimados
const dims = 768, bytes = 4;
console.log('\n— Estimativas:');
console.log(`  armazenamento (1 vetor/foto, ${dims}d float32): ${(tot.fotos*dims*bytes/1e6).toFixed(0)} MB  (float16: ${(tot.fotos*dims*2/1e6).toFixed(0)} MB)`);
console.log(`  inferência CPU a ~3 img/s: ${(tot.fotos/3/3600).toFixed(1)} h  ·  a ~50 img/s (GPU/serviço): ${(tot.fotos/50/60).toFixed(0)} min`);
process.exit(0);

// Testa se os CDNs das lojas servem o SERVIDOR sem anti-bot (decide se o bulk de
// download das 36k fotos corre no servidor). Amostra N URLs por fonte, tenta
// baixar, reporta sucesso + tamanho médio. Só leitura (descarta os bytes).
import { getPool } from '../src/db.js';
const pool = getPool();
const N = 15;
const [fontes] = await pool.query(`
  SELECT DISTINCT fonte FROM catalogo_produto WHERE imagem_url IS NOT NULL AND imagem_url <> ''`);
for (const { fonte } of fontes) {
  const [rows] = await pool.query(
    `SELECT imagem_url FROM catalogo_produto WHERE fonte = ? AND imagem_url IS NOT NULL AND imagem_url <> '' ORDER BY RAND() LIMIT ?`,
    [fonte, N]);
  let ok = 0, bytes = 0, erros = [];
  for (const r of rows) {
    try {
      const resp = await fetch(r.imagem_url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
      const ct = resp.headers.get('content-type') || '';
      if (resp.ok && ct.startsWith('image/')) {
        const buf = await resp.arrayBuffer(); ok++; bytes += buf.byteLength;
      } else erros.push(resp.status);
    } catch (e) { erros.push(e.name); }
  }
  console.log(`${String(fonte).padEnd(14)} ${ok}/${rows.length} ok · ${ok ? Math.round(bytes / ok / 1024) : 0} KB/foto médio${erros.length ? ' · erros: ' + erros.slice(0, 5).join(',') : ''}`);
}
process.exit(0);

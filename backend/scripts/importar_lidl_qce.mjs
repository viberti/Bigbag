// Importa o extrato da lista QCE do Lidl FR (lidl_qce.jsonl, gerado por
// parse_lidl_qce.py a partir do PDF público) → catalogo_produto fonte 'lidl-fr'.
// 5,4k produtos / 9,6k EANs válidos — nomes em FRANCÊS (a chave é o EAN, igual
// em toda a Europa, incl. os códigos curtos 2xxxxxxx das lojas Lidl).
//   node scripts/importar_lidl_qce.mjs <caminho.jsonl>
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { getPool } from '../src/db.js';
import { tituloProduto } from '../src/normaliza/titulo.js';

const FICHEIRO = process.argv[2] || '/tmp/lidl_qce.jsonl';
const pool = getPool();
const rl = createInterface({ input: createReadStream(FICHEIRO, 'utf8'), crlfDelay: Infinity });
let produtos = 0, linhas = 0, erros = 0;
for await (const l of rl) {
  if (!l.trim()) continue;
  let o;
  try { o = JSON.parse(l); } catch { continue; }
  produtos++;
  for (const ean of o.eans || []) {
    try {
      await pool.query(
        `INSERT INTO catalogo_produto (fonte, sku_fonte, ean, nome, marca, formato, url, scraped_at)
           VALUES ('lidl-fr', ?, ?, ?, ?, ?, 'qce:PUB-715161', NOW())
         ON DUPLICATE KEY UPDATE ean=VALUES(ean), nome=VALUES(nome), marca=VALUES(marca), formato=VALUES(formato), scraped_at=NOW()`,
        [ean, ean, tituloProduto(o.nome).slice(0, 255), o.marca ? tituloProduto(o.marca).slice(0, 140) : null, o.formato?.slice(0, 40) || null],
      );
      linhas++;
    } catch (e) { erros++; if (erros <= 5) console.error('  erro:', ean, e.message); }
  }
}
console.log(`✅ [lidl-fr] ${produtos} produtos → ${linhas} linhas-EAN, ${erros} erros.`);
const [[c]] = await pool.query("SELECT COUNT(*) n FROM catalogo_produto WHERE fonte='lidl-fr'");
console.log(`[lidl-fr] no catálogo: ${c.n}.`);
process.exit(0);

// Traz os produtos das marcas PRÓPRIAS do Mercadona que estão no dump do OFF
// (off_produto) para o catálogo de matching, como fonte 'mercadona-off'.
// Motivo (análise 2026-06-11): o off_produto tem ~950 produtos Hacendado/Deliplus/
// Bosque Verde, 540 já com NOME EM PORTUGUÊS (da comunidade) — que o matching de
// nome ignorava. Junta cobertura (584 não estão no scrape) E nomes PT (sem léxico).
//   node scripts/importar_off_mercadona.mjs [--aplicar]
import { getPool } from '../src/db.js';
import { tituloProduto } from '../src/normaliza/titulo.js';
import { conteudoDeTexto } from '../src/normaliza/conteudo.js';
import { expandirAbreviaturas } from '../src/normaliza/abreviaturas.js';

const APLICAR = process.argv.includes('--aplicar');
const pool = getPool();

const [rows] = await pool.query(`
  SELECT ean, nome, nome_pt, marca, quantidade, categoria
    FROM off_produto
   WHERE LOWER(marca) REGEXP 'hacendado|deliplus|bosque verde|mercadona'`);

let inseridos = 0, jaNoScrape = 0;
for (const r of rows) {
  // se o EAN já está no scrape do Mercadona, não duplica (o scrape tem preço/tamanho melhores)
  const [[noScrape]] = await pool.query(
    "SELECT 1 FROM catalogo_produto WHERE fonte='mercadona' AND ean = ? COLLATE utf8mb4_0900_ai_ci LIMIT 1", [r.ean]);
  if (noScrape) { jaNoScrape++; continue; }
  // nome PT da comunidade quando existe; senão o nome do OFF (pode ser ES/EN → o
  // léxico ES→PT ajuda no token-matching, sem o reescrever de forma destrutiva).
  const nome = tituloProduto(r.nome_pt || r.nome);
  if (!nome) continue; // sem nome utilizável → não serve para matching
  const c = conteudoDeTexto(r.quantidade);
  if (APLICAR) {
    // categoria do OFF é uma lista longa → guarda só o último nó (o mais específico)
    const cat = r.categoria ? String(r.categoria).split(',').pop().trim().slice(0, 100) : null;
    try {
      await pool.query(
        `INSERT INTO catalogo_produto (fonte, sku_fonte, ean, nome, nome_pt, marca, categoria, formato, unidade_base, formato_valor, url, scraped_at)
           VALUES ('mercadona-off', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'off-dump', NOW())
         ON DUPLICATE KEY UPDATE nome=VALUES(nome), nome_pt=VALUES(nome_pt), marca=VALUES(marca),
           categoria=VALUES(categoria), formato=VALUES(formato), unidade_base=VALUES(unidade_base), formato_valor=VALUES(formato_valor)`,
        [r.ean, r.ean, nome.slice(0, 255), r.nome_pt ? (tituloProduto(r.nome_pt) || '').slice(0, 255) || null : null,
          (tituloProduto(r.marca) || '').slice(0, 140) || null, cat,
          c ? `${c.valor}${c.unidade}` : (r.quantidade?.slice(0, 40) || null), c?.unidade || null, c?.valor ?? null],
      );
    } catch (e) { console.error('  erro', r.ean, e.message); continue; }
  }
  inseridos++;
}
console.log(`${APLICAR ? 'APLICADO' : 'DRY-RUN'}: ${rows.length} produtos own-brand no OFF · ${inseridos} a inserir como 'mercadona-off' · ${jaNoScrape} já no scrape.`);
if (!APLICAR) console.log('(corre com --aplicar)');
process.exit(0);

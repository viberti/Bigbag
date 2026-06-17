// Reconstrói produto_busca (índice de busca PT do autocomplete; ver migração 059).
// Idempotente (TRUNCATE + rebuild) — re-correr após scrapes/traduções. NÃO toca no
// off_full (4,5M). Genéricos = substantivo-cabeça por frequência + histórico da casa.
//   sudo -u dev node --env-file=.env scripts/construir_produto_busca.mjs
import { getPool } from '../src/db.js';
import { normAlfa, singularizar } from '../src/normaliza/categoria.js';

const pool = getPool();
const FONTES = ['continente', 'auchan', 'pingodoce', 'lidl', 'mercadona', 'lidl-fr'];
const ph = FONTES.map(() => '?').join(',');
const ORDEM = "FIELD(fonte,'continente','auchan','pingodoce','lidl','mercadona','lidl-fr')";
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

await pool.query('TRUNCATE produto_busca');

// 1) ESPECÍFICOS com EAN — dedup por EAN, melhor nome PT (nome_pt || nome), fonte PT 1.º
await pool.query(
  `INSERT INTO produto_busca (generico, nome, marca, tamanho, ean, product_type)
   SELECT 0, nome, marca, tamanho, ean, product_type FROM (
     SELECT ean, LEFT(COALESCE(NULLIF(nome_pt,''),nome),255) nome, LEFT(marca,120) marca,
            LEFT(formato,60) tamanho, product_type,
            ROW_NUMBER() OVER (PARTITION BY ean ORDER BY ${ORDEM}) rn
       FROM catalogo_produto
      WHERE fonte IN (${ph}) AND ean IS NOT NULL AND ean<>'' AND COALESCE(NULLIF(nome_pt,''),nome)<>''
   ) t WHERE rn=1`, FONTES);

// 2) ESPECÍFICOS sem EAN (Pingo Doce etc.) — dedup por nome normalizado
await pool.query(
  `INSERT INTO produto_busca (generico, nome, marca, tamanho, ean, product_type)
   SELECT 0, nome, marca, tamanho, NULL, product_type FROM (
     SELECT LEFT(COALESCE(NULLIF(nome_pt,''),nome),255) nome, LEFT(marca,120) marca,
            LEFT(formato,60) tamanho, product_type,
            ROW_NUMBER() OVER (PARTITION BY LOWER(COALESCE(NULLIF(nome_pt,''),nome)) ORDER BY ${ORDEM}) rn
       FROM catalogo_produto
      WHERE fonte IN (${ph}) AND (ean IS NULL OR ean='') AND COALESCE(NULLIF(nome_pt,''),nome)<>''
   ) t WHERE rn=1`, FONTES);

const [[e1]] = await pool.query('SELECT COUNT(*) n FROM produto_busca WHERE generico=0');
console.log('específicos:', e1.n);

// 3) GENÉRICOS = substantivo-cabeça por frequência + histórico da casa (já PT)
const [specs] = await pool.query('SELECT nome FROM produto_busca WHERE generico=0');
const cabeca = (nome) => { const t = normAlfa(nome).split(' ').filter((w) => w.length >= 3); return t.length ? singularizar(t[0]) : null; };
const freq = new Map();
for (const { nome } of specs) { const h = cabeca(nome); if (h) freq.set(h, (freq.get(h) || 0) + 1); }
const gen = new Map(); // chave normalizada -> { nome, pop }
for (const [h, f] of freq) if (f >= 8) gen.set(h, { nome: cap(h), pop: f });
const [hist] = await pool.query('SELECT ANY_VALUE(nome) nome, COUNT(*) c FROM lista_item GROUP BY LOWER(nome)');
for (const { nome, c } of hist) {
  const k = normAlfa(nome); if (!k || k.split(' ').length > 2) continue;
  const cur = gen.get(k); gen.set(k, { nome: cap(cur ? cur.nome.toLowerCase() : nome), pop: (cur?.pop || 0) + c * 5 });
}
for (const { nome, pop } of gen.values()) {
  await pool.query('INSERT INTO produto_busca (generico, nome, popularidade, product_type) VALUES (1,?,?,?)', [nome.slice(0, 255), pop, 'food']);
}
console.log('genéricos:', gen.size);

// 4) popularidade dos ESPECÍFICOS pelo histórico da casa. `popularidade>0` é o gate do
//    autocomplete: só genéricos + específicos que a casa CONHECE entram (dono 2026-06-17).
//    4a) listados (lista_item):
await pool.query(
  `UPDATE produto_busca pb JOIN (
     SELECT LOWER(nome) k, COUNT(*) c FROM lista_item GROUP BY LOWER(nome)
   ) h ON LOWER(pb.nome)=h.k SET pb.popularidade = pb.popularidade + h.c WHERE pb.generico=0`);
//    4b) COMPRADOS (talão): match por nome do item comprado (sku resolvido > descrição), peso ×2.
await pool.query(
  `UPDATE produto_busca pb JOIN (
     SELECT LOWER(COALESCE(NULLIF(s.nome_simplificado,''), s.nome_canonico, i.descricao_original)) k,
            COUNT(DISTINCT i.fatura_id) c
       FROM item i LEFT JOIN sku_normalizado s ON s.id = i.sku_id
      WHERE COALESCE(i.is_non_product,0)=0
        AND COALESCE(NULLIF(s.nome_simplificado,''), s.nome_canonico, i.descricao_original) IS NOT NULL
      GROUP BY k
   ) b ON LOWER(pb.nome)=b.k SET pb.popularidade = pb.popularidade + b.c*2 WHERE pb.generico=0`);
//    4c) EAN IDENTIFICADO pela casa (scan/foto ligado a um item do talão) — join limpo por EAN.
await pool.query(
  `UPDATE produto_busca pb JOIN produto_ean pe ON pe.ean = pb.ean
      SET pb.popularidade = pb.popularidade + 3 WHERE pb.generico=0 AND pe.item_id IS NOT NULL`);

// 5) tem_nutricao por EAN (off_full + produto_ean) — JOIN (a colação no lado indexado
// numa EXISTS correlacionada matava o índice → full-scan).
await pool.query(
  'UPDATE produto_busca pb JOIN off_full o ON o.ean COLLATE utf8mb4_unicode_ci = pb.ean SET pb.tem_nutricao=1 WHERE o.energia_kcal IS NOT NULL');
await pool.query(
  'UPDATE produto_busca pb JOIN produto_ean pe ON pe.ean = pb.ean SET pb.tem_nutricao=1 WHERE pe.nutricao IS NOT NULL');

const [[t]] = await pool.query('SELECT COUNT(*) tot, SUM(generico) gen, SUM(tem_nutricao) com_nut FROM produto_busca');
console.log('CONCLUIDO:', JSON.stringify(t));
await pool.end();

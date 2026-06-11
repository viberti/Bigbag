// Matching CATÁLOGO↔CATÁLOGO: herda EANs de fontes que os têm (Auchan/Continente)
// para fontes que não (Pingo Doce) → coluna catalogo_produto.ean_inferido (045).
//
// Porque funciona melhor que talão→catálogo: os nomes de catálogo são COMPLETOS
// (sem abreviaturas) e a marca vem num campo próprio. Determinístico, zero LLM:
//   1. bloqueio por MARCA normalizada — a marca tem de existir nas duas fontes
//      (exclui automaticamente marcas próprias: "Pingo Doce", "Nossa Padaria"…);
//   2. cobertura de TOKENS do nome (singularizados, sem stopwords/dígitos/marca):
//      ≥80% dos tokens do PD têm de aparecer no candidato;
//   3. só grava se TODOS os melhores empatados apontam para 1 SÓ EAN
//      (≥2 EANs empatados = tamanhos/variantes → ambíguo, não grava).
//
// ⚠ Limite conhecido: o PD não publica TAMANHO; um match único pode ser o produto
// certo noutra gramagem (outro EAN). Por isso vai para ean_inferido (referência),
// não para ean (fonte) — identidade forte continua a passar pelo operador.
//
// Uso:  node scripts/match_catalogo_eans.mjs            (dry-run, mostra números)
//       node scripts/match_catalogo_eans.mjs --aplicar  (grava ean_inferido)
//       FONTE=pingodoce ALVOS=auchan,continente COBERTURA=0.8
import { getPool } from '../src/db.js';
import { singularizar } from '../src/normaliza/categoria.js';

const APLICAR = process.argv.includes('--aplicar');
const FONTE = process.env.FONTE || 'pingodoce';
const ALVOS = (process.env.ALVOS || 'auchan,continente').split(',').map((s) => s.trim());
const COBERTURA = Number(process.env.COBERTURA || 0.8);

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/ +/g, ' ').trim();
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'para', 'em', 'e', 'a', 'o']);
const toks = (s, marca) => {
  const mb = new Set(norm(marca).split(' '));
  return [...new Set(norm(s).split(' ')
    .filter((t) => t.length >= 2 && !STOP.has(t) && !mb.has(t) && !/\d/.test(t))
    .map(singularizar))];
};

async function main() {
  const pool = getPool();
  const ph = ALVOS.map(() => '?').join(',');
  const [ac] = await pool.query(
    `SELECT ean, nome, marca, fonte FROM catalogo_produto WHERE fonte IN (${ph}) AND ean IS NOT NULL AND ean <> ''`, ALVOS);
  const [pd] = await pool.query(
    "SELECT sku_fonte, nome, marca FROM catalogo_produto WHERE fonte = ? AND marca IS NOT NULL AND marca <> ''", [FONTE]);
  const porMarca = new Map();
  for (const c of ac) {
    const m = norm(c.marca);
    if (!m) continue;
    if (!porMarca.has(m)) porMarca.set(m, []);
    porMarca.get(m).push({ ...c, t: new Set(toks(c.nome, c.marca)) });
  }
  let unico = 0, amb = 0, fraco = 0, semMarca = 0, gravados = 0;
  for (const p of pd) {
    const cands = porMarca.get(norm(p.marca));
    if (!cands) { semMarca++; continue; }
    const pt = toks(p.nome, p.marca);
    if (!pt.length) { fraco++; continue; }
    const scored = cands
      .map((c) => { let hit = 0; for (const t of pt) if (c.t.has(t)) hit++; return { c, cov: hit / pt.length }; })
      .filter((x) => x.cov >= COBERTURA)
      .sort((a, b) => b.cov - a.cov);
    if (!scored.length) { fraco++; continue; }
    const top = scored.filter((x) => x.cov >= scored[0].cov - 1e-9);
    const eans = new Set(top.map((x) => x.c.ean));
    if (eans.size !== 1) { amb++; continue; }
    unico++;
    if (APLICAR) {
      const de = `${top[0].c.fonte}:cov${Math.round(top[0].cov * 100)}`;
      await pool.query('UPDATE catalogo_produto SET ean_inferido = ?, ean_inferido_de = ? WHERE fonte = ? AND sku_fonte = ?',
        [top[0].c.ean, de, FONTE, String(p.sku_fonte)]);
      gravados++;
    }
  }
  console.log(`[match-catalogo] ${FONTE} → ${ALVOS.join('+')} (cobertura ≥${COBERTURA})`);
  console.log(`  match único: ${unico} | ambíguo (≥2 EANs): ${amb} | sem candidato: ${fraco} | marca só-${FONTE}: ${semMarca}`);
  console.log(APLICAR ? `  ✅ gravados ${gravados} em ean_inferido.` : '  (dry-run — corre com --aplicar para gravar)');
  process.exit(0);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

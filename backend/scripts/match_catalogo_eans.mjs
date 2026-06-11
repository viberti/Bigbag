// Matching CATÁLOGO↔CATÁLOGO: herda EANs de fontes que os têm (Auchan/Continente)
// para fontes que não (Pingo Doce) → coluna catalogo_produto.ean_inferido (045).
//
// Porque funciona melhor que talão→catálogo: os nomes de catálogo são COMPLETOS
// (sem abreviaturas) e a marca vem num campo próprio. Determinístico, zero LLM:
//   1. bloqueio por MARCA normalizada — a marca tem de existir nas duas fontes
//      (exclui automaticamente marcas próprias: "Pingo Doce", "Nossa Padaria"…);
//   2. cobertura de TOKENS do nome (singularizados, sem stopwords/dígitos/marca):
//      ≥80% dos tokens do PD têm de aparecer no candidato;
//   3. TAMANHO (quando ambos os lados o têm — o do PD vem da descricao_curta da
//      migração 046): resolve empates (escolhe o EAN da gramagem certa) e VETA
//      matches únicos de gramagem errada ("produto certo, outro tamanho");
//   4. só grava se os melhores sobreviventes apontam para 1 SÓ EAN.
//
// ean_inferido é referência (não identidade): vai em coluna separada do `ean` da
// fonte — identidade forte continua a passar pelo operador.
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
    `SELECT ean, nome, marca, fonte, formato_valor, unidade_base FROM catalogo_produto WHERE fonte IN (${ph}) AND ean IS NOT NULL AND ean <> ''`, ALVOS);
  const [pd] = await pool.query(
    "SELECT sku_fonte, nome, marca, formato_valor, unidade_base FROM catalogo_produto WHERE fonte = ? AND marca IS NOT NULL AND marca <> ''", [FONTE]);
  const porMarca = new Map();
  for (const c of ac) {
    const m = norm(c.marca);
    if (!m) continue;
    if (!porMarca.has(m)) porMarca.set(m, []);
    porMarca.get(m).push({ ...c, t: new Set(toks(c.nome, c.marca)) });
  }
  // tamanho "degenerado" = desconhecido (null ou o default 1un do extrator)
  const degen = (v, u) => v == null || (Number(v) === 1 && u === 'un');
  const mesmoTam = (a, b) => a.unidade_base === b.unidade_base
    && Math.abs(Number(a.formato_valor) - Number(b.formato_valor)) <= 0.02 * Math.max(Number(a.formato_valor), Number(b.formato_valor));

  if (APLICAR) await pool.query('UPDATE catalogo_produto SET ean_inferido = NULL, ean_inferido_de = NULL WHERE fonte = ?', [FONTE]); // rebuild idempotente

  let unico = 0, amb = 0, fraco = 0, semMarca = 0, gravados = 0, porTam = 0, vetoTam = 0;
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
    let top = scored.filter((x) => x.cov >= scored[0].cov - 1e-9);
    let resolvidoPorTam = false;
    if (!degen(p.formato_valor, p.unidade_base)) {
      const doTam = top.filter((x) => !degen(x.c.formato_valor, x.c.unidade_base) && mesmoTam(p, x.c));
      if (doTam.length) { resolvidoPorTam = top.length > 1 || new Set(top.map((x) => x.c.ean)).size > 1; top = doTam; }
      else if (top.every((x) => !degen(x.c.formato_valor, x.c.unidade_base))) { vetoTam++; continue; }
      // candidatos sem tamanho conhecido → segue sem o critério (como antes)
    }
    const eans = new Set(top.map((x) => x.c.ean));
    if (eans.size !== 1) { amb++; continue; }
    unico++; if (resolvidoPorTam) porTam++;
    if (APLICAR) {
      const tam = !degen(p.formato_valor, p.unidade_base) && mesmoTam(p, top[0].c) ? '+tam' : '';
      const de = `${top[0].c.fonte}:cov${Math.round(top[0].cov * 100)}${tam}`;
      await pool.query('UPDATE catalogo_produto SET ean_inferido = ?, ean_inferido_de = ? WHERE fonte = ? AND sku_fonte = ?',
        [top[0].c.ean, de, FONTE, String(p.sku_fonte)]);
      gravados++;
    }
  }
  console.log(`[match-catalogo] ${FONTE} → ${ALVOS.join('+')} (cobertura ≥${COBERTURA})`);
  console.log(`  match único: ${unico} (${porTam} desempatados pelo TAMANHO) | ambíguo (≥2 EANs): ${amb} | vetado por tamanho≠: ${vetoTam}`);
  console.log(`  sem candidato: ${fraco} | marca só-${FONTE}: ${semMarca}`);
  console.log(APLICAR ? `  ✅ gravados ${gravados} em ean_inferido.` : '  (dry-run — corre com --aplicar para gravar)');
  process.exit(0);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

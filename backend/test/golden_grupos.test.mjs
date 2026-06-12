// GOLDEN SET de regressão da classificação por grupo (revisão técnica 2026-06-12,
// prioridade 1.1). Congela 325 SKUs reais (inputs completos: nome, categoria,
// foodGroups, ouro auditado da BD pós-backfill) + 92 nomes vindos do SCAN
// (baseline do classificador-por-nome). QUALQUER mudança no vocabulário/regras de
// categoria.js aparece aqui como DIFF legível — antes, mexer nos ~190 termos só
// tinha ~10 testes pontuais de rede.
//
// Mudança INTENCIONAL (ex.: mover massa de padaria p/ mercearia):
//   1) re-correr o backfill no servidor:  node scripts/backfill_grupos.mjs
//   2) regenerar o fixture:               node scripts/gerar_golden_grupos.mjs (ver cabeçalho)
//   3) commitar fixture + código JUNTOS — o diff do fixture É a documentação da mudança.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { grupoDe, grupoDeNome, GRUPO_OUTROS } from '../src/normaliza/categoria.js';

const G = JSON.parse(readFileSync(new URL('./fixtures/golden_grupos.json', import.meta.url), 'utf8'));

// replica fiel da cadeia do backfill_grupos.mjs (fontes por força)
function classificar(c) {
  let g = grupoDe({ foodGroups: c.foodGroups || undefined, categoria: c.categoria || undefined, nome: c.nome });
  if (g === GRUPO_OUTROS && c.cat_gen) g = grupoDe({ categoria: c.cat_gen, nome: c.nome });
  return g;
}

const fmt = (difs) => difs.map((d) => `  ${d.nome}  esperado=${d.esperado}  obtido=${d.obtido}`).join('\n');

test(`golden SKUs: ${G.casos.length} casos auditados (ouro da BD)`, () => {
  const difs = [];
  for (const c of G.casos) {
    const got = classificar(c);
    if (got !== c.ouro) difs.push({ nome: c.nome, esperado: c.ouro, obtido: got });
  }
  assert.equal(difs.length, 0,
    `${difs.length} classificações de SKU mudaram vs o golden:\n${fmt(difs)}\n` +
    'Se a mudança é INTENCIONAL: backfill no servidor + regenerar fixture (ver cabeçalho deste teste).');
});

test(`golden scan: ${G.scan.length} nomes da lista/despensa (baseline por-nome)`, () => {
  const difs = [];
  for (const s of G.scan) {
    const got = grupoDeNome(s.nome);
    if (got !== s.esperado) difs.push({ nome: s.nome, esperado: s.esperado, obtido: got });
  }
  assert.equal(difs.length, 0,
    `${difs.length} classificações de nomes-de-scan mudaram vs a baseline:\n${fmt(difs)}\n` +
    '(outros→grupo costuma ser MELHORIA — confirma e regenera o fixture.)');
});

// Guardas de atribuição ao Mestre: unidade · €/base · marca-afinidade. Pura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unidadeCompativel, precoPlausivel, marcaCompativel, validarAtribuicao, nutricaoPlausivel } from '../src/normaliza/validadores.js';

// ───────── unidade ─────────
test('unidade: un vs L é incompatível (ovos vs caldo)', () => {
  assert.equal(unidadeCompativel('un', 'L'), false);
});
test('unidade: igual é compatível; sem info não bloqueia', () => {
  assert.equal(unidadeCompativel('kg', 'kg'), true);
  assert.equal(unidadeCompativel(null, 'kg'), true);
});

// ───────── €/base ─────────
test('€/base: dentro do fator (marca/dose) é plausível', () => {
  assert.equal(precoPlausivel(3.5, [2.0, 3.0, 4.0, 5.0]), true); // ~mediana
});
test('€/base: 10× a mediana é anómalo', () => {
  assert.equal(precoPlausivel(40, [3, 4, 5]), false);
});
test('€/base: sem base ou poucos pontos não bloqueia', () => {
  assert.equal(precoPlausivel(null, [3, 4, 5]), true);
  assert.equal(precoPlausivel(40, [3]), true); // só 1 ponto de referência
});

// ───────── marca → afinidade ─────────
test('marca especialista: categoria que nunca fez é suspeita', () => {
  const gallo = { azeite: 8, oleo: 2 }; // só azeite/óleo
  assert.equal(marcaCompativel('leite', gallo), false);
  assert.equal(marcaCompativel('azeite', gallo), true);
});
test('marca generalista (faz de tudo) não constrange', () => {
  const continente = { leite: 5, queijo: 4, iogurte: 3, pao: 6, fruta: 2 };
  assert.equal(marcaCompativel('detergente', continente), true);
});
test('marca com poucos dados ou desconhecida não bloqueia', () => {
  assert.equal(marcaCompativel('leite', { cafe: 1 }), true); // total < minTotal
  assert.equal(marcaCompativel('leite', null), true);
});

// ───────── combinado ─────────
test('validarAtribuicao: caldo(L) num Mestre de ovos(un) → suspeito', () => {
  const r = validarAtribuicao(
    { unidade: 'L', precoBase: 2.0, categoria: 'ovos' },
    { unidadeMestre: 'un', precosMestre: [0.3, 0.35, 0.4], afinidadeDaMarca: null },
  );
  assert.equal(r.ok, false);
  assert.ok(r.motivos.some((m) => /unidade/.test(m)));
});
test('validarAtribuicao: produto coerente → ok', () => {
  const r = validarAtribuicao(
    { unidade: 'kg', precoBase: 3.6, categoria: 'queijo gouda' },
    { unidadeMestre: 'kg', precosMestre: [3.0, 3.5, 4.0], afinidadeDaMarca: { 'queijo gouda': 4 } },
  );
  assert.equal(r.ok, true);
  assert.equal(r.motivos.length, 0);
});

test('nutricaoPlausivel (3.6): fisica do rotulo', () => {
  const ok = { energia_kcal: 359, gordura: 2, gordura_saturada: 0.5, hidratos: 71, acucares: 3.5, proteina: 13, sal: 0.01, fibra: 3 };
  assert.ok(nutricaoPlausivel(ok));                                          // massa real
  assert.ok(nutricaoPlausivel({ energia_kcal: 899, gordura: 100 }));         // azeite
  assert.ok(!nutricaoPlausivel({ energia_kcal: 3590 }));                     // OCR a juntar digitos
  assert.ok(!nutricaoPlausivel({ hidratos: 10, acucares: 50 }));             // açúcar > hidratos
  assert.ok(!nutricaoPlausivel({ gordura: 5, gordura_saturada: 30 }));       // saturada > total
  assert.ok(!nutricaoPlausivel({ proteina: 250 }));                          // >100g/100g
  assert.ok(!nutricaoPlausivel({ gordura: 60, hidratos: 60, proteina: 20 }));// soma >105
  assert.ok(!nutricaoPlausivel({}));                                         // vazio nao e nutricao
  assert.ok(!nutricaoPlausivel(null));
});

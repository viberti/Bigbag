import test from 'node:test';
import assert from 'node:assert/strict';
import { marcaEstado, pesoEstado, nomeOverlap, melhorCandidato, decidirBanda } from '../src/normaliza/matchCatalogoMeta.js';

test('marca por tokens: ordem das palavras não conta', () => {
  assert.equal(marcaEstado('Garnier Ultra Suave', 'Ultra Suave Garnier'), 'igual');
  assert.equal(marcaEstado("Elvive L'Oreal Paris", "L'Oréal Paris Elvive"), 'igual'); // acento + ordem
  assert.equal(marcaEstado('Felix', 'Purina One'), 'conflito');
  assert.equal(marcaEstado('Dr. Oetker', 'Ristorante'), 'conflito');
  assert.equal(marcaEstado('', 'Skip'), 'desc');
});

test('peso: mesma unidade e valor próximo = igual; senão difere', () => {
  assert.equal(pesoEstado(0.4, 'kg', 0.4, 'kg'), 'igual');
  assert.equal(pesoEstado(0.4, 'kg', 0.41, 'kg'), 'igual');   // ≤6%
  assert.equal(pesoEstado(0.25, 'l', 0.33, 'l'), 'difere');   // tamanhos diferentes
  assert.equal(pesoEstado(6, 'un', 0.33, 'l'), 'difere');     // unidade diferente
  assert.equal(pesoEstado(null, 'kg', 0.4, 'kg'), 'desc');
});

test('decidirBanda: gate de marca mata o lookalike de marca diferente', () => {
  const fp = { marca: 'conflito', peso: 'difere', ov: 1, score: 0.9 }; // Felix↔Purina visual alto
  assert.equal(decidirBanda(fp), 'rejeitado');
  const auto = { marca: 'igual', peso: 'igual', ov: 0.5, score: 0.85 };
  assert.equal(decidirBanda(auto), 'auto');
  const tam = { marca: 'igual', peso: 'difere', ov: 0.5, score: 0.85 };
  assert.equal(decidirBanda(tam), 'outro_tamanho');
  assert.equal(decidirBanda(null), 'sem_match');
  const fraco = { marca: 'desc', peso: 'desc', ov: 0.1, score: 0.6 };
  assert.equal(decidirBanda(fraco), 'sem_match');
});

test('melhorCandidato: prefere marca+peso a visual mais alto', () => {
  const pd = { nome: 'Iogurte Morango', marca: 'Mimosa', fval: 0.96, ubase: 'kg' };
  const meta = new Map([
    [1, { nome: 'Iogurte Lindahls', marca: 'Lindahls', fval: 0.96, ubase: 'kg' }], // visual mais alto, marca conflito
    [2, { nome: 'Iogurte Mimosa Morango', marca: 'Mimosa', fval: 0.96, ubase: 'kg' }], // marca+peso batem
  ]);
  const cands = [{ id: 1, score: 0.99 }, { id: 2, score: 0.90 }];
  const best = melhorCandidato(pd, cands, meta);
  assert.equal(best.cand.id, 2); // o corroborado vence o visual mais alto
  assert.equal(decidirBanda(best), 'auto');
});

test('nomeOverlap: tokens distintivos partilhados', () => {
  assert.ok(nomeOverlap('Bolacha Filipinos Chocolate', 'Filipinos Artiach Chocolate') >= 0.5);
  assert.equal(nomeOverlap('Copo Vidro', 'Refrigerante Cola'), 0);
});

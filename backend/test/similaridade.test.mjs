import { test } from 'node:test';
import assert from 'node:assert/strict';
import { similaridade, melhorCandidato, tokens, similaridadeTermo } from '../src/normaliza/similaridade.js';

test('variante por qualificador extra → alta similaridade', () => {
  assert.ok(similaridade('Parmigiano Reggiano', 'Parmigiano Reggiano DOP 24 Meses') >= 0.9);
  assert.ok(similaridade('Ovos de Galinha', 'Ovos de Galinha Criada no Solo') >= 0.9);
});

test('nomes iguais → 1', () => {
  assert.equal(similaridade('Natas para Culinária', 'Natas para Culinária'), 1);
});

test('cabeça partilhada mas curta NÃO casa em excesso', () => {
  // "Queijo" não deve casar fortemente com "Queijo Gouda" (1 token só)
  assert.ok(similaridade('Queijo', 'Queijo Gouda') < 0.85);
});

test('produtos diferentes → baixa', () => {
  assert.ok(similaridade('Manteiga com Sal', 'Queijo Gouda') < 0.4);
  assert.ok(similaridade('Banana', 'Mostarda Dijon') < 0.3);
});

test('stopwords e acentos ignorados', () => {
  assert.deepEqual(tokens('Ovos de Galinha'), ['ovos', 'galinha']);
  assert.ok(similaridade('Pão com Nozes', 'Pao com Nozes') === 1);
});

test('similaridadeTermo: plural/typo/truncagem casam o token certo (≥0,7)', () => {
  assert.ok(similaridadeTermo('manteigas', 'Manteiga com Sal') >= 0.7); // plural
  assert.ok(similaridadeTermo('iorgute', 'Iogurte Natural') >= 0.7); // typo
  assert.ok(similaridadeTermo('leit', 'Leite UHT Meio-Gordo') >= 0.7); // truncagem
  assert.equal(similaridadeTermo('iogurte', 'Iogurte Natural'), 1); // exato no token
});

test('similaridadeTermo: produtos diferentes NÃO casam (<0,7)', () => {
  assert.ok(similaridadeTermo('manteigas', 'Queijo Gouda') < 0.7);
  assert.ok(similaridadeTermo('banana', 'Mostarda Dijon') < 0.7);
});

test('melhorCandidato escolhe o mais parecido', () => {
  const cand = [
    { id: 1, nome_canonico: 'Queijo Gouda' },
    { id: 2, nome_canonico: 'Parmigiano Reggiano' },
    { id: 3, nome_canonico: 'Manteiga com Sal' },
  ];
  const r = melhorCandidato('Parmigiano Reggiano DOP 24 Meses', cand);
  assert.equal(r.candidato.id, 2);
  assert.ok(r.score >= 0.9);
});

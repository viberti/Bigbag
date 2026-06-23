import { test } from 'node:test';
import assert from 'node:assert';
import { verticalDaFonte, ehFarmacia } from '../src/normaliza/vertical.js';

test('farmácia (manifesto fontes_farmacia)', () => {
  for (const f of ['paguemenos', 'panvel', 'araujo', 'nissei', 'drogasil']) assert.equal(verticalDaFonte(f), 'farmacia');
  assert.ok(ehFarmacia('drogal'));
});
test('mercearia (manifesto vtex + 4 órfãos)', () => {
  assert.equal(verticalDaFonte('supernosso'), 'mercearia');
  for (const f of ['condor', 'extra', 'paodeacucar', 'superprix']) assert.equal(verticalDaFonte(f), 'mercearia');
});
test('desconhecida → outro, NUNCA farmácia', () => {
  assert.equal(verticalDaFonte('fonte_nova_nao_declarada'), 'outro');
  assert.equal(ehFarmacia('fonte_nova_nao_declarada'), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarLimitador, ipCliente } from '../src/limites.js';

test('limitador: bloqueia ao atingir o máximo de falhas e liberta após a janela', () => {
  const l = criarLimitador({ max: 3, janelaMs: 1000 });
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i++) { assert.equal(l.bloqueado('a', t0), false); l.falhou('a', t0); }
  assert.equal(l.bloqueado('a', t0 + 10), true);
  assert.equal(l.bloqueado('b', t0 + 10), false, 'chaves independentes');
  assert.equal(l.bloqueado('a', t0 + 1001), false, 'janela deslizante expira');
});
test('limitador: limpar (login certo) zera a chave', () => {
  const l = criarLimitador({ max: 1, janelaMs: 1000 });
  l.falhou('x'); assert.equal(l.bloqueado('x'), true); l.limpar('x'); assert.equal(l.bloqueado('x'), false);
});
test('ipCliente: usa o ÚLTIMO X-Forwarded-For (o que o Apache acrescenta), não o forjável', () => {
  const req = (xff, ip = '127.0.0.1') => ({ get: (h) => (h === 'X-Forwarded-For' ? xff : undefined), ip });
  assert.equal(ipCliente(req('6.6.6.6, 203.0.113.9')), '203.0.113.9');
  assert.equal(ipCliente(req('203.0.113.9')), '203.0.113.9');
  assert.equal(ipCliente(req(undefined)), '127.0.0.1');
});

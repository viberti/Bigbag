// Memória de longo prazo: guardar e carregar fatos do perfil (sem duplicar).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool } from '../src/db.js';
import { guardarFato, carregarPerfil, esquecerFato } from '../src/perfil.js';

const pool = getPool();
const U = 'ZZPERFIL';

after(async () => {
  await pool.query('DELETE FROM perfil WHERE utilizador = ?', [U]);
  await closePool();
});

test('guarda fatos e carrega o perfil; não duplica', async () => {
  await guardarFato(U, 'É vegetariano.');
  await guardarFato(U, 'Prefere comprar no Continente.');
  await guardarFato(U, 'É vegetariano.'); // duplicado → ignorado
  const p = await carregarPerfil(U);
  assert.equal(p.length, 2);
  assert.ok(p.includes('É vegetariano.'));
  assert.ok(p.includes('Prefere comprar no Continente.'));
});

test('esquecer remove o fato', async () => {
  await esquecerFato(U, 'É vegetariano.');
  const p = await carregarPerfil(U);
  assert.ok(!p.includes('É vegetariano.'));
  assert.equal(p.length, 1);
});

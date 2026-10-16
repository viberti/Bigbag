import { test } from 'node:test';
import assert from 'node:assert/strict';
import { semRotuloDeSeccao as f } from '../src/normaliza/canonical.js';

test('rótulo de secção inventado à frente do nome sai (caso real Mercadona)', () => {
  assert.equal(f('Laticínios + Proteínas Natural', '+ PROTEINAS NATURAL'), 'Proteínas Natural');
  assert.equal(f('Mercearia Salgada Grão', 'GRAO COZIDO'), 'Grão');
  assert.equal(f('Talho Bife de Vaca', 'BIFE VACA'), 'Bife de Vaca');
});
test('fica quando o rótulo está mesmo no talão ou faz parte do produto', () => {
  assert.equal(f('Charcutaria Variada', 'CHARCUTARIA VARIADA'), 'Charcutaria Variada');
  assert.equal(f('Leite Meio Gordo', 'LEITE MG'), 'Leite Meio Gordo');
  assert.equal(f('Frutas', 'FRUTAS'), 'Frutas');
});

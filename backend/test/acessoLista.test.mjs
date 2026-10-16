import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotaPermitidaLista as ok } from '../src/auth.js';

test('link da casa: abre as rotas da lista', () => {
  for (const [m, c] of [['GET', '/api/me'], ['GET', '/api/lista'], ['POST', '/api/lista'], ['PATCH', '/api/lista/12'],
    ['DELETE', '/api/lista/12'], ['GET', '/api/lista/habituais'], ['POST', '/api/lista/concluir'], ['GET', '/api/perfil'],
    ['GET', '/api/produto/autocomplete?q=ov&modo=lista'], ['GET', '/api/produto/consultar?ean=1&pt=1'], ['POST', '/api/voz/lista']]) {
    assert.equal(ok(m, c), true, `${m} ${c}`);
  }
});
test('link da casa: NÃO abre o resto do BigBag', () => {
  for (const [m, c] of [['GET', '/api/faturas'], ['POST', '/api/faturas'], ['GET', '/api/admin/custos'], ['POST', '/api/perfil'],
    ['PUT', '/api/perfil/1'], ['GET', '/api/perfil/1/saude'], ['POST', '/api/voz'], ['POST', '/api/consulta'], ['GET', '/api/produto/info?ean=1'],
    ['GET', '/api/listas'], ['GET', '/api/lista-secreta']]) {
    assert.equal(ok(m, c), false, `${m} ${c}`);
  }
});

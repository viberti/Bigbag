import test from 'node:test';
import assert from 'node:assert/strict';
import { urlTabNutricional, extrairNutricaoContinente } from '../src/ingest/nutricaoContinente.js';

// fragmento sintético com a estrutura real do separador (nutrients-row + ingredients)
const cell = (v) => `<div class="nutriInfo-details col-4 nutrients-cell">${v}</div>`;
const row = (n, v, u) => `<div class="nutrients-row row">${cell(n)}${cell(v)}${cell(u)}</div>`;
const FRAG_G = `
  <div class="ingredients"><p class="mb-0">Declara&ccedil;&atilde;o de Ingredientes:</p>
    <p class="mb-20">Farinha de TRIGO, &aacute;gua, ovos 18%.</p></div>
  <div class="nutrients-header">${cell('Nutriente')}${cell('Quantidade')}${cell('Unidade')}</div>
  ${row('energia', '1132,0', '(KJO) Quilojoule')}
  ${row('energia', '267,0', '(E14) Quilocaloria')}
  ${row('l&iacute;pidos', '2,4', '(GRM) Grama')}
  ${row('l&iacute;pidos saturados', '0,7', '(GRM) Grama')}
  ${row('hidratos de carbono', '50,0', '(GRM) Grama')}
  ${row('hidratos de carbono a&ccedil;&uacute;cares', '1,0', '(GRM) Grama')}
  ${row('prote&iacute;nas', '10,0', '(GRM) Grama')}
  ${row('sal', '0,05', '(GRM) Grama')}`;

test('extrai nutrição (kcal, não kJ), base g e ingredientes', () => {
  const r = extrairNutricaoContinente(FRAG_G);
  assert.equal(r.nutricao.energia_kcal, 267); // 267 kcal, NÃO 1132 kJ
  assert.equal(r.nutricao.gordura, 2.4);
  assert.equal(r.nutricao.gordura_saturada, 0.7);
  assert.equal(r.nutricao.hidratos, 50);
  assert.equal(r.nutricao.acucares, 1);
  assert.equal(r.nutricao.proteina, 10);
  assert.equal(r.nutricao.sal, 0.05);
  assert.equal(r.nutricao_base, 'por 100 g');
  assert.match(r.ingredientes, /^Ingredientes: Farinha de TRIGO/);
  assert.ok(!/Declara/.test(r.ingredientes)); // o rótulo não entra no texto
});

test('base ml quando a unidade é mililitro', () => {
  const frag = `${row('energia', '236,0', '(E14) Quilocaloria')} <span>(MLT) Mililitro</span>`;
  assert.equal(extrairNutricaoContinente(frag).nutricao_base, 'por 100 ml');
});

test('produto sem tabela → tudo null (best-effort)', () => {
  const r = extrairNutricaoContinente('<div class="ingredients"><p>Declaração de Ingredientes:</p><p>Tomate 100%.</p></div>');
  assert.equal(r.nutricao, null);
  assert.equal(r.nutricao_base, null);
  assert.match(r.ingredientes, /Tomate 100%/);
  assert.equal(extrairNutricaoContinente('').nutricao, null);
});

test('urlTabNutricional extrai e desofusca &amp;', () => {
  const page = '<a data-url="https://x/Product-ProductNutritionalInfoTab?pid=5&amp;ean=84&amp;enabledce=true">tab</a>';
  assert.equal(urlTabNutricional(page), 'https://x/Product-ProductNutritionalInfoTab?pid=5&ean=84&enabledce=true');
  assert.equal(urlTabNutricional('<div>sem separador</div>'), null);
});

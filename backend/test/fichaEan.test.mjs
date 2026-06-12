// Testes do RESOLVEDOR ÚNICO da ficha por EAN (helpers puros) — casos REAIS da
// sessão de scans 2026-06-12/13 congelados como regressão do desenho.
import test from 'node:test';
import assert from 'node:assert/strict';
import { limparNomeProduto, escolherNome, escolherIngredientes, escolherAlergenios } from '../src/normaliza/fichaEan.js';

test('limparNomeProduto: marca e formato saem; nunca esvazia', () => {
  assert.equal(limparNomeProduto('Massa Penne Rigate Barilla', 'Barilla'), 'Massa Penne Rigate');
  assert.equal(limparNomeProduto('Massa Barilla Penne Rigate 500g', 'Barilla'), 'Massa Penne Rigate');
  assert.equal(limparNomeProduto('Leite UHT Mimosa 1L', 'Mimosa'), 'Leite UHT');
  assert.equal(limparNomeProduto('Iogurtes Skyr x4 Continente', 'Continente'), 'Iogurtes Skyr');
  // marca É o nome → não esvazia
  assert.equal(limparNomeProduto('Nutella', 'Nutella'), 'Nutella');
  // marca composta limpa as duas partes
  assert.equal(limparNomeProduto('Conchiglioni Arrighi', 'Arrighi, Pasta Berruto'), 'Conchiglioni');
  // QUANTIDADE embutida no nome (regra geral do dono, 2026-06-14 — caso Pyramid):
  // par número+unidade-de-contagem e unidade órfã no fim saem
  assert.equal(limparNomeProduto('Chá Preto Lipton Pyramid Limao 20 Saq', 'Lipton'), 'Chá Preto Pyramid Limao');
  assert.equal(limparNomeProduto('Infusão Camomila Pyramid Saquetas', null), 'Infusão Camomila Pyramid');
  assert.equal(limparNomeProduto('Café 10 Cápsulas', null), 'Café');
  // falsos positivos protegidos: número NO MEIO é nome; cabeça legítima fica
  assert.equal(limparNomeProduto('Pão 7 Sementes', null), 'Pão 7 Sementes');
  assert.equal(limparNomeProduto('Pizza 4 Queijos', null), 'Pizza 4 Queijos');
  assert.equal(limparNomeProduto('Folhas de Louro', null), 'Folhas de Louro');
  // número solto no FIM é quantidade pendurada
  assert.equal(limparNomeProduto('Chá Lipton 20', 'Lipton'), 'Chá');
});

test('escolherNome: o caso Barilla COLAPSA após limpeza (decisão do dono)', () => {
  const nome = escolherNome([
    { texto: limparNomeProduto('Massa Penne Rigate Barilla', 'Barilla'), fonte: 'continente', traduzido: false },
    { texto: limparNomeProduto('Massa Barilla Penne Rigate 500g', 'Barilla'), fonte: 'auchan', traduzido: false },
  ]);
  assert.equal(nome, 'Massa Penne Rigate'); // iguais depois de limpos — sem arbitragem
});

test('escolherNome: consenso vence órfãos de marketing; nativo vence traduzido', () => {
  // tokens "No. 73 Durum Wheat" só numa fonte → penalizados
  const nome = escolherNome([
    { texto: 'Penne Rigate No 73 Durum Wheat Semolina Pasta', fonte: 'off', traduzido: false },
    { texto: 'Massa Penne Rigate', fonte: 'continente', traduzido: false },
    { texto: 'Massa Penne Rigate', fonte: 'auchan', traduzido: false },
  ]);
  assert.equal(nome, 'Massa Penne Rigate');
  // nativo > nome_pt traduzido por léxico (a igualdade de resto)
  const n2 = escolherNome([
    { texto: 'Iogurte Grego Natural', fonte: 'mercadona', traduzido: true },
    { texto: 'Iogurte Grego Natural', fonte: 'continente', traduzido: false },
  ]);
  assert.equal(n2, 'Iogurte Grego Natural'); // colapsam; grafia do nativo
});

test('escolherAlergenios: PT traduzido vence tags cruas e estrangeiro (alertas trabalham em PT)', () => {
  assert.equal(escolherAlergenios([
    { texto: 'en:milk', fonte: 'off' },
    { texto: 'Leite', fonte: 'anterior' },
  ]).texto, 'Leite');
  assert.equal(escolherAlergenios([
    { texto: 'Leche', fonte: 'vlm' },
    { texto: 'Leite', fonte: 'anterior' },
  ]).texto, 'Leite');
  // só há cru → fica o cru (nunca esvaziar)
  assert.equal(escolherAlergenios([{ texto: 'en:soybeans', fonte: 'off' }]).texto, 'en:soybeans');
  assert.equal(escolherAlergenios([{ texto: '', fonte: 'off' }]), null);
});

test('escolherIngredientes: "Água, grãos de soja" PT vence ES igual em tamanho (ã/õ marcam PT)', () => {
  const e = escolherIngredientes([
    { texto: 'Agua, 16% habas de _soja_, _trigo_, sal.', fonte: 'off' },
    { texto: 'Água, 16% grãos de _soja_, _trigo_, sal.', fonte: 'anterior' },
  ]);
  assert.equal(e.fonte, 'anterior');
});

test('escolherIngredientes: lixo-OCR e estrangeiro perdem (achados do 1.º backfill)', () => {
  // OCR do OFF-dump vencia por comprimento: "PASTA Dl Wou Dl GRANO DURO…"
  const e1 = escolherIngredientes([
    { texto: 'PASTA Dl Wou Dl GRANO DURO/ SEMOLINA PASTA/ AlliiENTAlRES DE Bit OUR Q EBLE DUR/ TllGc IciP CAHHTC BgN', fonte: 'off-dump' },
    { texto: 'MASSA DE SÊMOLA DE TRIGO DURO/ MASSA DE SEMOLINA/ ALIMENTOS DE QUALIDADE', fonte: 'off' },
  ]);
  assert.equal(e1.fonte, 'off');
  // ES vencia o PT por uns chars a mais
  const e2 = escolherIngredientes([
    { texto: 'Semola integral de trigo duro (gluten). Puede contener trazas de huevos y soja.', fonte: 'off-dump' },
    { texto: 'Sêmola integral de trigo duro (glúten). Pode conter traços de ovos.', fonte: 'off' },
  ]);
  assert.equal(e2.fonte, 'off');
});

test('escolherIngredientes: o MAIS COMPLETO vence (caso Penne: Auchan c/ alergénios)', () => {
  const e = escolherIngredientes([
    { texto: 'Sêmola de trigo duro, água.', fonte: 'off' },
    { texto: 'Ingredientes: Sêmola de TRIGO duro e água. Contém glúten. Pode conter vestígios de ovos se produzido na fábrica assinalada com a letra (A).', fonte: 'catalogo:auchan' },
  ]);
  assert.equal(e.fonte, 'catalogo:auchan');
  // sem candidatos válidos → null
  assert.equal(escolherIngredientes([{ texto: '', fonte: 'off' }]), null);
});

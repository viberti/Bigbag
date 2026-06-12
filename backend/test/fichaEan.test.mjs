// Testes do RESOLVEDOR ÚNICO da ficha por EAN (helpers puros) — casos REAIS da
// sessão de scans 2026-06-12/13 congelados como regressão do desenho.
import test from 'node:test';
import assert from 'node:assert/strict';
import { limparNomeProduto, escolherNome, escolherIngredientes } from '../src/normaliza/fichaEan.js';

test('limparNomeProduto: marca e formato saem; nunca esvazia', () => {
  assert.equal(limparNomeProduto('Massa Penne Rigate Barilla', 'Barilla'), 'Massa Penne Rigate');
  assert.equal(limparNomeProduto('Massa Barilla Penne Rigate 500g', 'Barilla'), 'Massa Penne Rigate');
  assert.equal(limparNomeProduto('Leite UHT Mimosa 1L', 'Mimosa'), 'Leite UHT');
  assert.equal(limparNomeProduto('Iogurtes Skyr x4 Continente', 'Continente'), 'Iogurtes Skyr');
  // marca É o nome → não esvazia
  assert.equal(limparNomeProduto('Nutella', 'Nutella'), 'Nutella');
  // marca composta limpa as duas partes
  assert.equal(limparNomeProduto('Conchiglioni Arrighi', 'Arrighi, Pasta Berruto'), 'Conchiglioni');
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

test('escolherIngredientes: o MAIS COMPLETO vence (caso Penne: Auchan c/ alergénios)', () => {
  const e = escolherIngredientes([
    { texto: 'Sêmola de trigo duro, água.', fonte: 'off' },
    { texto: 'Ingredientes: Sêmola de TRIGO duro e água. Contém glúten. Pode conter vestígios de ovos se produzido na fábrica assinalada com a letra (A).', fonte: 'catalogo:auchan' },
  ]);
  assert.equal(e.fonte, 'catalogo:auchan');
  // sem candidatos válidos → null
  assert.equal(escolherIngredientes([{ texto: '', fonte: 'off' }]), null);
});

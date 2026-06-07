// Chave determinística do Produto Mestre — limpeza + normalização + portões.
// Os casos espelham as experiências (kefir, MG/M-G, fonte=vaca, gouda fatiado…).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limparDescricao, chaveMestre } from '../src/normaliza/mestre.js';

// ───────── limpeza ─────────
test('limpa prefixo de quantidade', () => {
  assert.equal(limparDescricao('1 PREPAR. CARNE PORCO'), 'PREPAR. CARNE PORCO');
});
test('limpa linha de peso colada', () => {
  assert.equal(limparDescricao('BANANA B kg x1,670 1,19 EUR/kg'), 'BANANA');
  assert.equal(limparDescricao('PEITO DE FRANGO B kg x0,564 6,59 EUR/kgEUR'), 'PEITO DE FRANGO');
});
test('limpa código de IVA no início e fim', () => {
  assert.equal(limparDescricao('(A) BOVINO FRALDINHA AM SUL LS'), 'BOVINO FRALDINHA AM SUL LS');
  assert.equal(limparDescricao('RUCULA SELVAGEM B'), 'RUCULA SELVAGEM');
  assert.equal(limparDescricao('C SALADA PREMIUM 200G'), 'SALADA PREMIUM 200G');
});
test('NÃO confunde unidade " G" (gramas) com código IVA', () => {
  assert.equal(limparDescricao('MIRTILO 500 G'), 'MIRTILO 500 G');
});
test('tira peso pesado "N,NNN kg" mas mantém pack "500 G"', () => {
  assert.equal(limparDescricao('BANANA 2,880 kg'), 'BANANA');
  assert.equal(limparDescricao('1 LARANJA 1,250 kg'), 'LARANJA');
  assert.equal(limparDescricao('MIRTILO 500 G'), 'MIRTILO 500 G'); // pack em gramas fica
});
test('idempotente: prefixos empilhados são todos removidos numa passagem', () => {
  assert.equal(limparDescricao('1 1 BANANA'), 'BANANA');
  assert.equal(limparDescricao('(A) 1 BANANA'), 'BANANA');
  assert.equal(limparDescricao(limparDescricao('1 BANANA')), limparDescricao('1 BANANA')); // estável
});

// ───────── normalização de valores ─────────
test('teor: M/G e meio-gordo dão a mesma chave', () => {
  assert.equal(chaveMestre({ categoria: 'leite', teor: 'M/G' }), chaveMestre({ categoria: 'leite', teor: 'meio-gordo' }));
});
test('teor: ligeiro → magro', () => {
  assert.equal(chaveMestre({ categoria: 'iogurte grego', teor: 'ligeiro' }), chaveMestre({ categoria: 'iogurte grego', teor: 'magro' }));
});
test('variedade: royal gala → gala (mesmo Mestre)', () => {
  assert.equal(chaveMestre({ categoria: 'maca', variedade: 'Royal Gala' }), chaveMestre({ categoria: 'maca', variedade: 'gala' }));
});

// ───────── defaults de portão (§11.3) ─────────
test('fonte=vaca é default → NÃO parte o Mestre (vaca ≡ null)', () => {
  const comVaca = chaveMestre({ categoria: 'leite', teor: 'meio-gordo', fonte: 'vaca' });
  const semFonte = chaveMestre({ categoria: 'leite', teor: 'meio-gordo' });
  assert.equal(comVaca, semFonte);
});
test('fonte=cabra/ovelha DISCRIMINA (não é default)', () => {
  const cabra = chaveMestre({ categoria: 'queijo', fonte: 'cabra' });
  const vaca = chaveMestre({ categoria: 'queijo', fonte: 'vaca' });
  assert.notEqual(cabra, vaca);
});

// ───────── portões: apresentação separa (regra do dono) ─────────
test('Gouda fatiado ≠ Gouda inteiro (apresentação é portão)', () => {
  assert.notEqual(
    chaveMestre({ categoria: 'queijo gouda', apresentacao: 'fatiado' }),
    chaveMestre({ categoria: 'queijo gouda', apresentacao: 'inteiro' }),
  );
});
test('peito ≠ lombinho (corte é portão)', () => {
  assert.notEqual(
    chaveMestre({ categoria: 'frango', corte: 'peito' }),
    chaveMestre({ categoria: 'frango', corte: 'lombinho' }),
  );
});

test('string "null" do LLM é tratada como vazio (não polui a chave)', () => {
  const k = chaveMestre({ categoria: 'null', teor: 'NULL', sabor: 'morango' });
  assert.equal(k, ['', '', '', '', '', 'morango', '', '', '', ''].join('|'));
});

// ───────── canonicalização de queijo (denominação consistente) ─────────
test('queijo: "queijo gouda", "gouda" e queijo+variedade=gouda dão a mesma denominação', () => {
  const a = chaveMestre({ categoria: 'queijo gouda', apresentacao: 'fatiado' });
  const b = chaveMestre({ categoria: 'gouda', apresentacao: 'fatiado' });
  const c = chaveMestre({ categoria: 'queijo', variedade: 'gouda', apresentacao: 'fatiado' });
  assert.equal(a, b);
  assert.equal(a, c);
});
test('queijo: ortografia mozarela ≡ mozzarella', () => {
  assert.equal(chaveMestre({ categoria: 'queijo mozarela' }), chaveMestre({ categoria: 'mozzarella' }));
});
test('queijo: DOP é tirado do nome (serra da estrela)', () => {
  assert.equal(
    chaveMestre({ categoria: 'queijo serra da estrela dop', fonte: 'ovelha' }),
    chaveMestre({ categoria: 'queijo serra da estrela', fonte: 'ovelha' }),
  );
});
test('queijo: apresentação separa (gouda fatiado ≠ gouda bola)', () => {
  assert.notEqual(
    chaveMestre({ categoria: 'queijo gouda', apresentacao: 'fatiado' }),
    chaveMestre({ categoria: 'queijo gouda', apresentacao: 'bola' }),
  );
});
test('queijo: exceções mantêm categoria própria (requeijão ≠ queijo)', () => {
  const k = chaveMestre({ categoria: 'requeijao', fonte: 'ovelha' });
  assert.ok(k.startsWith('requeijao|'));
});

// ───────── agrupamento correto: mesmas descrições → mesma chave ─────────
test('Iogurte Grego Natural em marcas/formatos diferentes → mesma chave', () => {
  const a = chaveMestre({ categoria: 'iogurte grego', estilo: 'grego', sabor: 'natural' });
  const b = chaveMestre({ categoria: 'iogurte grego', sabor: 'natural', estilo: 'GREG' });
  assert.equal(a, b);
});
test('produtos diferentes → chaves diferentes (não sobre-une)', () => {
  assert.notEqual(chaveMestre({ categoria: 'banana' }), chaveMestre({ categoria: 'kiwi' }));
  assert.notEqual(
    chaveMestre({ categoria: 'iogurte grego', sabor: 'natural' }),
    chaveMestre({ categoria: 'iogurte grego', sabor: 'coco' }),
  );
});

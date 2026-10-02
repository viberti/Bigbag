import test from 'node:test';
import assert from 'node:assert/strict';
import { decidirNome, interpretarOpiniao, familiaModelo, mesmaFamilia, montarPromptOpiniao, semelhanca, SEMELHANCA_MIN_CORRECAO } from '../src/ingest/verificarNomes.js';
import { config } from '../src/config.js';

test('duas leituras iguais → confirmado (normalização tolerante)', () => {
  assert.equal(decidirNome({ lido: 'SALADA RIVA', opiniao: 'Salada Riva' }).resultado, 'confirmado');
});

test('leituras divergem + catálogo confirma a opinião → corrigido', () => {
  const d = decidirNome({ lido: 'SALARA RISO', opiniao: 'SALADA RIVA', scoreLido: 0, scoreOpiniao: 1 });
  assert.equal(d.resultado, 'corrigido');
  assert.equal(d.nome, 'SALADA RIVA');
});

test('leituras divergem SEM confirmação do catálogo → fica o lido, em dúvida', () => {
  const d = decidirNome({ lido: 'SALARA RISO', opiniao: 'SALANA RIVO', scoreLido: 0, scoreOpiniao: 0.3 });
  assert.equal(d.resultado, 'duvida');
  assert.equal(d.nome, 'SALARA RISO');
});

test('opinião tem de ser CLARAMENTE melhor que o lido (margem 0.1)', () => {
  assert.equal(decidirNome({ lido: 'A', opiniao: 'B', scoreLido: 0.6, scoreOpiniao: 0.65 }).resultado, 'duvida');
});

test('sem 2.ª opinião (null) → dúvida, nunca inventa', () => {
  assert.equal(decidirNome({ lido: 'X', opiniao: null }).resultado, 'duvida');
  assert.equal(decidirNome({ lido: 'X', opiniao: 'null' }).resultado, 'duvida');
});

// --- falha visível: resposta não interpretável LANÇA (vira 'nao_verificado'), nunca [] mudo
test('interpretarOpiniao: JSON válido (com cercas ```json) → array de nomes', () => {
  assert.deepEqual(interpretarOpiniao('```json\n{"nomes": ["SALADA RIVA", null]}\n```'), ['SALADA RIVA', null]);
  assert.deepEqual(interpretarOpiniao({ content: 'ok: {"nomes":["A"]}' }), ['A']);
});

test('interpretarOpiniao: resposta vazia / sem JSON / sem "nomes" → lança (não devolve [])', () => {
  assert.throws(() => interpretarOpiniao(''));
  assert.throws(() => interpretarOpiniao('não consigo ler a imagem'));
  assert.throws(() => interpretarOpiniao('{"names": ["A"]}'));
  assert.throws(() => interpretarOpiniao('{"nomes": "A"}'));
});

// --- independência: o verificador por omissão é de OUTRA família que o extrator
test('famílias de modelo pelo prefixo do OpenRouter', () => {
  assert.equal(familiaModelo('google/gemini-3.7-flash'), 'google');
  assert.ok(mesmaFamilia('google/gemini-3.7-flash', 'google/gemini-3-flash-preview'));
  assert.ok(!mesmaFamilia('google/gemini-3.7-flash', 'openai/gpt-4.1-mini'));
  assert.ok(!mesmaFamilia('', ''));
});

// (o config lê o env ao importar; nos testes puros não há .env → valem os defaults)
test('config: verificador NÃO é da família do extrator', () => {
  const { modelVerificacao, modelExtracao } = config.openrouter;
  assert.match(modelVerificacao, /^[a-z0-9-]+\/.+/, 'id OpenRouter "fornecedor/modelo"');
  assert.ok(!mesmaFamilia(modelVerificacao, modelExtracao), `${modelVerificacao} vs ${modelExtracao}`);
});

// --- prompt CEGO: a 1.ª leitura NÃO pode ir no prompt (ancorava o verificador no erro)
test('montarPromptOpiniao: não revela o nome lido; âncora = preço (+ ordinal se repetido)', () => {
  const p = montarPromptOpiniao([
    { descricao_original: 'DOLA OKA LAMINADA ENT 400G', preco_liquido: 1.29, ordem_preco: 1, n_mesmo_preco: 1 },
    { descricao_original: 'LAY SKYR SOL', preco_liquido: '1.65', ordem_preco: 2, n_mesmo_preco: 3 },
  ]);
  assert.ok(!/DOLA|OKA|SKYR|lemos/i.test(p), 'a leitura 1 não aparece');
  assert.match(p, /1\. a linha com o preço 1,29 €\n/);
  assert.match(p, /2\. a linha com o preço 1,65 € \(a 2\.ª de 3 linhas com este preço/);
});

// --- salvaguardas contra a opinião de OUTRA linha (casos reais do banco de provas 2026-09-29):
// o catálogo "confirma" qualquer produto real, por isso sozinho gravava o nome errado.
test('opinião = nome de OUTRA linha do talão → dúvida, mesmo com hit forte no catálogo', () => {
  const d = decidirNome({
    lido: 'AMO QJ MOZZARELA FATIAS 1 KG', opiniao: 'TOMATE PELADO 800G MUT', scoreLido: 0, scoreOpiniao: 0.95,
    outrosNomes: ['TOMATE PELADO 800G MUT', 'MARTINI BIANCO 1 LT'],
  });
  assert.equal(d.resultado, 'duvida');
  assert.equal(d.nome, 'AMO QJ MOZZARELA FATIAS 1 KG');
});

test('opinião que não se parece com o lido (outra linha fora da lista) → dúvida', () => {
  const d = decidirNome({ lido: 'CBIPACK ESCOVA CUIDASENSODYNE', opiniao: 'SALMAO FUMADO NORUEGA CONT SELE', scoreOpiniao: 0.9 });
  assert.equal(d.resultado, 'duvida');
  assert.equal(d.motivo, 'leitura_distante');
});

test('limiar de semelhança separa releituras legítimas de trocas de linha', () => {
  const legitimas = [['REAM CRACKER', 'CREAM CRACKER'], ['ROCULA', 'RÚCULA'], ['SALARA RISO', 'SALADA RIVA'],
    ['DOLA OKA LAMINADA ENT 400G', 'CEBOLA ROXA LAMINADA CNT 400G'], ['LAY SKYR SOL ENT EQ NATURAL 400G', 'SKYR SOL CNT EQ NATURAL 400G']];
  const trocas = [['LAY SKYR SOL ENT EQ NATURAL 400G', 'CLARA OVO PASTEURIZADA CNT 1KG'], ['CREME SOLAR SPORT', 'HAMBURGER DE BOVINO'],
    ['LAY SKYR SOL ENT EQ NATURAL 400G', 'CAFE SOL CRU EQ NATURAL 80GR'], ['V.ALD.JUROMENHA SYRAH T*75CL', 'MC QJ MOZZARELLA FATIADO 500G']];
  for (const [a, b] of legitimas) assert.ok(semelhanca(a, b) >= SEMELHANCA_MIN_CORRECAO, `${a}→${b}`);
  for (const [a, b] of trocas) assert.ok(semelhanca(a, b) < SEMELHANCA_MIN_CORRECAO, `${a}→${b}`);
  // e a correção legítima continua a passar quando o catálogo a confirma
  assert.equal(decidirNome({ lido: 'DOLA OKA LAMINADA ENT 400G', opiniao: 'CEBOLA ROXA LAMINADA CNT 400G', scoreOpiniao: 0.9 }).resultado, 'corrigido');
});

test('código de IVA "(A) " na opinião é ignorado', () => {
  assert.equal(decidirNome({ lido: 'QJ RICOTTA CNT 250G', opiniao: '(A) QJ RICOTTA CNT 250G' }).resultado, 'confirmado');
  const d = decidirNome({ lido: 'REAM CRACKER', opiniao: '(C) CREAM CRACKER', scoreOpiniao: 0.9 });
  assert.deepEqual([d.resultado, d.nome], ['corrigido', 'CREAM CRACKER']);
});

test('interpretarOpiniao: nº de nomes ≠ nº de linhas pedidas → lança (desalinhado, não dúvidas falsas)', () => {
  assert.deepEqual(interpretarOpiniao('{"nomes":["A","B"]}', 2), ['A', 'B']);
  assert.throws(() => interpretarOpiniao('{"nomes":["A","B","C"]}', 4), /3 nomes para 4 linhas/);
  assert.throws(() => interpretarOpiniao('{"nomes":["A","B"]}', 1));
});

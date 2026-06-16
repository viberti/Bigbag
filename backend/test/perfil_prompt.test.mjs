import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perfilParaTexto } from '../src/ingest/perfil.js';

test('perfilParaTexto: bloco etiquetado com todas as secções do editor', () => {
  const txt = perfilParaTexto({
    objetivos: ['Reduzir colesterol (LDL)'],
    condicoes: ['Menopausa', 'Pré-diabetes'],
    restricoes: ['Mediterrânea'],
    preferir: ['Peixe gordo'],
    evitar: ['Açúcar adicionado'],
    metas: ['+ Proteína', '− Sódio'],
    alergias: ['Amendoim'],
    intolerancias: [],
    nutrientes: {},
    notas: null,
  });
  // os grupos que o prompt antes NÃO nomeava têm de aparecer nomeados
  assert.match(txt, /Condições de saúde: Menopausa; Pré-diabetes/);
  assert.match(txt, /Preferir \/ incluir: Peixe gordo/);
  assert.match(txt, /Metas de nutrientes: \+ Proteína; − Sódio/); // as metas do editor NÃO se perdem
  assert.match(txt, /Alergias: Amendoim/);
  // secções vazias/nulas não geram linha (sem ruído "intolerancias: []", "notas: null")
  assert.doesNotMatch(txt, /Intolerâncias/);
  assert.doesNotMatch(txt, /Notas/);
  assert.doesNotMatch(txt, /\[\]|null|\{\}/);
});

test('perfilParaTexto: une metas do editor (array) com nutrientes do texto (objeto)', () => {
  const txt = perfilParaTexto({
    metas: ['+ Proteína'],
    nutrientes: { sodio: { objetivo: 'reduzir', limite: '2 g/dia' }, fibra: { objetivo: 'aumentar', alvo: '30 g' } },
  });
  assert.match(txt, /Metas de nutrientes:/);
  assert.match(txt, /\+ Proteína/);       // do editor
  assert.match(txt, /− sodio \(2 g\/dia\)/); // do objeto nutrientes (texto)
  assert.match(txt, /\+ fibra \(30 g\)/);
});

test('perfilParaTexto: perfil vazio/ausente é honesto (não inventa)', () => {
  assert.equal(perfilParaTexto(null), 'SEM PERFIL');
  assert.equal(perfilParaTexto({}), 'PERFIL SEM CARACTERÍSTICAS DEFINIDAS');
  assert.equal(perfilParaTexto({ objetivos: [], evitar: [] }), 'PERFIL SEM CARACTERÍSTICAS DEFINIDAS');
});

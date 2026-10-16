// SIMULADOR da app "Lista": mostra, linha a linha, como produtos REAIS da casa aparecem
// no ecrã — sem gravar nada na lista. Fontes de entrada (como um utilizador as usaria):
//   hab  = produtos habituais (o que a casa compra)        → chips "talvez precise de"
//   esc  = texto ESCRITO tal e qual (Enter sem escolher)
//   ac1  = 1.ª sugestão do autocomplete para esse texto     (o toque mais provável)
// Passa tudo por resolverItensLista (o MESMO do GET /api/lista) e pelas funções de
// apresentação da app (listaFormato.js / produtoDisplay.js). Saída: TSV legível.
// Uso: sudo -u dev node --env-file=.env scripts/simular_lista.mjs [--json] > /tmp/sim.tsv
import { getPool, closePool } from '../src/db.js';
import { resolverItensLista, generalizar } from '../src/routes/lista.js';
import { produtos_habituais } from '../src/queries.js';
import { secDe, fmtTamanho, precoLista, qtdTxt } from '../../frontend/src/listaFormato.js';
import { limparMarca, nomeTalao } from '../../frontend/src/produtoDisplay.js';

// o que se costuma ESCREVER numa lista de mercado (PT), incl. o caso relatado
const ESCRITOS = [
  'carne picada bovina', 'carne picada', 'frango', 'peito de frango', 'bife de peru', 'febras de porco', 'salsichas',
  'fiambre', 'presunto', 'chouriço', 'bacalhau', 'salmão', 'pescada', 'atum', 'sardinhas',
  'leite', 'leite meio gordo', 'iogurte natural', 'iogurtes', 'queijo', 'queijo fresco', 'manteiga', 'natas', 'ovos', 'ovos m',
  'pão', 'pão de forma', 'broa', 'tostas',
  'banana', 'bananas', 'maçã', 'laranjas', 'limão', 'tomate', 'tomate cherry', 'alface', 'cebola', 'alho', 'batata', 'cenoura', 'brócolos', 'pepino', 'abacate', 'morangos', 'uvas',
  'arroz', 'massa', 'esparguete', 'feijão', 'grão', 'azeite', 'óleo', 'sal', 'açúcar', 'farinha', 'café', 'chá', 'cereais', 'aveia', 'bolachas', 'chocolate',
  'água', 'sumo de laranja', 'cerveja', 'vinho tinto',
  'papel higiénico', 'detergente da loiça', 'detergente roupa', 'lixívia', 'sacos do lixo', 'pasta de dentes', 'champô', 'guardanapos', 'rolo de cozinha',
  'congelados', 'pizza', 'gelado', 'ervilhas congeladas',
];

const pool = getPool();
const entradas = [];
const hab = await generalizar(pool, await produtos_habituais(pool, { min_idas: 2 }), 'produto'); // = /api/lista/habituais
for (const h of hab.slice(0, 40)) entradas.push({ fonte: 'hab', digitado: h.produto, nome: h.produto });

// autocomplete: a mesma query da rota (sem HTTP)
async function autocomplete(q) {
  const limpa = (t) => t.replace(/[^a-z0-9áàâãéêíóôõúüç]/gi, '');
  const toks = q.toLowerCase().split(/\s+/).map(limpa).filter(Boolean).slice(0, 6);
  if (!toks.length) return [];
  const bool = toks.map((t, i) => `+${t}${i === toks.length - 1 ? '*' : ''}`).join(' ');
  const last = toks[toks.length - 1];
  const [rows] = await pool.query(
    `SELECT generico, nome, marca, tamanho, ean,
            ( (nome REGEXP ?)*100 + (LOWER(nome) LIKE CONCAT(?, '%'))*40 + generico*1000 + (product_type='food')*30 + LEAST(popularidade, 50) + (LOWER(nome) = ?)*300 - LEAST(CHAR_LENGTH(nome), 60) ) AS score
       FROM produto_busca WHERE MATCH(nome, marca) AGAINST(? IN BOOLEAN MODE) AND (generico = 1 OR popularidade > 0)
      ORDER BY score DESC, MATCH(nome, marca) AGAINST(? IN BOOLEAN MODE) DESC LIMIT 8`,
    [`\\b${last}\\b`, last, q.toLowerCase().trim(), bool, bool]);
  return rows;
}
for (const q of ESCRITOS) {
  entradas.push({ fonte: 'esc', digitado: q, nome: q.charAt(0).toUpperCase() + q.slice(1) });
  const ac = await autocomplete(q);
  if (ac[0]) entradas.push({ fonte: 'ac1', digitado: q, nome: ac[0].nome, ean: ac[0].ean || null, ac: ac.slice(0, 4).map((x) => (x.generico ? '*' : '') + x.nome).join(' | ') });
}

const itens = entradas.map((e, i) => ({ id: -(i + 1), nome: e.nome, ean: e.ean || null, quantidade: 1, estado: 'ativo', categoria: null }));
await resolverItensLista(pool, itens, null);

const linhas = itens.map((it, i) => {
  const e = entradas[i];
  const sub = [it.marca && limparMarca(it.marca), fmtTamanho(it.tamanho), precoLista(it)].filter(Boolean).join(' · ');
  return {
    fonte: e.fonte, digitado: e.digitado, seccao: secDe(it), nome: nomeTalao(it.nome), sub, qtd: qtdTxt(it),
    grupo: it.grupo, marca: it.marca, unidade: it.unidade, qtd_medida: it.qtd_medida, melhor: it.melhor_preco, ub: it.unidade_base,
    pago: it.preco_pago, mercado: it.preco_mercado, ref: it.preco_ref, ref_tipo: it.preco_ref_tipo, hab: it.qtd_habitual, var: it.variantes_n, ac: e.ac || '',
  };
});
if (process.argv.includes('--json')) console.log(JSON.stringify(linhas, null, 1));
else {
  const cols = Object.keys(linhas[0]);
  console.log(cols.join('\t'));
  for (const l of linhas) console.log(cols.map((c) => (l[c] == null ? '' : String(l[c]))).join('\t'));
}
await closePool();
process.exit(0);

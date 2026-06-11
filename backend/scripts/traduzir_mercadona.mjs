// Traduz os nomes do catálogo MERCADONA de ES→PT por LÉXICO determinístico
// (sem LLM) → coluna nome_pt. Não precisa de tradução fluente: para o MATCHING
// basta traduzir os substantivos-cabeça e modificadores que dão o token-overlap
// ("Queso"→"Queijo", "Leche"→"Leite", "Vacuno"→"Bovino"). Palavras iguais nas
// duas línguas (tomate, chocolate, natural) ficam intactas.
//   node scripts/traduzir_mercadona.mjs [--aplicar]
import { getPool } from '../src/db.js';
import { tituloProduto } from '../src/normaliza/titulo.js';

const APLICAR = process.argv.includes('--aplicar');

// Léxico ES→PT (palavra a palavra, minúsculas; só entradas onde ES≠PT).
const LEX = {
  // substantivos-cabeça (alimentar)
  queso: 'queijo', quesos: 'queijos', leche: 'leite', pan: 'pão', panecillos: 'pãezinhos',
  galleta: 'bolacha', galletas: 'bolachas', zumo: 'sumo', zumos: 'sumos',
  // "aceite" sozinho = ÓLEO (girassol, etc.); só "aceite de oliva" é azeite (tratado
  // como FRASE abaixo). Traduzir sempre p/ azeite estava errado (óleo de girassol).
  aceite: 'óleo', aceites: 'óleos',
  griego: 'grego', griega: 'grega', boquerones: 'biqueirões', boquerón: 'biqueirão',
  caballa: 'cavala', aliñado: 'temperado', aliñada: 'temperada', aliñados: 'temperados', aliñadas: 'temperadas',
  pollo: 'frango', cerdo: 'porco', ternera: 'vitela', vacuno: 'bovino', buey: 'boi', atún: 'atum',
  huevo: 'ovo', huevos: 'ovos', agua: 'água', vino: 'vinho', cerveza: 'cerveja', yogur: 'iogurte', yogures: 'iogurtes',
  mantequilla: 'manteiga', harina: 'farinha', azúcar: 'açúcar', pescado: 'peixe', pescados: 'peixes',
  jamón: 'presunto', pavo: 'peru', salchichas: 'salsichas', salchicha: 'salsicha', chorizo: 'chouriço',
  patatas: 'batatas', patata: 'batata', cebolla: 'cebola', cebollas: 'cebolas', ajo: 'alho',
  manzana: 'maçã', manzanas: 'maçãs', plátano: 'banana', plátanos: 'bananas', naranja: 'laranja', naranjas: 'laranjas',
  fresa: 'morango', fresas: 'morangos', limón: 'limão', melocotón: 'pêssego', sandía: 'melancia', melón: 'melão',
  girasol: 'girassol', mantequilla: 'manteiga', perejil: 'salsa', rallado: 'ralado', rallada: 'ralada',
  piña: 'ananás', helado: 'gelado', helados: 'gelados', refresco: 'refrigerante', refrescos: 'refrigerantes',
  infusión: 'infusão', mermelada: 'compota', miel: 'mel', aceitunas: 'azeitonas', aceituna: 'azeitona',
  garbanzos: 'grão', lentejas: 'lentilhas', judías: 'feijão', alubias: 'feijão', guisantes: 'ervilhas', maíz: 'milho',
  fideos: 'aletria', nata: 'natas', requesón: 'requeijão', cuajada: 'coalhada', mantequillas: 'manteigas',
  // higiene/limpeza/casa
  detergente: 'detergente', suavizante: 'amaciador', lejía: 'lixívia', lavavajillas: 'lava-loiça',
  servilletas: 'guardanapos', pañuelos: 'lenços', pañales: 'fraldas', champú: 'champô', jabón: 'sabonete',
  dentífrico: 'dentífrico', desodorante: 'desodorizante', compresas: 'pensos', bolsas: 'sacos',
  // carne — cortes/preparação
  lonchas: 'fatias', loncha: 'fatia', picada: 'picada', picado: 'picado', troceado: 'aos pedaços',
  pechuga: 'peito', muslo: 'coxa', alitas: 'asas', costillas: 'costeletas', lomo: 'lombo', solomillo: 'lombinho',
  // modificadores
  // teores → valor canónico das facetas (alinha o match: "leite meio gordo" do talão)
  desnatado: 'magro', desnatada: 'magro', semidesnatado: 'meio-gordo', semidesnatada: 'meio-gordo',
  entero: 'inteiro', entera: 'inteira', rallado: 'ralado', rallada: 'ralada', dorado: 'dourado', ecológico: 'biológico',
  asado: 'assado', asada: 'assada', cocido: 'cozido', cocida: 'cozida', ahumado: 'fumado', ahumada: 'fumada',
  // PALAVRAS ES↔PT COMPLETAMENTE DIFERENTES (não só grafia — revelado pela aba Mercadona)
  anacardo: 'caju', anacardos: 'caju', cacahuete: 'amendoim', cacahuetes: 'amendoim',
  gambas: 'camarão', langostinos: 'lagostins', merluza: 'pescada', lubina: 'robalo',
  dorada: 'dourada', almeja: 'amêijoa', almejas: 'amêijoas', mejillones: 'mexilhões',
  bizcocho: 'pão de ló', magdalenas: 'queques', chuletas: 'costeletas',
  calabacín: 'courgette', berenjena: 'beringela', col: 'couve', coliflor: 'couve-flor',
  calabaza: 'abóbora', seta: 'cogumelo', setas: 'cogumelos', champiñones: 'cogumelos',
  aguacate: 'abacate', pomelo: 'toranja', arándanos: 'mirtilos', avellanas: 'avelãs',
  almendras: 'amêndoas', nueces: 'nozes', frambuesa: 'framboesa', frambuesas: 'framboesas',
  cangrejo: 'caranguejo', pulpo: 'polvo', mejicano: 'mexicano',
  pañal: 'fralda', toallitas: 'toalhitas', papel: 'papel', higiénico: 'higiénico',
  // conetores
  con: 'com', sin: 'sem', y: 'e', al: 'ao',
};

const norm = (w) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const LEXN = new Map(Object.entries(LEX).map(([k, v]) => [norm(k), v]));

// FRASES (aplicadas antes da tradução palavra-a-palavra): casos onde o sentido
// depende do conjunto. "aceite de oliva" = azeite (a palavra solta vira óleo).
const FRASES = [[/aceite\s+de\s+oliva/gi, 'azeite']];

function traduzir(nomeOrig) {
  let nome = String(nomeOrig || '');
  for (const [re, pt] of FRASES) nome = nome.replace(re, pt);
  let mudou = nome !== String(nomeOrig || '');
  const out = String(nome || '').split(/(\s+)/).map((tok) => {
    if (/^\s+$/.test(tok)) return tok;
    const m = tok.match(/^([^\wáéíóúñ]*)([\wáéíóúñ]+)([^\wáéíóúñ]*)$/i);
    if (!m) return tok;
    const pt = LEXN.get(norm(m[2]));
    if (!pt) return tok;
    mudou = true;
    return m[1] + pt + m[3];
  }).join('');
  return mudou ? out : null;
}

const pool = getPool();
// Mercadona (scrape, ES) + mercadona-off SEM nome PT (o OFF que já tem PT da
// comunidade fica intacto — é melhor que o léxico).
const [rows] = await pool.query(
  "SELECT fonte, sku_fonte, nome FROM catalogo_produto WHERE nome IS NOT NULL AND (fonte='mercadona' OR (fonte='mercadona-off' AND nome_pt IS NULL))");
let traduzidos = 0;
const exemplos = [];
for (const r of rows) {
  const pt = traduzir(r.nome);
  if (!pt) continue;
  traduzidos++;
  if (exemplos.length < 12 && norm(pt) !== norm(r.nome)) exemplos.push([r.nome, pt]);
  if (APLICAR) await pool.query("UPDATE catalogo_produto SET nome_pt=? WHERE fonte=? AND sku_fonte=?", [tituloProduto(pt), r.fonte, r.sku_fonte]);
}
console.log(`${APLICAR ? 'APLICADO' : 'DRY-RUN'}: ${traduzidos}/${rows.length} nomes Mercadona com pelo menos 1 palavra traduzida.\n`);
for (const [es, pt] of exemplos) console.log(`  ${es}\n  → ${pt}\n`);
if (!APLICAR) console.log('(corre com --aplicar para gravar nome_pt)');
process.exit(0);

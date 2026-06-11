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
  galleta: 'bolacha', galletas: 'bolachas', aceite: 'azeite', aceites: 'azeites', zumo: 'sumo', zumos: 'sumos',
  pollo: 'frango', cerdo: 'porco', ternera: 'vitela', vacuno: 'bovino', buey: 'boi', atún: 'atum',
  huevo: 'ovo', huevos: 'ovos', agua: 'água', vino: 'vinho', cerveza: 'cerveja', yogur: 'iogurte', yogures: 'iogurtes',
  mantequilla: 'manteiga', harina: 'farinha', azúcar: 'açúcar', pescado: 'peixe', pescados: 'peixes',
  jamón: 'presunto', pavo: 'peru', salchichas: 'salsichas', salchicha: 'salsicha', chorizo: 'chouriço',
  patatas: 'batatas', patata: 'batata', cebolla: 'cebola', cebollas: 'cebolas', ajo: 'alho',
  manzana: 'maçã', manzanas: 'maçãs', plátano: 'banana', plátanos: 'bananas', naranja: 'laranja', naranjas: 'laranjas',
  fresa: 'morango', fresas: 'morangos', limón: 'limão', melocotón: 'pêssego', sandía: 'melancia', melón: 'melão',
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
  desnatado: 'magro', desnatada: 'magra', semidesnatado: 'meio-gordo', semidesnatada: 'meio-gorda',
  entero: 'inteiro', entera: 'inteira', rallado: 'ralado', rallada: 'ralada', dorado: 'dourado', ecológico: 'biológico',
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

function traduzir(nome) {
  let mudou = false;
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
const [rows] = await pool.query("SELECT sku_fonte, nome FROM catalogo_produto WHERE fonte='mercadona' AND nome IS NOT NULL");
let traduzidos = 0;
const exemplos = [];
for (const r of rows) {
  const pt = traduzir(r.nome);
  if (!pt) continue;
  traduzidos++;
  if (exemplos.length < 12 && norm(pt) !== norm(r.nome)) exemplos.push([r.nome, pt]);
  if (APLICAR) await pool.query("UPDATE catalogo_produto SET nome_pt=? WHERE fonte='mercadona' AND sku_fonte=?", [tituloProduto(pt), r.sku_fonte]);
}
console.log(`${APLICAR ? 'APLICADO' : 'DRY-RUN'}: ${traduzidos}/${rows.length} nomes Mercadona com pelo menos 1 palavra traduzida.\n`);
for (const [es, pt] of exemplos) console.log(`  ${es}\n  → ${pt}\n`);
if (!APLICAR) console.log('(corre com --aplicar para gravar nome_pt)');
process.exit(0);

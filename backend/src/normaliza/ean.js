// ANÁLISE DO EAN — o início do funil de identificação (Classificacao_Fusor §3-4).
// O EAN não é só uma chave: o prefixo GS1 dá sinais DETERMINÍSTICOS antes de qualquer
// fonte. Este módulo é PURO (sem BD): país + código-interno + estrutura GS1. A camada
// EMPRESA (prefixo→marca) é minada dos dados e vive à parte (ean_empresa, com BD).
//
// RESSALVA-CHAVE (dono, 2026-06-15): o país-do-prefixo é o país onde a EMPRESA registou
// o EAN no GS1 — é LOCALE só para PRIVATE LABELS (marca de loja). Para multinacionais é o
// país-SEDE, não onde se vende (Nesquik 76→Suíça=sede Nestlé; anchovas 40→Alemanha mas
// produto ibérico). Quem decide "isto é locale" é o fusor, cruzando com marca_perfil.

// Prefixos GS1 (3 primeiros dígitos do EAN-13) → país de registo. Ranges oficiais GS1.
// `iso` null = não é país (interno de loja, cupão, ISBN/ISSN).
const GS1 = [
  [0, 19, 'EUA/Canadá', 'US'], [20, 29, 'Interno de loja', null], [30, 39, 'EUA', 'US'],
  [50, 59, 'Cupão', null], [60, 139, 'EUA/Canadá', 'US'], [200, 299, 'Interno de loja', null],
  [300, 379, 'França', 'FR'], [380, 380, 'Bulgária', 'BG'], [383, 383, 'Eslovénia', 'SI'],
  [385, 385, 'Croácia', 'HR'], [387, 387, 'Bósnia', 'BA'], [389, 389, 'Montenegro', 'ME'], [390, 390, 'Kosovo', 'XK'],
  [400, 440, 'Alemanha', 'DE'], [450, 459, 'Japão', 'JP'], [460, 469, 'Rússia', 'RU'], [470, 470, 'Quirguistão', 'KG'],
  [471, 471, 'Taiwan', 'TW'], [474, 474, 'Estónia', 'EE'], [475, 475, 'Letónia', 'LV'], [476, 476, 'Azerbaijão', 'AZ'],
  [477, 477, 'Lituânia', 'LT'], [478, 478, 'Usbequistão', 'UZ'], [479, 479, 'Sri Lanka', 'LK'], [480, 480, 'Filipinas', 'PH'],
  [481, 481, 'Bielorrússia', 'BY'], [482, 482, 'Ucrânia', 'UA'], [484, 484, 'Moldávia', 'MD'], [485, 485, 'Arménia', 'AM'],
  [486, 486, 'Geórgia', 'GE'], [487, 487, 'Cazaquistão', 'KZ'], [489, 489, 'Hong Kong', 'HK'], [490, 499, 'Japão', 'JP'],
  [500, 509, 'Reino Unido', 'GB'], [520, 521, 'Grécia', 'GR'], [528, 528, 'Líbano', 'LB'], [529, 529, 'Chipre', 'CY'],
  [531, 531, 'Macedónia', 'MK'], [535, 535, 'Malta', 'MT'], [539, 539, 'Irlanda', 'IE'], [540, 549, 'Bélgica/Luxemburgo', 'BE'],
  [560, 560, 'Portugal', 'PT'], [569, 569, 'Islândia', 'IS'], [570, 579, 'Dinamarca', 'DK'], [590, 590, 'Polónia', 'PL'],
  [594, 594, 'Roménia', 'RO'], [599, 599, 'Hungria', 'HU'], [600, 601, 'África do Sul', 'ZA'], [608, 608, 'Bahrein', 'BH'],
  [609, 609, 'Maurícia', 'MU'], [611, 611, 'Marrocos', 'MA'], [613, 613, 'Argélia', 'DZ'], [615, 615, 'Nigéria', 'NG'],
  [616, 616, 'Quénia', 'KE'], [619, 619, 'Tunísia', 'TN'], [621, 621, 'Síria', 'SY'], [622, 622, 'Egito', 'EG'],
  [625, 625, 'Jordânia', 'JO'], [626, 626, 'Irão', 'IR'], [627, 627, 'Kuwait', 'KW'], [628, 628, 'Arábia Saudita', 'SA'],
  [629, 629, 'Emirados', 'AE'], [640, 649, 'Finlândia', 'FI'], [690, 699, 'China', 'CN'], [700, 709, 'Noruega', 'NO'],
  [729, 729, 'Israel', 'IL'], [730, 739, 'Suécia', 'SE'], [740, 745, 'América Central', null], [746, 746, 'Rep. Dominicana', 'DO'],
  [750, 750, 'México', 'MX'], [754, 755, 'Canadá', 'CA'], [759, 759, 'Venezuela', 'VE'], [760, 769, 'Suíça', 'CH'],
  [770, 771, 'Colômbia', 'CO'], [773, 773, 'Uruguai', 'UY'], [775, 775, 'Peru', 'PE'], [777, 777, 'Bolívia', 'BO'],
  [778, 779, 'Argentina', 'AR'], [780, 780, 'Chile', 'CL'], [784, 784, 'Paraguai', 'PY'], [786, 786, 'Equador', 'EC'],
  [789, 790, 'Brasil', 'BR'], [800, 839, 'Itália', 'IT'], [840, 849, 'Espanha', 'ES'], [850, 850, 'Cuba', 'CU'],
  [858, 858, 'Eslováquia', 'SK'], [859, 859, 'Chéquia', 'CZ'], [860, 860, 'Sérvia', 'RS'], [865, 865, 'Mongólia', 'MN'],
  [867, 867, 'Coreia do Norte', 'KP'], [868, 869, 'Turquia', 'TR'], [870, 879, 'Países Baixos', 'NL'], [880, 880, 'Coreia do Sul', 'KR'],
  [884, 884, 'Camboja', 'KH'], [885, 885, 'Tailândia', 'TH'], [888, 888, 'Singapura', 'SG'], [890, 890, 'Índia', 'IN'],
  [893, 893, 'Vietname', 'VN'], [896, 896, 'Paquistão', 'PK'], [899, 899, 'Indonésia', 'ID'], [900, 919, 'Áustria', 'AT'],
  [930, 939, 'Austrália', 'AU'], [940, 949, 'Nova Zelândia', 'NZ'], [955, 955, 'Malásia', 'MY'], [958, 958, 'Macau', 'MO'],
  [977, 977, 'Periódico (ISSN)', null], [978, 979, 'Livro (ISBN)', null], [980, 980, 'Recibo', null],
  [981, 984, 'Cupão GS1', null], [990, 999, 'Cupão GS1', null],
];

const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');

// Validação EAN-13 (checksum). Puro.
export function eanValido(ean) {
  const s = soDigitos(ean);
  if (s.length !== 13) return false;
  const d = s.split('').map(Number); const c = d.pop();
  let soma = 0;
  for (let i = d.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) soma += d[i] * w;
  return (10 - (soma % 10)) % 10 === c;
}

// Código INTERNO de loja (peso/preço variável): prefixos 02x e 20-29. Não é um produto
// global — é gerado no PDV; o "EAN" não identifica nada fora daquela loja.
export function eanInterno(ean) {
  const s = soDigitos(ean);
  if (s.length !== 13) return false;
  const p = Number(s.slice(0, 3));
  return (p >= 20 && p <= 29) || (p >= 200 && p <= 299);
}

// País de registo GS1 (prefixo). Devolve { prefixo, nome, iso } ou null se o EAN for
// inválido. iso=null quando o prefixo não é um país (interno/cupão/ISBN). `interno`=true
// marca os códigos de loja. NÃO interpreta locale (isso é do fusor, com marca_perfil).
export function paisDoEan(ean) {
  const s = soDigitos(ean);
  if (s.length !== 13) return null;
  const p3 = Number(s.slice(0, 3));
  const r = GS1.find(([a, b]) => p3 >= a && p3 <= b);
  if (!r) return { prefixo: p3, nome: 'Desconhecido', iso: null };
  return { prefixo: p3, nome: r[2], iso: r[3], interno: r[3] === null && r[2].startsWith('Interno') };
}

// Análise determinística completa do EAN (o passo 0 do fusor). A `empresa` (prefixo→marca)
// é minada e vive em ean_empresa (BD) — entra aqui via parâmetro quando disponível.
export function analiseEan(ean, { empresa = null } = {}) {
  const s = soDigitos(ean);
  const valido = eanValido(s);
  return {
    ean: s || null,
    valido,
    interno: eanInterno(s),
    pais: valido ? paisDoEan(s) : null,
    empresa, // { prefixo, marca, pais, coerencia } — do ean_empresa, se passado
  };
}

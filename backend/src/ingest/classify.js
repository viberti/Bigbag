// Classifica o tipo de estabelecimento a partir da cadeia/nome lidos da fatura.
// Determinístico e testável. Cadeias de supermercado conhecidas → 'supermercado';
// nome com "farmácia" → 'farmacia'; resto → 'outro' (reclassificável à mão).
// Mantém o histórico aberto a tudo, mas permite filtrar preços só a supermercado.

const SUPERMERCADOS = [
  'continente',
  'pingo doce',
  'mercadona',
  'aldi',
  'lidl',
  'minipreço',
  'minipreco',
  'intermarché',
  'intermarche',
  'auchan',
  'jumbo',
  'el corte inglés',
];

export function classificarLoja({ cadeia, nome } = {}) {
  const c = String(cadeia || '').trim().toLowerCase();
  const n = String(nome || '').trim().toLowerCase();
  if (SUPERMERCADOS.includes(c)) return 'supermercado';
  if (SUPERMERCADOS.some((s) => n.includes(s))) return 'supermercado';
  if (/farm[aá]cia/.test(c) || /farm[aá]cia/.test(n)) return 'farmacia';
  return 'outro';
}

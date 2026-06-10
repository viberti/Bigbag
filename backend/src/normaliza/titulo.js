// Capitalização UNIFORME de nomes/marcas no banco de EANs (produto_ean +
// catalogo_produto): as fontes misturam ALLCAPS (Auchan: "MEL SERRAMEL 500G")
// com Título (Continente/OFF: "Mel de Rosmaninho"). Regra: Título PT —
// 1.ª letra maiúscula nas palavras principais, minúsculas em de/da/do/com/e…,
// SIGLAS preservadas (UHT/DOP/IGP), unidades minúsculas (500G→500g), e palavras
// com capitalização deliberada (SerraMel, McVitie's) ficam como estão.
// NÃO usar em descricao_original/produto_nome (chaves de matching, ficam verbatim).
const PEQUENAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'sem', 'para', 'em', 'a', 'o', 'os', 'as', 'ao', 'à', 'no', 'na', 'nos', 'nas', 'por', 'd']);
const SIGLAS = new Set(['UHT', 'DOP', 'IGP', 'IPA', 'BBQ', 'XL', 'XXL', 'II', 'III']);

export function tituloProduto(s) {
  const str = String(s ?? '').trim().replace(/\s+/g, ' ');
  if (!str) return null;
  return str
    .split(' ')
    .map((w, i) => {
      const semPontuacao = w.replace(/[.,;:!]+$/, '');
      const upper = w.toUpperCase();
      const lower = w.toLowerCase();
      if (SIGLAS.has(semPontuacao.toUpperCase())) return upper; // sigla conhecida
      if (/\d/.test(w)) return /^[\d.,]+[a-z]{1,3}$/i.test(w) ? lower : w; // 500G→500g; resto com dígitos fica
      if (i > 0 && PEQUENAS.has(lower)) return lower; // palavra pequena (não inicial)
      if (w === upper || w === lower) {
        // ALLCAPS ou tudo-minúsculas → Título (capitaliza também após - / . ')
        return lower.replace(/(^|[-/.'’])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
      }
      return w; // capitalização mista deliberada (SerraMel, McVitie's) → intacta
    })
    .join(' ');
}

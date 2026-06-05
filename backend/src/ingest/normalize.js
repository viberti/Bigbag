// Normalização pós-extração, independente do VLM (rede de segurança).
// Alguns VLMs emitem a "Poupança"/"Desconto" como uma LINHA à parte em vez de
// a associarem ao produto. Aqui dobramos essas linhas no desconto_direto do
// item imediatamente acima e removemo-las da lista — assim a contagem de itens
// e o subtotal ficam corretos mesmo quando a extração escorrega.

// Linhas de desconto/promoção que pertencem ao item acima (Continente: "Poupança";
// Lidl: "Promoção", "Promoção Lidl Plus"). Somam-se ao desconto_direto e são removidas.
const RE_DESCONTO = /^(poupan|desconto|desc\.|promo[çc])/i;

// Linha ÓRFÃ de peso: começa pelo peso "X,XXX kg" e NÃO tem nome de produto
// antes (a Mercadona imprime o item a peso em duas linhas — nome numa, peso na
// seguinte). Sem isto, a linha de peso fica sem nome e a canonicalização
// inventa um produto. Dobramos no item acima (o nome real).
const RE_PESO_ORFAO = /^\s*\d+[.,]\d+\s*kg\b.*?(?:eur|€)\s*\/\s*kg/i;

export function normalizarItens(itens) {
  const out = [];
  for (const it of itens) {
    const desc = String(it?.descricao_original || '').trim();
    const valor = Number(it?.valor);
    if (RE_DESCONTO.test(desc) && out.length) {
      const prev = out[out.length - 1];
      // magnitude positiva (as promoções vêm com sinal negativo, ex. "-0,20")
      const montante = Math.abs(Number.isFinite(valor) ? valor : Number(it?.desconto_direto) || 0);
      prev.desconto_direto = (Number(prev.desconto_direto) || 0) + montante;
      continue; // descarta a linha-fantasma
    }
    if (RE_PESO_ORFAO.test(desc) && out.length) {
      const prev = out[out.length - 1];
      // junta o peso ao nome do produto de cima (para o formato derivar kg e €/kg)
      prev.descricao_original = `${String(prev.descricao_original || '').trim()} ${desc}`.trim();
      // o total impresso à direita da linha de peso é o valor do item a peso
      if (Number.isFinite(valor)) prev.valor = valor;
      continue; // descarta a linha órfã (já foi dobrada no item acima)
    }
    out.push({ ...it });
  }
  return out;
}

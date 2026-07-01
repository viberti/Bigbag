// Guard de talão SEM valores. Lógica pura, testável (GATE do deploy).
//
// Um talão sem QUALQUER valor (total ≤ 0 e nenhum item com preço > 0) não é uma compra
// legível: é tipicamente um RESUMO do LidlPlus (cupões usados/pontos ganhos), uma "cópia
// de reembolso", ou uma foto cortada/incompleta. Nesses casos o VLM só apanha uns nomes
// soltos (ex.: os produtos dos cupões) a 0 € — criar uma "compra" de 0 € poluiria o
// histórico. Regra GERAL (não Lidl-específica): uma compra real tem SEMPRE um total
// positivo OU pelo menos um item com preço > 0.
export function talaoSemValores(dados) {
  if (!dados) return true;
  const total = Number(dados.total_impresso);
  if (Number.isFinite(total) && total > 0) return false;
  const itens = Array.isArray(dados.itens) ? dados.itens : [];
  const algumComPreco = itens.some((it) => !it?.is_non_product && Number(it?.preco_liquido) > 0);
  return !algumComPreco;
}

// Mensagem para o utilizador quando o guard dispara (mostrada no cartão "Não consegui ler").
export const MSG_TALAO_SEM_VALORES =
  'Não consegui ler os valores do talão. Se partilhou o resumo do LidlPlus (cupões/pontos) '
  + 'ou uma foto cortada, envie o talão de compra com os itens e os preços.';

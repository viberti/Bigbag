// Reconciliação determinística da fatura.
// Lida com duas convenções de "valor" (auto-detetadas pelo TOTAL A PAGAR):
//   A) valor já é LÍQUIDO de linha (ex. Continente: a "Poupança" é informativa,
//      já refletida no valor). total ≈ Σ valor − desconto_global.
//   B) valor é BRUTO e o desconto_direto é REAL (ex. Lidl "Promoção -0,20",
//      subtraída de facto). total ≈ Σ(valor − desconto_direto) − desconto_global.
// O preço por item é SEMPRE o impresso na linha; o desconto_global (cartão) NÃO
// é espalhado pelos itens — é um desconto da NOTA, registado à parte. A soma dos
// itens (subtotal líquido) − desconto_global tem de bater com o total impresso.
//
// Entrada: itens[{ valor, desconto_direto?, ... }], { descontoGlobal, totalImpresso }
// Saída:  { itens (com preco_unitario e preco_liquido), subtotal, convencao,
//           totalReconciliado, discrepancia, extracaoBate }

export function distribuirDesconto(itens, { descontoGlobal = 0, totalImpresso }) {
  const valor = (it) => Number(it.valor || 0);
  const descLinha = (it) => Math.abs(Number(it.desconto_direto || 0));

  const subtotalBruto = itens.reduce((s, it) => s + valor(it), 0);
  const somaDescLinha = itens.reduce((s, it) => s + descLinha(it), 0);

  // Árbitro = TOTAL A PAGAR. Escolhe a convenção cujo candidato lhe fica mais perto.
  const alvo = totalImpresso != null ? Number(totalImpresso) : subtotalBruto - somaDescLinha - descontoGlobal;
  const candA = subtotalBruto - descontoGlobal;
  const candB = subtotalBruto - somaDescLinha - descontoGlobal;
  const convencao = Math.abs(candB - alvo) < Math.abs(candA - alvo) ? 'B' : 'A';

  // Base líquida por item (antes do desconto global).
  const base = itens.map((it) => (convencao === 'B' ? valor(it) - descLinha(it) : valor(it)));
  const baseSubtotal = base.reduce((s, v) => s + v, 0);
  // O preço de cada item é o que está IMPRESSO na linha (a base líquida da
  // convenção: valor, ou valor − desconto da própria linha), NUNCA raspado pelo
  // desconto global. O "Desconto Cartão"/global é um desconto DA NOTA, aplicado
  // no pagamento — não pertence a produtos específicos, por isso espalhá-lo
  // cêntimo a cêntimo distorcia cada preço (um sumo de 2,49 aparecia como 2,37).
  // Fica registado em desconto_global da fatura; o total reconciliado abaixo
  // confirma que (subtotal − desconto_global) bate com o total impresso.
  const out = itens.map((it, i) => ({
    ...it,
    preco_unitario: valor(it),
    preco_liquido: Math.round(base[i] * 100) / 100,
  }));

  const totalReconciliado = Math.round((baseSubtotal - descontoGlobal) * 100) / 100;

  // Sinal de qualidade HONESTO: a base líquida (já na convenção escolhida) menos
  // o desconto global devia bater com o TOTAL A PAGAR. Se não bater, a extração
  // perdeu/inventou/leu mal um item ou um desconto.
  const discrepancia =
    totalImpresso != null ? Math.round((baseSubtotal - descontoGlobal - Number(totalImpresso)) * 100) / 100 : 0;

  return {
    itens: out,
    subtotal: subtotalBruto,
    convencao,
    totalReconciliado,
    discrepancia,
    extracaoBate: Math.abs(discrepancia) < 0.015,
  };
}

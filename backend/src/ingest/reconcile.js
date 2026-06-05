// Reconciliação determinística da fatura. Distribui o desconto global
// (ex. "Desconto Cartão Utilizado") proporcionalmente pelo valor de cada item,
// para que a soma dos líquidos bata com o TOTAL A PAGAR ao cêntimo.
// Usa o método do maior resto (largest remainder) para a correção de cêntimos.
//
// Entrada: itens[{ valor, ... }]  (valor = preço impresso na linha)
//          { descontoGlobal, totalImpresso }
// Saída:  { itens (com preco_unitario e preco_liquido), totalReconciliado, bate, diff }

export function distribuirDesconto(itens, { descontoGlobal = 0, totalImpresso }) {
  const subtotal = itens.reduce((s, it) => s + Number(it.valor || 0), 0);
  const targetCents =
    totalImpresso != null ? Math.round(Number(totalImpresso) * 100) : Math.round((subtotal - descontoGlobal) * 100);

  // Líquido bruto por item (euros) após desconto proporcional.
  const raw = itens.map((it) => {
    const valor = Number(it.valor || 0);
    const share = subtotal > 0 ? (descontoGlobal * valor) / subtotal : 0;
    return valor - share;
  });

  // Para cêntimos: floor + resto, e corrige a diferença pelos maiores restos.
  const floorCents = raw.map((v) => Math.floor(v * 100));
  const remainder = raw.map((v, i) => v * 100 - floorCents[i]);
  let need = targetCents - floorCents.reduce((s, c) => s + c, 0);

  const ordem = remainder
    .map((r, i) => ({ i, r }))
    .sort((a, b) => b.r - a.r)
    .map((x) => x.i);

  const addCents = new Array(itens.length).fill(0);
  if (need > 0) {
    for (let k = 0; k < need; k++) addCents[ordem[k % ordem.length]] += 1;
  } else if (need < 0) {
    // remover cêntimos aos menores restos
    const inv = [...ordem].reverse();
    for (let k = 0; k < -need; k++) addCents[inv[k % inv.length]] -= 1;
  }

  const out = itens.map((it, i) => ({
    ...it,
    preco_unitario: Number(it.valor || 0),
    preco_liquido: (floorCents[i] + addCents[i]) / 100,
  }));

  const totalReconciliado = out.reduce((s, it) => s + it.preco_liquido, 0);

  // Sinal de qualidade HONESTO (não tautológico): a soma dos valores extraídos,
  // menos o desconto global, devia bater com o TOTAL A PAGAR. Se não bater, a
  // extração perdeu/inventou/leu mal um item (ex. linha "Poupança" a mais).
  const discrepancia =
    totalImpresso != null ? Math.round((subtotal - descontoGlobal - Number(totalImpresso)) * 100) / 100 : 0;

  return {
    itens: out,
    subtotal,
    totalReconciliado,
    discrepancia,
    extracaoBate: Math.abs(discrepancia) < 0.015,
  };
}

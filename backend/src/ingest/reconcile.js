// Reconciliação determinística da fatura.
// Lida com duas convenções de "valor" (auto-detetadas pelo TOTAL A PAGAR):
//   A) valor já é LÍQUIDO de linha (ex. Continente: a "Poupança" é informativa,
//      já refletida no valor). total ≈ Σ valor − desconto_global.
//   B) valor é BRUTO e o desconto_direto é REAL (ex. Lidl "Promoção -0,20",
//      subtraída de facto). total ≈ Σ(valor − desconto_direto) − desconto_global.
// Depois distribui o desconto_global (se houver) proporcionalmente sobre a base
// líquida, pelo método do maior resto, para a soma bater ao cêntimo.
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
  const targetCents =
    totalImpresso != null ? Math.round(Number(totalImpresso) * 100) : Math.round((baseSubtotal - descontoGlobal) * 100);

  // Distribui o desconto global proporcionalmente sobre a base líquida.
  const raw = base.map((v) => v - (baseSubtotal > 0 ? (descontoGlobal * v) / baseSubtotal : 0));
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
    const inv = [...ordem].reverse();
    for (let k = 0; k < -need; k++) addCents[inv[k % inv.length]] -= 1;
  }

  const out = itens.map((it, i) => ({
    ...it,
    preco_unitario: valor(it),
    preco_liquido: (floorCents[i] + addCents[i]) / 100,
  }));

  const totalReconciliado = out.reduce((s, it) => s + it.preco_liquido, 0);

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

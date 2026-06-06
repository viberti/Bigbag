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

export function distribuirDesconto(itens, { descontoGlobal = 0, totalImpresso, iva = 0 }) {
  const valor = (it) => Number(it.valor || 0);
  const descLinha = (it) => Math.abs(Number(it.desconto_direto || 0));

  const subtotalBruto = itens.reduce((s, it) => s + valor(it), 0);
  const somaDescLinha = itens.reduce((s, it) => s + descLinha(it), 0);
  const candA = subtotalBruto - descontoGlobal;
  const candB = subtotalBruto - somaDescLinha - descontoGlobal;

  // IVA SOMADO (grossista/cash-and-carry, ex. Makro): só é REAL se as linhas não
  // fecharem sozinhas com o total. Num supermercado normal os preços já incluem
  // IVA e Σlinhas − desconto = total; a tabela "Resumo IVA" no rodapé é apenas
  // informativa. Se veio um `iva` mas as linhas JÁ batem com o total, é espúrio
  // (a legenda lida como IVA-somado) → ignora-o, senão o total não fecharia e o
  // preço seria inflado. Guarda aritmético, robusto a erros do LLM.
  let ivaAdd = Number(iva) || 0;
  if (ivaAdd > 0 && totalImpresso != null) {
    const t = Number(totalImpresso);
    if (Math.abs(candA - t) < 0.05 || Math.abs(candB - t) < 0.05) ivaAdd = 0;
  }

  // Árbitro = TOTAL SEM o IVA somado (as linhas são sem IVA nos grossistas).
  // Escolhe a convenção cujo candidato lhe fica mais perto.
  const alvo = totalImpresso != null ? Number(totalImpresso) - ivaAdd : subtotalBruto - somaDescLinha - descontoGlobal;
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

  const totalReconciliado = Math.round((baseSubtotal - descontoGlobal + ivaAdd) * 100) / 100;

  // Sinal de qualidade HONESTO: base líquida − desconto_global + IVA somado devia
  // bater com o TOTAL A PAGAR. Se não bater, a extração perdeu/inventou/leu mal um
  // item, um desconto ou o IVA. (Nos talões normais ivaAdd=0 → fórmula original.)
  const discrepancia =
    totalImpresso != null
      ? Math.round((baseSubtotal - descontoGlobal + ivaAdd - Number(totalImpresso)) * 100) / 100
      : 0;

  return {
    itens: out,
    subtotal: subtotalBruto,
    convencao,
    iva: ivaAdd, // IVA somado EFETIVO (0 se espúrio) — para precos_com_iva
    totalReconciliado,
    discrepancia,
    extracaoBate: Math.abs(discrepancia) < 0.015,
  };
}

// Validação POR LINHA — 2.ª camada de qualidade, INDEPENDENTE do total da nota.
// Quando a linha mostra um multiplicador explícito (preco_unitario != null e
// quantidade ≥ 2), confirma que quantidade × preco_unitario ≈ valor (total da
// linha). Apanha o erro clássico do multipack — o "valor" lido como o preço
// unitário (ex.: "2 X 0,59" gravado como 0,59 em vez de 1,18) — mesmo quando a
// nota inteira por acaso fecha. Só dispara com multiplicador explícito (evita
// falsos positivos em linhas de 1 unidade ou a peso). Devolve as linhas fora.
export function validarLinhas(itens = []) {
  const fora = [];
  for (const it of itens) {
    const q = Number(it.quantidade) || 1;
    const u = it.preco_unitario == null ? null : Number(it.preco_unitario);
    const v = Math.abs(Number(it.valor) || 0);
    if (q >= 2 && u != null && u > 0) {
      const esperado = Math.round(q * u * 100) / 100;
      if (Math.abs(esperado - v) > 0.02) {
        fora.push({ descricao: String(it.descricao_original || '').slice(0, 40), quantidade: q, preco_unitario: u, valor: v, esperado });
      }
    }
  }
  return fora;
}

// Pista CIRÚRGICA para o loop de auto-correção: dado o resultado da reconciliação
// que não bateu, tenta apontar a LINHA que explica a diferença, em vez de mandar
// o modelo procurar às cegas. Determinístico, barato. Estratégia SEGURA — só por
// CASAMENTO com a discrepância (valor de item / desconto de linha), nunca por
// "valor outlier" (o Makro & cash-and-carry têm itens caros legítimos → falsos
// ponteiros). Sem casamento, dá só a DIREÇÃO (acima/abaixo). Devolve '' se bate.
export function pistaCirurgica(itens = [], discrepancia = 0) {
  const d = Math.round(Number(discrepancia) * 100) / 100;
  if (!d) return '';
  const alvo = Math.abs(d);
  const casa = (x) => Math.abs(Math.abs(Number(x) || 0) - alvo) <= 0.02;
  const nome = (it) => String(it.descricao_original || it.descricao || '').trim().slice(0, 40);

  // 1) um item cujo VALOR casa com a diferença → duplicado (d>0) ou em falta (d<0)
  const porValor = itens.find((it) => casa(it.valor));
  if (porValor) {
    return d > 0
      ? ` PISTA: a diferença (${alvo.toFixed(2)}) é igual ao valor do item "${nome(porValor)}" — ele pode estar DUPLICADO/a mais; confirma se não aparece duas vezes.`
      : ` PISTA: a diferença (${alvo.toFixed(2)}) é igual ao valor do item "${nome(porValor)}" — a sua QUANTIDADE pode ser maior que 1, pode FALTAR um item desse valor, ou esse valor foi lido a menos.`;
  }
  // 2) um desconto de LINHA que casa com a diferença → convenção/desconto mal tratado
  const porDesc = itens.find((it) => Number(it.desconto_direto) && casa(it.desconto_direto));
  if (porDesc) {
    return ` PISTA: a diferença (${alvo.toFixed(2)}) é igual ao desconto da linha "${nome(porDesc)}" — verifica se esse desconto foi contado certo (não a dobrar nem em falta).`;
  }
  // 3) sem casamento exato → só a direção
  return d > 0
    ? ` PISTA: a soma está ${alvo.toFixed(2)} ACIMA do total — provável item DUPLICADO/a mais, ou um desconto não subtraído.`
    : ` PISTA: a soma está ${alvo.toFixed(2)} ABAIXO do total — provável item EM FALTA, uma QUANTIDADE/pack lido a menos (em "N X preço" o valor é o TOTAL da linha), ou um valor lido a menos.`;
}

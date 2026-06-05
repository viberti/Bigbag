// Normalização pós-extração, independente do VLM (rede de segurança).
// Alguns VLMs emitem a "Poupança"/"Desconto" como uma LINHA à parte em vez de
// a associarem ao produto. Aqui dobramos essas linhas no desconto_direto do
// item imediatamente acima e removemo-las da lista — assim a contagem de itens
// e o subtotal ficam corretos mesmo quando a extração escorrega.

const RE_DESCONTO = /^(poupan|desconto|desc\.)/i;

export function normalizarItens(itens) {
  const out = [];
  for (const it of itens) {
    const desc = String(it?.descricao_original || '').trim();
    const valor = Number(it?.valor);
    if (RE_DESCONTO.test(desc) && out.length) {
      const prev = out[out.length - 1];
      const montante = Number.isFinite(valor) ? valor : Number(it?.desconto_direto) || 0;
      prev.desconto_direto = (Number(prev.desconto_direto) || 0) + montante;
      continue; // descarta a linha-fantasma
    }
    out.push({ ...it });
  }
  return out;
}

// Normalização pós-extração, independente do VLM (rede de segurança).
import { limparDescricao } from '../normaliza/mestre.js';
// Alguns VLMs emitem a "Poupança"/"Desconto" como uma LINHA à parte em vez de
// a associarem ao produto. Aqui dobramos essas linhas no desconto_direto do
// item imediatamente acima e removemo-las da lista — assim a contagem de itens
// e o subtotal ficam corretos mesmo quando a extração escorrega.

// Linhas de desconto/promoção que pertencem ao item acima (Continente: "Poupança";
// Lidl: "Promoção", "Promoção Lidl Plus"). Somam-se ao desconto_direto e são removidas.
const RE_DESCONTO = /^(poupan|desconto|desc\.|promo[çc])/i;

// Padrão de PESO numa linha: "X,XXX kg [x] Y,YY EUR/kg" (aceita € e EUR, x opcional)
// e a variante SEM unidades "1,170 X 1,29" (kg × €/kg, ambos com vírgula).
const PESO = String.raw`\d+[.,]\d+\s*kg\s*[x×X]?\s*\d+[.,]\d+\s*(?:eur|€)\s*\/\s*kg`;
const PESO_SEMUNID = String.raw`\d+,\d{2,3}\s*[x×X]\s*\d+,\d{1,2}`;
// Linha ÓRFÃ: começa pelo peso, sem nome de produto antes (Mercadona imprime o
// item a peso em duas linhas — nome numa, peso na seguinte).
const RE_PESO_ORFAO = new RegExp(`^\\s*${PESO}`, 'i');
// Peso COLADO ao nome (inline ou após \n): "BANANA\n1,800 kg x 1,19 EUR/kg",
// "BANANA 1,170 X 1,29".
const RE_PESO_INLINE = new RegExp(`[\\s\\n]+(${PESO}|${PESO_SEMUNID})\\s*$`, 'i');

// Sinais de que a descrição ainda carrega peso/preço (€/kg, "kg x", "N,NNN kg").
// Se for o caso e ainda não houver linha_peso, preserva-se a linha crua em
// linha_peso ANTES de limpar o nome — senão um reprocesso perde o €/kg
// (reprocess.js calcula o ppb de descricao_original+linha_peso juntos).
const RE_TEM_PESO = /\d+[.,]\d+\s*kg|kg\s*[x×X]\s*\d|eur\s*\/\s*kg|€\s*\/\s*kg/i;

export function normalizarItens(itens) {
  const out = [];
  for (const it of itens) {
    let desc = String(it?.descricao_original || '').trim();
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
      // o peso pertence ao produto de cima — guarda-se à parte (NÃO no nome, que
      // deve ficar estável p/ a cache de alias agrupar) e o total vira o valor.
      prev.linha_peso = desc;
      if (Number.isFinite(valor)) prev.valor = valor;
      continue; // descarta a linha órfã (já foi dobrada no item acima)
    }
    // Peso colado ao nome → separa: nome limpo + linha_peso à parte.
    const novo = { ...it };
    // Caminho NOVO: o VLM já devolve peso/€-por-kg em campos próprios → reconstrói
    // o linha_peso canónico (autoritativo). Sem regex, e o nome fica limpo na origem.
    if (it.peso_kg != null && Number(it.peso_kg) > 0) {
      const v = (n) => String(n).replace('.', ',');
      const base = it.preco_base_impresso != null ? ` x ${v(it.preco_base_impresso)} EUR/kg` : '';
      novo.linha_peso = `${v(it.peso_kg)} kg${base}`;
    }
    const m = !novo.linha_peso && desc.match(RE_PESO_INLINE);
    if (m) {
      novo.linha_peso = m[1];
      desc = desc.slice(0, m.index).trim();
    }
    // Passo final: tira ruído que o RE_PESO_INLINE não apanha (prefixo de
    // quantidade "1 ", código IVA "(A)"/"C ", ordem Continente-PDF "B kg x1,056
    // 1,19 EUR/kg"). Preserva o peso em linha_peso antes de o remover do nome.
    const limpa = limparDescricao(desc);
    if (limpa && limpa !== desc) {
      if (!novo.linha_peso && RE_TEM_PESO.test(desc)) novo.linha_peso = desc;
      desc = limpa;
    }
    novo.descricao_original = desc;
    out.push(novo);
  }
  return out;
}

// Camada 1 — extrair formato/quantidade da descrição e calcular preco_por_base.
// Determinístico e testável. preco_por_base (€/kg, €/L, €/un) é o que torna a
// comparação entre lojas correta (itens a peso e formatos diferentes).

const num = (s) => Number(String(s).replace(',', '.'));

// Converte (valor, unidade) → { unidade_base, valor } na base kg/L.
function paraBase(valor, unidade) {
  const u = unidade.toLowerCase();
  if (u === 'kg' || u === 'k' || u === 'kgs') return { unidade_base: 'kg', valor }; // "2K" = 2 kg (arroz, feijão…)
  if (u === 'g' || u === 'gr' || u === 'grs') return { unidade_base: 'kg', valor: valor / 1000 };
  if (u === 'l' || u === 'lt') return { unidade_base: 'L', valor };
  if (u === 'ml') return { unidade_base: 'L', valor: valor / 1000 };
  if (u === 'cl') return { unidade_base: 'L', valor: valor / 100 };
  return { unidade_base: 'un', valor };
}

// Extrai o formato a partir da descrição. Tenta os padrões do mais específico
// ao mais geral. Devolve { unidade_base, formato_valor, quantidadeKg?, precoKg? }.
export function extrairFormato(descricao) {
  const s = String(descricao || '');

  // 1) Item a peso, com €/kg impresso: "0,540 kg x 6,19 EUR/kg" ou "… 1,20 €/kg"
  // (o "x" pode faltar; aceita "EUR/kg" e "€/kg").
  let m = s.match(/(\d+[.,]\d+)\s*kg\s*[x×X]?\s*(\d+[.,]\d+)\s*(?:eur|€)\s*\/\s*kg/i);
  if (m) {
    const quantidadeKg = num(m[1]);
    return { unidade_base: 'kg', formato_valor: quantidadeKg, quantidadeKg, precoKg: num(m[2]) };
  }

  // 1b) Peso SEM unidades explícitas (VLM às vezes omite): "1,170 X 1,29" =
  // kg × €/kg. Exige vírgula decimal em ambos (distingue de multipacks "4X115G").
  m = s.match(/(\d+,\d{2,3})\s*[x×X]\s*(\d+,\d{1,2})(?!\d)/);
  if (m) {
    const quantidadeKg = num(m[1]);
    return { unidade_base: 'kg', formato_valor: quantidadeKg, quantidadeKg, precoKg: num(m[2]) };
  }

  // 2) Multipack: "4X115G", "2 x 1L"
  m = s.match(/(\d+)\s*[x×X]\s*(\d+(?:[.,]\d+)?)\s*(kgs|kg|k|grs|gr|g|ml|cl|lt|l)\b/i);
  if (m) {
    const n = num(m[1]);
    const base = paraBase(num(m[2]), m[3]);
    return { unidade_base: base.unidade_base, formato_valor: round3(n * base.valor) };
  }

  // 3) Formato simples: "425GR", "250G", "1,5L", "330 ML", "2K" (=2 kg, arroz/feijão).
  m = s.match(/(\d+(?:[.,]\d+)?)\s*(kgs|kg|k|grs|gr|g|ml|cl|lt|l)\b/i);
  if (m) {
    const base = paraBase(num(m[1]), m[2]);
    return { unidade_base: base.unidade_base, formato_valor: round3(base.valor) };
  }

  // 4) Unidades: "16UN"
  m = s.match(/(\d+)\s*un\b/i);
  if (m) return { unidade_base: 'un', formato_valor: num(m[1]) };

  // 5) Sem formato → unidade simples
  return { unidade_base: 'un', formato_valor: 1 };
}

// Calcula preco_por_base a partir do item (preco_liquido, quantidade) e formato.
export function precoPorBase({ preco_liquido, quantidade = 1 }, formato) {
  const liq = Number(preco_liquido);
  if (!Number.isFinite(liq)) return null;
  const q = Number(quantidade) || 1;

  // Peso com €/kg impresso → usa o valor da fatura (mais fiável).
  if (formato.precoKg != null) return round4(formato.precoKg);

  if (formato.unidade_base === 'kg' || formato.unidade_base === 'L') {
    const total = formato.formato_valor * q;
    return total > 0 ? round4(liq / total) : null;
  }
  // 'un': se o formato traz contagem do pacote (ex. 16UN), €/unidade individual;
  // senão, €/unidade comprada.
  const n = formato.formato_valor > 1 ? formato.formato_valor : q;
  return n > 0 ? round4(liq / n) : null;
}

const round3 = (v) => Math.round(v * 1000) / 1000;
const round4 = (v) => Math.round(v * 10000) / 10000;

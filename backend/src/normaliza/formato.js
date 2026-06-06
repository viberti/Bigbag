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

  // 4b) Pacotes por CONTAGEM (ovos, dúzias) → normaliza a €/unidade, para
  // comparar pacotes de 6/12/18/24 entre lojas de forma justa.
  m = s.match(/(\d+)\s*dz\b/i);
  if (m) return { unidade_base: 'un', formato_valor: num(m[1]) * 12 }; // "2DZ" = 24
  if (/meia\s*d[uú]zia/i.test(s)) return { unidade_base: 'un', formato_valor: 6 };
  if (/\bd[uú]zia\b/i.test(s)) return { unidade_base: 'un', formato_valor: 12 };
  m = s.match(/(\d+)\s*ovos?\b/i) || s.match(/\bovos?\s+(\d+)\b/i); // "24 OVOS", "OVOS 18"
  if (m) {
    const n = num(m[1]);
    if (n >= 4 && n <= 60) return { unidade_base: 'un', formato_valor: n };
  }

  // 5) Sem formato → unidade simples
  return { unidade_base: 'un', formato_valor: 1 };
}

// Calcula preco_por_base a partir do item (preco_liquido, quantidade) e formato.
// `unidadeAlvo` = a unidade de comparação AUTORITATIVA do SKU. Sem ela, usa a do
// formato (retrocompatível). Com ela, TODOS os itens do mesmo produto comparam na
// MESMA base — e se o alvo é peso/volume mas a descrição não traz peso/volume,
// devolve null (incomputável honesto) em vez de um €/embalagem enganador.
export function precoPorBase({ preco_liquido, quantidade = 1 }, formato, unidadeAlvo) {
  const liq = Number(preco_liquido);
  if (!Number.isFinite(liq)) return null;
  const q = Number(quantidade) || 1;
  const alvo = unidadeAlvo || formato.unidade_base;

  if (alvo === 'kg' || alvo === 'L') {
    // Peso com €/kg impresso → usa o valor da fatura (mais fiável).
    if (formato.precoKg != null && alvo === 'kg') return round4(formato.precoKg);
    // Peso/volume NO FORMATO (ex.: "250G", "900G"): €/base. `quantidade` é o nº de
    // EMBALAGENS — mas extrações antigas gravaram o peso lá (q=0,25 p/ 250g); um q
    // fracionário não é nº de embalagens, por isso conta como 1 (evita dupla contagem).
    if (formato.unidade_base === alvo && formato.formato_valor > 0) {
      const embalagens = q >= 1 ? q : 1;
      return round4(liq / (formato.formato_valor * embalagens));
    }
    // Sem peso no formato mas `quantidade` fracionária = PESO de balcão na própria
    // quantidade (ex.: "ALPERCE" 0,514 kg) → €/base = preço / peso.
    if (q > 0 && q < 1) return round4(liq / q);
    return null;
  }
  // alvo 'un': se o formato traz contagem do pacote (ex. 16UN), €/unidade
  // individual; senão, €/unidade comprada.
  const n = formato.unidade_base === 'un' && formato.formato_valor > 1 ? formato.formato_valor : q;
  return n > 0 ? round4(liq / n) : null;
}

const round3 = (v) => Math.round(v * 1000) / 1000;
const round4 = (v) => Math.round(v * 10000) / 10000;

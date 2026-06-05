// Camada 3 — similaridade entre nomes canónicos, para agrupar variantes do
// mesmo produto que a canonicalização escreveu de forma ligeiramente diferente
// (ex. "Parmigiano Reggiano" vs "Parmigiano Reggiano DOP 24 Meses").
// Determinístico (Dice sobre tokens, com reforço para subconjunto da mesma
// cabeça). A decisão final usa limiares + (opcional) confirmação LLM.

const STOP = new Set(['de', 'do', 'da', 'dos', 'das', 'com', 'sem', 'e', 'para', 'a', 'o', 'em', 'no', 'na', 'ao']);

export function normalizarNome(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // tira acentos
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(nome) {
  return normalizarNome(nome)
    .split(' ')
    .filter((t) => t && !STOP.has(t));
}

function dice(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}

// Similaridade [0..1] entre dois nomes. Reforça quando um é subconjunto do
// outro, partilham a cabeça (1º token) e ambos têm ≥2 tokens significativos —
// captura "X" vs "X + qualificadores" sem casar "Queijo" com "Queijo Gouda".
export function similaridade(n1, n2) {
  const a = tokens(n1);
  const b = tokens(n2);
  if (!a.length || !b.length) return 0;
  let score = dice(a, b);
  const A = new Set(a);
  const B = new Set(b);
  const menor = a.length <= b.length ? A : B;
  const maior = a.length <= b.length ? B : A;
  let contido = true;
  for (const t of menor) if (!maior.has(t)) contido = false;
  if (contido && menor.size >= 2 && a[0] === b[0]) score = Math.max(score, 0.95);
  return score;
}

// Melhor candidato de uma lista [{id, nome_canonico, ...}] para um nome.
export function melhorCandidato(nome, candidatos) {
  let melhor = null;
  let score = 0;
  for (const c of candidatos) {
    const s = similaridade(nome, c.nome_canonico);
    if (s > score) {
      score = s;
      melhor = c;
    }
  }
  return { candidato: melhor, score };
}

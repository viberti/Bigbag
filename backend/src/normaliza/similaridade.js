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

// ── Similaridade ao nível do CARACTERE (Levenshtein) ──────────────────────────
// A `similaridade` acima compara CONJUNTOS DE TOKENS — não vê variações DENTRO
// da palavra ("manteigas"~"manteiga", "iorgute"~"iogurte"), porque são tokens
// diferentes. Para o termo que o utilizador escreve numa consulta (plural, typo,
// truncagem), precisamos de distância de edição entre caracteres. Sem deps.

function levDistancia(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  const cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + custo);
    }
    prev = cur.slice();
  }
  return prev[n];
}

// Razão de semelhança [0..1] entre duas palavras (1 = iguais). 1 − dist/maxLen.
export function razaoCaractere(a, b) {
  const x = normalizarNome(a).replace(/\s+/g, '');
  const y = normalizarNome(b).replace(/\s+/g, '');
  const L = Math.max(x.length, y.length);
  if (!L) return 0;
  return 1 - levDistancia(x, y) / L;
}

// Semelhança de um TERMO de pesquisa (geralmente UMA palavra) contra um
// nome_canónico: o melhor entre o nome inteiro (sem espaços) e cada token. Assim
// "iorgute" casa o token "iogurte" de "Iogurte Natural" sem ser diluído pelo
// resto do nome.
export function similaridadeTermo(termo, nome) {
  const t = normalizarNome(termo).replace(/\s+/g, '');
  if (!t) return 0;
  let best = razaoCaractere(t, nome);
  for (const tk of tokens(nome)) {
    const r = razaoCaractere(t, tk);
    if (r > best) best = r;
  }
  return best;
}

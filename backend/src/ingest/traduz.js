// Tradução da ficha de produto para o idioma do app (PT-BR): o Open Food Facts
// devolve nome/ingredientes/alergénios na língua do rótulo de origem (ES/FR/EN…).
// Regra: traduzir SÓ o que não está em português; MARCAS e nomes próprios nunca se
// traduzem. O original fica intacto no off_json — só as colunas de exibição mudam.
import { chatCompletion } from '../openrouter.js';
import { config } from '../config.js';
import { tituloProduto } from '../normaliza/titulo.js';
import { norm } from '../normaliza/categoria.js';

const PROMPT_TRADUZ = `Recebes campos da ficha de um produto de SUPERMERCADO — alimentar OU não-alimentar (limpeza, higiene, cosmética, casa, animais…) — (nome, ingredientes, alergenios), possivelmente noutra língua (espanhol, francês, INGLÊS, alemão…). Traduz para PORTUGUÊS DO BRASIL (PT-BR) TUDO o que NÃO estiver em português; o que já estiver em português fica EXATAMENTE igual (não reescrevas). Traduz SEMPRE as palavras descritivas estrangeiras, MESMO ao lado de um nome próprio ou marca (exemplos: "Eggs" → "Ovos"; "Sliced bread" → "Pão de forma fatiado"; "Sparkling water" → "Água com gás"; "Gorgonzola Doux/Piquant" → "Gorgonzola Suave/Picante"; "Multiusos Desinfectante Antibacterias" → "Multiuso Desinfetante Antibactérias"; "Raisin Sec Sultanine" → "Passa de Uva Sultana"). MARCAS e nomes próprios (incl. denominações como Gorgonzola, Hacendado) NÃO se traduzem, mas as palavras à volta SIM. VARIEDADES/DENOMINAÇÕES são NOMES PRÓPRIOS — mantém a variedade tal e qual e traduz só a palavra genérica à volta; NUNCA troques uma variedade por OUTRA. Queijos: "Cottage Cheese" → "Queijo Cottage" (NUNCA "Ricota"); "Cream Cheese" → "Queijo Creme"; "Cheddar/Mozzarella/Ricotta/Brie/Feta/Gouda Cheese" → "Queijo Cheddar/Mozzarella/Ricotta/Brie/Feta/Gouda". A mesma regra vale para variedades de outros alimentos (arroz Basmati, café Arábica, uva Sultana…). Se for indicada a CATEGORIA do produto, USA-A para desambiguar: quando o NOME é uma palavra comum mas a CATEGORIA diz outra coisa, o nome é o do BLEND/VARIEDADE — mantém-no SEM traduzir e antepõe o TIPO. Ex.: categoria CAFÉ + nome "Dessert"/"Crema"/"Gold"/"Classic" → "Café Dessert"/"Café Crema"/"Café Gold" (NUNCA "Sobremesa"/"Creme"); categoria CHÁ + nome "Forest Fruits" → "Chá Frutos do Bosque". Põe "mudou":true se traduziste QUALQUER palavra. Mantém números, percentagens, unidades e E-números tal como estão. Campo null fica null. Devolve SÓ JSON:
{"nome": string|null, "ingredientes": string|null, "alergenios": string|null, "mudou": boolean}
"mudou" = true só se traduziste alguma coisa.`;

export async function traduzirFichaPT(campos, { model, categoria } = {}) {
  const userMsg = categoria
    ? `CATEGORIA do produto (só contexto p/ desambiguar variedade/blend — NÃO é campo a traduzir): ${categoria}\n${JSON.stringify(campos)}`
    : JSON.stringify(campos);
  const conteudo = await chatCompletion({
    messages: [
      { role: 'system', content: PROMPT_TRADUZ },
      { role: 'user', content: userMsg },
    ],
    model: model || config.openrouter.modelConsulta,
    responseFormat: { type: 'json_object' },
    timeoutMs: 25000,
    contexto: 'traducao',
  });
  try { return JSON.parse(conteudo); } catch { return null; }
}

// 2 VOTOS INDEPENDENTES da tradução (dono, 2026-06-17): o tradutor às VEZES alucina e troca o
// TIPO de produto (caso real: "Mozzarella Queso" → "Ovo de Mozzarella"; queijo→ovo). Como sai
// "PT-plausível", a guarda nunca o re-verifica e fica cravado. Um VERIFICADOR (ver a tradução +
// dizer se está certa) NÃO serve — carimba a alucinação (anchoring). A solução é traduzir 2× de
// forma INDEPENDENTE e comparar o SIGNIFICADO. Funções puras/testáveis abaixo.
const STOP_TRAD = new Set(['de', 'do', 'da', 'dos', 'das', 'com', 'sem', 'em', 'para', 'por', 'e', 'o', 'a', 'os', 'as', 'no', 'na']);
const contentToks = (s) => (norm(s) || '').split(' ').filter((t) => t.length >= 3 && !STOP_TRAD.has(t) && !/\d/.test(t));
// Duas traduções do MESMO nome "concordam" se partilham ≥ metade dos tokens de CONTEÚDO do menor
// (robusto à grafia da denominação — "Muçarela"/"Mussarela" partilham "queijo"+"fatias"; mas
// "Queijo" e "Ovo" não partilham → apanha a troca de TIPO).
export function traducoesConcordam(n1, n2) {
  const a = new Set(contentToks(n1)), b = new Set(contentToks(n2));
  if (!a.size || !b.size) return true; // sem conteúdo comparável → não bloquear
  let shared = 0; for (const t of a) if (b.has(t)) shared++;
  return shared / Math.min(a.size, b.size) >= 0.5;
}
// Nome de CONSENSO entre N candidatos: o que concorda com MAIS dos outros (a alucinação fica
// isolada e perde). Empate → o 1.º.
export function consensoTraducao(nomes) {
  const vivos = nomes.filter(Boolean);
  if (vivos.length <= 1) return vivos[0] || null;
  let melhor = vivos[0], melhorScore = -1;
  for (const n of vivos) {
    const score = vivos.filter((m) => m !== n && traducoesConcordam(n, m)).length;
    if (score > melhorScore) { melhorScore = score; melhor = n; }
  }
  return melhor;
}

// Guarda anti re-tradução: o LLM corria a CADA chamada, mesmo com a ficha já em
// PT (o "mudou" só era avaliado DEPOIS de pagar a chamada). Um EAN tentado uma
// vez neste processo não volta a ir ao LLM — re-identificações e re-consultas
// deixam de pagar tradução repetida. (Reinício do processo permite 1 nova
// tentativa por EAN — desejável: a ficha pode ter mudado entretanto.)
const _tentados = new Set();

// Heurística leve: o nome ainda PARECE estrangeiro (substantivos comuns EN/ES/FR que
// nunca são marca) → vale a pena (re)tentar traduzir, mesmo já "tentado". Conservador
// (só nomes genéricos óbvios) para não re-pagar LLM em nomes PT ou marcas. Resolve o
// caso "Eggs" do Mercadona: um fire-and-forget anterior marcava o EAN e a chamada
// síncrona do scan-para-lista devolvia o inglês guardado SEM traduzir.
const NAO_PT = /\b(eggs?|milk|water|chicken|cheese|bread|sugar|butter|fresh|frozen|sliced|sparkling|whole|huevos?|leche|pollo|queso|az[uú]car|mantequilla|oeufs?|poulet|fromage|lait|beurre)\b/i;
export const pareceEstrangeiro = (nome) => !!nome && NAO_PT.test(nome);

// Garante que a ficha de um EAN está em PT (fire-and-forget nos fluxos de consulta/
// identificação; síncrono no backfill e no scan-para-lista). Atualiza só se o LLM
// traduziu algo. Devolve o NOME final em PT (traduzido ou o que já lá estava), ou
// null se não há ficha — para o chamador poder usar o nome PT diretamente.
export async function garantirFichaPT(pool, ean) {
  try {
    const [[r0]] = await pool.query('SELECT nome FROM produto_ean WHERE ean = ? ORDER BY id LIMIT 1', [ean]);
    // já tentado neste processo → devolve o nome atual, EXCETO se ainda parece
    // estrangeiro (tradução anterior falhou/não completou): aí re-tenta, para o
    // scan-para-lista não devolver o inglês guardado (caso "Eggs").
    if (_tentados.has(ean) && !pareceEstrangeiro(r0?.nome)) return r0?.nome || null;
    if (_tentados.size > 5000) _tentados.clear();
    _tentados.add(ean);
    const [[r]] = await pool.query('SELECT nome, ingredientes, alergenios, categoria FROM produto_ean WHERE ean = ?', [ean]);
    if (!r || (!r.nome && !r.ingredientes && !r.alergenios)) return r?.nome || null;
    const cat = r.categoria || null; // contexto p/ desambiguar blend/variedade (café "Dessert" ≠ sobremesa)
    // 2 VOTOS INDEPENDENTES e CROSS-FAMÍLIA (só na 1.ª tradução; re-leituras reusam o nome → zero LLM).
    // O 1.º traduz a ficha toda (gemini); o 2.º só o nome, numa FAMÍLIA DIFERENTE (OpenAI) — modelos
    // da mesma família alucinam igual e o consenso não apanha (caso cottage→ricota). Paralelos.
    const M1 = config.openrouter.modelConsulta, M2 = config.openrouter.modelTraducaoAlt;
    const [t, t2] = await Promise.all([
      traduzirFichaPT({ nome: r.nome, ingredientes: r.ingredientes, alergenios: r.alergenios }, { model: M1, categoria: cat }),
      traduzirFichaPT({ nome: r.nome }, { model: M2, categoria: cat }),
    ]);
    // GATE por QUALQUER voto: o voto-ficha (ingredientes no contexto) às vezes deixa passar um nome
    // estrangeiro que o voto-nome (focado) apanha — caso "Lessive Liquide". Só fica IGUAL se AMBOS
    // disserem que já é PT. Apanha falsos-negativos sem LLM extra (os 2 votos já corriam).
    if (!t?.mudou && !t2?.mudou) return r.nome || null;
    // nome: usa o voto-ficha quando ESSE traduziu; senão usa o voto-nome (o que apanhou o estrangeiro).
    let nomeTrad = (t?.mudou && t.nome) ? t.nome : (t2?.nome || t.nome || r.nome);
    // AMBOS traduziram mas DIVERGEM no significado → 3.º voto desempata por consenso (alucinação isolada).
    if (t?.mudou && t2?.mudou && t.nome && t2.nome && !traducoesConcordam(t.nome, t2.nome)) {
      const t3 = await traduzirFichaPT({ nome: r.nome }, { model: M1, categoria: cat });
      const consenso = consensoTraducao([t.nome, t2.nome, t3?.nome]);
      if (consenso) { console.warn('[traduz] votos divergiram → consenso:', JSON.stringify({ original: r.nome, votos: [t.nome, t2.nome, t3?.nome], consenso })); nomeTrad = consenso; }
    }
    const nomePT = tituloProduto(nomeTrad);
    // ingredientes/alergénios só do voto-ficha (o único que os traduz); se esse não mexeu, ficam os originais.
    await pool.query('UPDATE produto_ean SET nome = ?, ingredientes = ?, alergenios = ? WHERE ean = ?', [
      nomePT, t?.mudou ? (t.ingredientes ?? r.ingredientes) : r.ingredientes, t?.mudou ? (t.alergenios ?? r.alergenios) : r.alergenios, ean,
    ]);
    return nomePT;
  } catch (e) {
    console.error('[traduz]', ean, e.message);
    return null;
  }
}

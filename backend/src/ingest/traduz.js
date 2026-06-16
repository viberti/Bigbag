// Tradução da ficha de produto para o idioma do app (PT-BR): o Open Food Facts
// devolve nome/ingredientes/alergénios na língua do rótulo de origem (ES/FR/EN…).
// Regra: traduzir SÓ o que não está em português; MARCAS e nomes próprios nunca se
// traduzem. O original fica intacto no off_json — só as colunas de exibição mudam.
import { chatCompletion } from '../openrouter.js';
import { config } from '../config.js';
import { tituloProduto } from '../normaliza/titulo.js';

const PROMPT_TRADUZ = `Recebes campos da ficha de um produto de SUPERMERCADO — alimentar OU não-alimentar (limpeza, higiene, cosmética, casa, animais…) — (nome, ingredientes, alergenios), possivelmente noutra língua (espanhol, francês, INGLÊS, alemão…). Traduz para PORTUGUÊS DO BRASIL (PT-BR) TUDO o que NÃO estiver em português; o que já estiver em português fica EXATAMENTE igual (não reescrevas). Traduz SEMPRE as palavras descritivas estrangeiras, MESMO ao lado de um nome próprio ou marca (exemplos: "Eggs" → "Ovos"; "Sliced bread" → "Pão de forma fatiado"; "Sparkling water" → "Água com gás"; "Gorgonzola Doux/Piquant" → "Gorgonzola Suave/Picante"; "Multiusos Desinfectante Antibacterias" → "Multiuso Desinfetante Antibactérias"; "Raisin Sec Sultanine" → "Passa de Uva Sultana"). MARCAS e nomes próprios (incl. denominações como Gorgonzola, Hacendado) NÃO se traduzem, mas as palavras à volta SIM. Põe "mudou":true se traduziste QUALQUER palavra. Mantém números, percentagens, unidades e E-números tal como estão. Campo null fica null. Devolve SÓ JSON:
{"nome": string|null, "ingredientes": string|null, "alergenios": string|null, "mudou": boolean}
"mudou" = true só se traduziste alguma coisa.`;

export async function traduzirFichaPT(campos) {
  const conteudo = await chatCompletion({
    messages: [
      { role: 'system', content: PROMPT_TRADUZ },
      { role: 'user', content: JSON.stringify(campos) },
    ],
    model: config.openrouter.modelConsulta,
    responseFormat: { type: 'json_object' },
    timeoutMs: 25000,
    contexto: 'traducao',
  });
  try { return JSON.parse(conteudo); } catch { return null; }
}

// 2.º VOTO da tradução (dono, 2026-06-17): o tradutor às VEZES alucina e troca o TIPO de
// produto (caso real: "Mozzarella Queso" → "Ovo de Mozzarella"; queijo→ovo). Como sai
// "PT-plausível", a guarda nunca o re-verifica e fica cravado. Este 2.º voto olha o ORIGINAL +
// a tradução e corrige se o significado/tipo mudou — julga o SENTIDO (robusto à grafia
// Muçarela/Mussarela). Só corre na 1.ª tradução (re-leituras reusam o nome gravado).
const PROMPT_VERIFICA = `Verificas a TRADUÇÃO para PT-BR do NOME de um produto de supermercado. Recebes o NOME ORIGINAL (noutra língua) e uma TRADUÇÃO proposta. Confirma que a tradução preserva o MESMO produto — sobretudo o TIPO (queijo≠ovo, leite≠iogurte, atum≠frango…) e os termos descritivos. Se estiver correta, devolve-a IGUAL. Se trocou o tipo/significado ou inventou (ex.: "Queso"→"Ovo"), devolve a tradução CORRETA. MARCAS e denominações (Mozzarella, Gorgonzola, Hacendado) NÃO se traduzem. PT-BR. Devolve SÓ JSON: {"nome": string, "corrigido": boolean}`;

export async function verificarTraducaoNome(original, traduzido) {
  if (!original || !traduzido) return traduzido || null;
  try {
    const conteudo = await chatCompletion({
      messages: [{ role: 'system', content: PROMPT_VERIFICA }, { role: 'user', content: JSON.stringify({ original, traducao: traduzido }) }],
      model: config.openrouter.modelConsulta, responseFormat: { type: 'json_object' }, timeoutMs: 20000, contexto: 'traducao_verifica',
    });
    const j = JSON.parse(conteudo);
    const nome = j?.nome ? String(j.nome).trim() : traduzido;
    if (j?.corrigido && nome && nome !== traduzido) console.warn('[traduz] 2.º voto corrigiu:', JSON.stringify({ original, ruim: traduzido, bom: nome }));
    return nome || traduzido;
  } catch { return traduzido; } // verificação falhou → fica a 1.ª tradução (não pior que antes)
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
    const [[r]] = await pool.query('SELECT nome, ingredientes, alergenios FROM produto_ean WHERE ean = ?', [ean]);
    if (!r || (!r.nome && !r.ingredientes && !r.alergenios)) return r?.nome || null;
    const t = await traduzirFichaPT({ nome: r.nome, ingredientes: r.ingredientes, alergenios: r.alergenios });
    if (!t?.mudou) return r.nome || null;
    // 2.º VOTO só na 1.ª tradução: se o NOME mudou, um verificador confirma/corrige o tipo de
    // produto (apanha alucinações tipo "Queso"→"Ovo" antes de ficarem cravadas).
    let nomeTrad = t.nome ?? r.nome;
    if (t.nome && t.nome !== r.nome) nomeTrad = (await verificarTraducaoNome(r.nome, t.nome)) || t.nome;
    const nomePT = tituloProduto(nomeTrad);
    await pool.query('UPDATE produto_ean SET nome = ?, ingredientes = ?, alergenios = ? WHERE ean = ?', [
      nomePT, t.ingredientes ?? r.ingredientes, t.alergenios ?? r.alergenios, ean,
    ]);
    return nomePT;
  } catch (e) {
    console.error('[traduz]', ean, e.message);
    return null;
  }
}

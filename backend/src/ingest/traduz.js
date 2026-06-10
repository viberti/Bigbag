// Tradução da ficha de produto para o idioma do app (PT-BR): o Open Food Facts
// devolve nome/ingredientes/alergénios na língua do rótulo de origem (ES/FR/EN…).
// Regra: traduzir SÓ o que não está em português; MARCAS e nomes próprios nunca se
// traduzem. O original fica intacto no off_json — só as colunas de exibição mudam.
import { chatCompletion } from '../openrouter.js';
import { config } from '../config.js';
import { tituloProduto } from '../normaliza/titulo.js';

const PROMPT_TRADUZ = `Recebes campos da ficha de um produto alimentar (nome, ingredientes, alergenios), possivelmente noutra língua (espanhol, francês, inglês, alemão…). Traduz para PORTUGUÊS DO BRASIL (PT-BR) o que NÃO estiver em português; o que já estiver em português fica EXATAMENTE igual (não reescrevas). MARCAS e nomes próprios NUNCA se traduzem (ex.: "Yogur estilo griego natural" → "Iogurte estilo grego natural"; "Hacendado" fica "Hacendado"). Mantém números, percentagens, unidades e E-números tal como estão. Campo null fica null. Devolve SÓ JSON:
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

// Garante que a ficha de um EAN está em PT (fire-and-forget nos fluxos de consulta/
// identificação; síncrono no backfill). Atualiza só se o LLM traduziu algo.
export async function garantirFichaPT(pool, ean) {
  try {
    const [[r]] = await pool.query('SELECT nome, ingredientes, alergenios FROM produto_ean WHERE ean = ?', [ean]);
    if (!r || (!r.nome && !r.ingredientes && !r.alergenios)) return false;
    const t = await traduzirFichaPT({ nome: r.nome, ingredientes: r.ingredientes, alergenios: r.alergenios });
    if (!t?.mudou) return false;
    await pool.query('UPDATE produto_ean SET nome = ?, ingredientes = ?, alergenios = ? WHERE ean = ?', [
      tituloProduto(t.nome ?? r.nome),
      t.ingredientes ?? r.ingredientes,
      t.alergenios ?? r.alergenios,
      ean,
    ]);
    return true;
  } catch (e) {
    console.error('[traduz]', ean, e.message);
    return false;
  }
}

// Verificação de NOMES da leitura da nota — 3 camadas (Analise_Fontes; caso
// real "SALADA RIVA" lida como "SALARA RISO"):
//   1. SUSPEITA (grátis, determinística): nome NUNCA visto antes + sem hit em
//      produto_nome + o catálogo da cadeia não encontra nada plausível;
//   2. 2.ª OPINIÃO dirigida (1 chamada VLM, outra família de modelo, SÓ quando
//      há suspeitos): localiza as linhas pelo preço e re-transcreve o nome;
//   3. VOTO a 3: leitura1 × leitura2 × catálogo — duas fontes concordam →
//      corrige sozinho; divergência sem confirmação → fica o lido + 'duvida'.
// Tudo fica em `verificacao_nome` (ground truth p/ o harness de leitores).
// Só para notas lidas por VLM de IMAGEM (PDF-texto é exato, não tem este erro).
import { readFile } from 'node:fs/promises';
import { visionPrompt } from '../openrouter.js';
import { buscarCatalogo } from '../normaliza/resolverProduto.js';
import { resolverSku } from '../normaliza/matcher.js';

const MODELO_VERIFICACAO = process.env.OPENROUTER_MODEL_VERIFICACAO || 'google/gemini-3-flash-preview';
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// Camada 1 — itens desta fatura cujo nome não é confirmável por nenhuma fonte.
export async function detetarSuspeitos(pool, faturaId, cadeia) {
  const [itens] = await pool.query(
    'SELECT id, descricao_original, preco_liquido FROM item WHERE fatura_id = ? AND is_non_product = 0',
    [faturaId],
  );
  const out = [];
  for (const it of itens) {
    // (a) já visto em faturas ANTERIORES → leitura consistente entre compras
    const [[rep]] = await pool.query(
      'SELECT COUNT(*) n FROM item WHERE descricao_original = ? AND fatura_id <> ?',
      [it.descricao_original, faturaId],
    );
    if (rep.n > 0) continue;
    // (b) variante de nome conhecida (ligada a um EAN identificado)
    const [[pn]] = await pool.query('SELECT COUNT(*) n FROM produto_nome WHERE nome = ?', [it.descricao_original]);
    if (pn.n > 0) continue;
    // (c) o catálogo da cadeia reconhece o nome?
    let hit = null;
    try { hit = await buscarCatalogo(pool, it.descricao_original, { cadeia, limiar: 0.55 }); } catch { /* sem catálogo */ }
    if (hit) continue;
    out.push({ ...it, score_lido: 0 });
  }
  return out;
}

// Camada 2 — re-transcrição dirigida: localiza pelas âncoras de preço e pede o
// nome EXATO impresso (sem expandir nem corrigir — queremos a 2.ª leitura crua).
async function segundaOpiniao(ficheiro, suspeitos) {
  const buf = await readFile(ficheiro);
  const mime = /\.png$/i.test(ficheiro) ? 'image/png' : 'image/jpeg';
  const lista = suspeitos
    .map((s, i) => `${i + 1}. preço ${Number(s.preco_liquido).toFixed(2).replace('.', ',')} € — lemos "${s.descricao_original}"`)
    .join('\n');
  const prompt = `Imagem de um talão de supermercado português. Para cada linha abaixo (localiza-a pelo PREÇO), transcreve o NOME do produto EXATAMENTE como está impresso — carácter a carácter, sem expandir abreviaturas nem corrigir nada:
${lista}
Responde SÓ JSON: {"nomes": ["...", ...]} pela MESMA ordem; usa null se não encontrares a linha.`;
  const txt = await visionPrompt({
    prompt, imageBase64: buf.toString('base64'), mime,
    model: MODELO_VERIFICACAO, responseFormat: { type: 'json_object' }, contexto: 'verificar_nomes', timeoutMs: 45000,
  });
  try {
    const j = JSON.parse(String(typeof txt === 'string' ? txt : txt.content).replace(/```(json)?/g, ''));
    return Array.isArray(j.nomes) ? j.nomes : [];
  } catch { return []; }
}

// Camada 3 — voto (puro, testável): duas leituras iguais → confirmado; leituras
// diferentes → o catálogo desempata (a opinião só ganha com hit claramente
// melhor); divergência sem confirmação → fica o lido, marcado 'duvida'.
export function decidirNome({ lido, opiniao, scoreLido = 0, scoreOpiniao = 0 }) {
  const op = String(opiniao || '').trim();
  if (!op || op.toLowerCase() === 'null') return { resultado: 'duvida', nome: lido };
  if (norm(op) === norm(lido)) return { resultado: 'confirmado', nome: lido };
  if (scoreOpiniao >= 0.62 && scoreOpiniao > scoreLido + 0.1) return { resultado: 'corrigido', nome: op };
  return { resultado: 'duvida', nome: lido };
}

// Orquestrador (best-effort na ingestão). Devolve um resumo p/ a resposta/toast.
export async function verificarNomesFatura(pool, faturaId, { aplicar = true } = {}) {
  const [[f]] = await pool.query(
    `SELECT f.ficheiro_original, f.metodo_extracao, l.cadeia FROM fatura f JOIN loja l ON l.id = f.loja_id WHERE f.id = ?`,
    [faturaId],
  );
  if (!f || f.metodo_extracao !== 'vlm' || !f.ficheiro_original || /\.pdf$/i.test(f.ficheiro_original)) {
    return { suspeitos: 0, corrigidos: [], duvidas: 0 };
  }
  const suspeitos = await detetarSuspeitos(pool, faturaId, f.cadeia);
  if (!suspeitos.length) return { suspeitos: 0, corrigidos: [], duvidas: 0 };

  let nomes = [];
  try { nomes = await segundaOpiniao(f.ficheiro_original, suspeitos); }
  catch (e) { console.error('[verificarNomes] 2.ª opinião:', e.message); }

  const corrigidos = [];
  let duvidas = 0;
  for (let i = 0; i < suspeitos.length; i++) {
    const s = suspeitos[i];
    const opiniao = nomes[i] || null;
    let scoreOpiniao = 0;
    if (opiniao && norm(opiniao) !== norm(s.descricao_original)) {
      try { scoreOpiniao = (await buscarCatalogo(pool, opiniao, { cadeia: f.cadeia, limiar: 0.55 }))?.score || 0; } catch { /* fica 0 */ }
    }
    const d = decidirNome({ lido: s.descricao_original, opiniao, scoreLido: s.score_lido, scoreOpiniao });
    if (d.resultado === 'duvida') duvidas++;
    await pool.query(
      'INSERT INTO verificacao_nome (fatura_id, item_id, lido, opiniao, score_lido, score_opiniao, resultado, modelo) VALUES (?,?,?,?,?,?,?,?)',
      [faturaId, s.id, s.descricao_original, opiniao, s.score_lido, scoreOpiniao, d.resultado, MODELO_VERIFICACAO],
    );
    if (d.resultado === 'corrigido' && aplicar) {
      // duas fontes independentes concordam (2.ª leitura + catálogo) → corrige e
      // re-resolve o SKU para o nome certo (o ppb recomputa-se a seguir na rota).
      await pool.query('UPDATE item SET descricao_original = ?, sku_id = NULL WHERE id = ?', [String(d.nome).slice(0, 200), s.id]);
      try {
        const r = await resolverSku(pool, d.nome, { cadeia: f.cadeia });
        if (r.sku_id) await pool.query('UPDATE item SET sku_id = ? WHERE id = ?', [r.sku_id, s.id]);
      } catch (e) { console.error('[verificarNomes] re-resolver:', e.message); }
      corrigidos.push({ de: s.descricao_original, para: d.nome });
      console.log(`[verificarNomes] corrigido: "${s.descricao_original}" → "${d.nome}"`);
    }
  }
  return { suspeitos: suspeitos.length, corrigidos, duvidas };
}

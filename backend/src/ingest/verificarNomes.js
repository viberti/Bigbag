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
// Falha VISÍVEL: se a 2.ª opinião não corre (modelo descontinuado, timeout, JSON
// inválido), o resultado é estado 'nao_verificado' + linhas 'nao_verificado' em
// verificacao_nome — nunca um [] mudo que se confunde com "nada a corrigir".
import { readFile } from 'node:fs/promises';
import { config } from '../config.js';
import { visionPrompt } from '../openrouter.js';
import { buscarCatalogo } from '../normaliza/resolverProduto.js';
import { resolverSku } from '../normaliza/matcher.js';

// Família do modelo = o fornecedor no id do OpenRouter ("google/…", "openai/…").
// A 2.ª opinião só vale se for de OUTRA família que o extrator: modelos da mesma
// família erram da mesma maneira (regra dos votos cross-família).
export const familiaModelo = (id) => String(id || '').split('/')[0].toLowerCase();
export const mesmaFamilia = (a, b) => familiaModelo(a) !== '' && familiaModelo(a) === familiaModelo(b);
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// Camada 1 — itens desta fatura cujo nome não é confirmável por nenhuma fonte.
export async function detetarSuspeitos(pool, faturaId, cadeia) {
  // TODAS as linhas (incl. depósito/saco): o ordinal "N.ª linha com este preço" tem de
  // contar o que está IMPRESSO, e o VLM também vê as não-produto. Só produtos são suspeitos.
  const [itens] = await pool.query(
    'SELECT id, descricao_original, preco_liquido, is_non_product FROM item WHERE fatura_id = ? ORDER BY id',
    [faturaId],
  );
  const out = [];
  for (const it of itens) {
    if (it.is_non_product) continue;
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
    // âncora p/ a 2.ª opinião cega: ordinal entre as linhas com o MESMO preço
    const mesmos = itens.filter((x) => Number(x.preco_liquido) === Number(it.preco_liquido));
    const { is_non_product: _np, ...linha } = it;
    out.push({ ...linha, score_lido: 0, ordem_preco: mesmos.indexOf(it) + 1, n_mesmo_preco: mesmos.length });
  }
  return out;
}

// Camada 2 — re-transcrição dirigida e CEGA: localiza pelas âncoras de preço e pede
// o nome EXATO impresso. NÃO mostra a 1.ª leitura: no banco de provas (2026-09-29) os
// VLM não-Google, com "lemos X" no prompt, devolviam X tal e qual (copiavam o erro
// "DOLA OKA LAMINADA" em vez de ler "CEBOLA ROXA LAMINADA") → a 2.ª opinião deixava
// de ser independente. Pura (testável).
export function montarPromptOpiniao(suspeitos) {
  const lista = suspeitos.map((s, i) => {
    const preco = Number(s.preco_liquido).toFixed(2).replace('.', ',');
    const ord = s.n_mesmo_preco > 1 && s.ordem_preco > 0
      ? ` (a ${s.ordem_preco}.ª de ${s.n_mesmo_preco} linhas com este preço, de cima para baixo)` : '';
    return `${i + 1}. a linha com o preço ${preco} €${ord}`;
  }).join('\n');
  return `Imagem de um talão de supermercado português. Para cada linha abaixo (localiza-a pelo PREÇO), transcreve o NOME do produto EXATAMENTE como está impresso — carácter a carácter, sem expandir abreviaturas nem corrigir nada. Não incluas o código de IVA entre parênteses nem quantidades/preços unitários:
${lista}
Responde SÓ JSON: {"nomes": ["...", ...]} pela MESMA ordem; usa null se não encontrares a linha.`;
}

// Resposta do VLM → array de nomes. LANÇA se não for interpretável (o chamador
// transforma isso em 'nao_verificado'); só um array válido conta como opinião.
// Com `esperado`, o nº de nomes tem de bater: um a mais/menos significa que o modelo
// saltou ou reordenou linhas → as posições desalinham e cada opinião iria parar ao
// suspeito errado. Melhor 'nao_verificado' honesto do que dúvidas falsas.
export function interpretarOpiniao(txt, esperado = null) {
  const bruto = String(txt && typeof txt === 'object' ? txt.content : txt || '').replace(/```(json)?/g, '');
  const ini = bruto.indexOf('{');
  const fim = bruto.lastIndexOf('}');
  if (ini < 0 || fim < ini) throw new Error(`resposta sem JSON: ${bruto.slice(0, 80)}`);
  const j = JSON.parse(bruto.slice(ini, fim + 1));
  if (!Array.isArray(j.nomes)) throw new Error('JSON sem array "nomes"');
  if (esperado != null && j.nomes.length !== esperado) {
    throw new Error(`resposta com ${j.nomes.length} nomes para ${esperado} linhas (desalinhada)`);
  }
  return j.nomes.map((n) => (n == null ? null : String(n)));
}

export async function segundaOpiniao(ficheiro, suspeitos, { model = config.openrouter.modelVerificacao } = {}) {
  const buf = await readFile(ficheiro);
  const mime = /\.png$/i.test(ficheiro) ? 'image/png' : 'image/jpeg';
  const txt = await visionPrompt({
    prompt: montarPromptOpiniao(suspeitos), imageBase64: buf.toString('base64'), mime,
    model, responseFormat: { type: 'json_object' }, contexto: 'verificar_nomes', timeoutMs: 45000,
  });
  return interpretarOpiniao(txt, suspeitos.length);
}

// Semelhança de caracteres 0..1 (1 − Levenshtein/comprimento) entre nomes normalizados.
export function semelhanca(a, b) {
  const x = norm(a); const y = norm(b);
  if (!x && !y) return 1;
  const d = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let diag = d[0]; d[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, diag + (x[i - 1] === y[j - 1] ? 0 : 1));
      diag = t;
    }
  }
  return 1 - d[y.length] / Math.max(x.length, y.length);
}

// Uma releitura legítima do MESMO texto impresso difere por erros de OCR ("DOLA OKA
// LAMINADA"↔"CEBOLA ROXA LAMINADA" 0,76; "REAM CRACKER"↔"CREAM CRACKER" 0,92). Abaixo
// disto a opinião é OUTRA linha (o verificador localizou mal: "CBIPACK ESCOVA"→"SALMAO
// FUMADO" 0,19). Calibrado no banco de provas 2026-09-29: trocas ≤0,54, legítimas ≥0,60.
export const SEMELHANCA_MIN_CORRECAO = 0.6;

// Camada 3 — voto (puro, testável): duas leituras iguais → confirmado; leituras
// diferentes → o catálogo desempata (a opinião só ganha com hit claramente
// melhor); divergência sem confirmação → fica o lido, marcado 'duvida'.
// Salvaguardas contra a opinião de OUTRA linha (o catálogo "confirma" qualquer
// produto real, logo sozinho não chega — sem elas gravava-se o nome errado):
//   * a opinião é o nome de outra linha do mesmo talão → dúvida;
//   * a opinião não se parece com o lido (< SEMELHANCA_MIN_CORRECAO) → dúvida.
// O código de IVA "(A) " à cabeça não faz parte do nome (alguns VLM incluem-no).
export const limparOpiniao = (s) => String(s ?? '').trim().replace(/^\(\w\)\s+/, '');

export function decidirNome({ lido, opiniao, scoreLido = 0, scoreOpiniao = 0, outrosNomes = [] }) {
  const op = limparOpiniao(opiniao);
  if (!op || op.toLowerCase() === 'null') return { resultado: 'duvida', nome: lido };
  if (norm(op) === norm(lido)) return { resultado: 'confirmado', nome: lido };
  if (outrosNomes.some((n) => norm(n) === norm(op))) return { resultado: 'duvida', nome: lido, motivo: 'outra_linha' };
  if (semelhanca(lido, op) < SEMELHANCA_MIN_CORRECAO) return { resultado: 'duvida', nome: lido, motivo: 'leitura_distante' };
  if (scoreOpiniao >= 0.62 && scoreOpiniao > scoreLido + 0.1) return { resultado: 'corrigido', nome: op };
  return { resultado: 'duvida', nome: lido };
}

// Orquestrador (best-effort na ingestão). Devolve um resumo p/ a resposta/job:
//   estado: 'nao_aplicavel' (PDF/sem imagem) | 'sem_suspeitos' | 'verificado'
//         | 'nao_verificado' (havia suspeitos mas a 2.ª opinião falhou → `erro`).
export async function verificarNomesFatura(pool, faturaId, { aplicar = true } = {}) {
  const modelo = config.openrouter.modelVerificacao;
  const [[f]] = await pool.query(
    `SELECT f.ficheiro_original, f.metodo_extracao, l.cadeia FROM fatura f JOIN loja l ON l.id = f.loja_id WHERE f.id = ?`,
    [faturaId],
  );
  if (!f || f.metodo_extracao !== 'vlm' || !f.ficheiro_original || /\.pdf$/i.test(f.ficheiro_original)) {
    return { estado: 'nao_aplicavel', suspeitos: 0, corrigidos: [], duvidas: 0 };
  }
  const suspeitos = await detetarSuspeitos(pool, faturaId, f.cadeia);
  if (!suspeitos.length) return { estado: 'sem_suspeitos', suspeitos: 0, corrigidos: [], duvidas: 0 };
  if (mesmaFamilia(modelo, config.openrouter.modelExtracao)) {
    console.warn(`[verificarNomes] AVISO: verificador (${modelo}) é da mesma família do extrator (${config.openrouter.modelExtracao}) — a 2.ª opinião não é independente`);
  }

  let nomes;
  try { nomes = await segundaOpiniao(f.ficheiro_original, suspeitos, { model: modelo }); }
  catch (e) {
    // NÃO é "nada a corrigir": os suspeitos ficam registados como não verificados.
    const erro = String(e.message || e).slice(0, 200);
    console.error(`[verificarNomes] fatura ${faturaId}: 2.ª opinião FALHOU (${modelo}) — ${suspeitos.length} suspeito(s) ficam nao_verificado: ${erro}`);
    for (const s of suspeitos) {
      await pool.query(
        'INSERT INTO verificacao_nome (fatura_id, item_id, lido, opiniao, score_lido, score_opiniao, resultado, motivo, modelo) VALUES (?,?,?,?,?,?,?,?,?)',
        [faturaId, s.id, s.descricao_original, null, s.score_lido, null, 'nao_verificado', erro, modelo],
      );
    }
    return { estado: 'nao_verificado', suspeitos: suspeitos.length, corrigidos: [], duvidas: 0, erro };
  }

  const [todos] = await pool.query('SELECT id, descricao_original, preco_liquido FROM item WHERE fatura_id = ?', [faturaId]);
  const corrigidos = [];
  let duvidas = 0;
  let feitos = 0; // suspeitos já registados — a partir daqui a verificação CORREU (mesmo que pare a meio)
  try {
    for (let i = 0; i < suspeitos.length; i++) {
      const s = suspeitos[i];
      // linhas com o MESMO preço ficam fora da salvaguarda "outra linha": o mesmo produto
      // passado 2× no talão tem o mesmo nome e preço — a leitura certa do mal-lido É o
      // nome do gémeo, e isso não é troca de linha (seria bloquear a correção certa).
      const outrosNomes = todos
        .filter((t) => t.id !== s.id && Number(t.preco_liquido) !== Number(s.preco_liquido))
        .map((t) => t.descricao_original);
      const opiniao = limparOpiniao(nomes[i]) || null;
      let scoreOpiniao = 0;
      if (opiniao && norm(opiniao) !== norm(s.descricao_original)) {
        try { scoreOpiniao = (await buscarCatalogo(pool, opiniao, { cadeia: f.cadeia, limiar: 0.55 }))?.score || 0; } catch { /* fica 0 */ }
      }
      const d = decidirNome({ lido: s.descricao_original, opiniao, scoreLido: s.score_lido, scoreOpiniao, outrosNomes });
      if (d.resultado === 'duvida') duvidas++;
      await pool.query(
        'INSERT INTO verificacao_nome (fatura_id, item_id, lido, opiniao, score_lido, score_opiniao, resultado, motivo, modelo) VALUES (?,?,?,?,?,?,?,?,?)',
        [faturaId, s.id, s.descricao_original, opiniao ? String(opiniao).slice(0, 200) : null, s.score_lido, scoreOpiniao, d.resultado, d.motivo || null, modelo],
      );
      feitos++;
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
  } catch (e) {
    // Erro DEPOIS da opinião (BD a meio do registo): não é "o verificador não correu".
    // Se já registou algum suspeito, a verificação correu (e pode já ter corrigido itens)
    // → 'verificado' com `parcial`; se não registou nenhum, nada ficou verificado.
    const erro = String(e.message || e).slice(0, 200);
    console.error(`[verificarNomes] fatura ${faturaId}: erro após a 2.ª opinião (${feitos}/${suspeitos.length} registados): ${erro}`);
    return { estado: feitos ? 'verificado' : 'nao_verificado', parcial: true, suspeitos: suspeitos.length, corrigidos, duvidas, erro };
  }
  return { estado: 'verificado', suspeitos: suspeitos.length, corrigidos, duvidas };
}

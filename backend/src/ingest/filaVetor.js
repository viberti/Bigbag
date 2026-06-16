// FILA DE VETORIZAÇÃO EM FUNDO (2026-06-16, ideia do dono "falha hoje, acerta amanhã"):
// quando o download da imagem de um candidato OFF dá timeout no caminho SÍNCRONO do
// acharGemeo, em vez de desistir enfileira-se {ean, imagem_url}. Um worker em fundo baixa
// com CALMA (timeout largo, várias tentativas), vetoriza e faz upsert no Qdrant → da próxima
// vez que o produto aparecer já lá está. Idempotente (ean PK), gentil (lote pequeno, baixa
// frequência — o embed do infer é CPU partilhado). Tabela: migração 065.
import { vetorizarVariasB64, upsertVetores } from '../normaliza/matchImagem.js';

const QDRANT = process.env.QDRANT_URL || 'http://localhost:6333';
const COL = process.env.QDRANT_COLLECTION || 'produtos_img';
const MAX_TENT = 5;

// Enfileira candidatos. INSERT IGNORE → não toca em linhas já existentes/processadas.
// itens: [{ean, imagem_url, fonte}]. Devolve quantos eram elegíveis.
export async function enfileirar(pool, itens) {
  const linhas = (itens || []).filter((c) => c?.ean && c?.imagem_url && /^\d{8,14}$/.test(String(c.ean)));
  if (!linhas.length) return 0;
  const vals = linhas.map((c) => [String(c.ean), String(c.imagem_url), c.fonte || 'off']);
  await pool.query('INSERT IGNORE INTO fila_vetorizar (ean, imagem_url, fonte) VALUES ?', [vals]);
  return linhas.length;
}

// Quais destes EANs já têm ponto no Qdrant (id do ponto = Number(ean)). Devolve Set de strings.
async function jaNoQdrant(eans) {
  if (!eans.length) return new Set();
  try {
    const r = await fetch(`${QDRANT}/collections/${COL}/points`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: eans.map(Number), with_payload: false, with_vector: false }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return new Set();
    const d = await r.json();
    return new Set((d.result || []).map((p) => String(p.id)));
  } catch { return new Set(); }
}

// Baixa uma imagem com timeout LARGO (em fundo, sem pressa). null se falhar.
async function baixar(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer()).toString('base64');
  } catch { return null; }
}

// Processa um lote da fila: marca feitos os que já estão no Qdrant, baixa+vetoriza+upsert os
// restantes; falhas incrementam tentativas (desiste após MAX_TENT). Devolve contadores.
export async function processarFila(pool, { lote = 5 } = {}) {
  const [pend] = await pool.query(
    'SELECT ean, imagem_url, fonte FROM fila_vetorizar WHERE processado_em IS NULL AND tentativas < ? ORDER BY criado_em LIMIT ?',
    [MAX_TENT, lote],
  );
  if (!pend.length) return { processados: 0, falhados: 0, jaLa: 0 };
  const naBase = await jaNoQdrant(pend.map((p) => p.ean));
  let jaLa = 0, processados = 0, falhados = 0;
  const aBaixar = [];
  for (const p of pend) {
    if (naBase.has(String(Number(p.ean)))) {
      await pool.query('UPDATE fila_vetorizar SET processado_em = NOW() WHERE ean = ?', [p.ean]);
      jaLa++;
    } else aBaixar.push(p);
  }
  if (aBaixar.length) {
    const b64s = await Promise.all(aBaixar.map((p) => baixar(p.imagem_url)));
    const ok = []; const okB64 = [];
    for (let i = 0; i < aBaixar.length; i++) {
      if (b64s[i]) { ok.push(aBaixar[i]); okB64.push(b64s[i]); }
      else { await pool.query('UPDATE fila_vetorizar SET tentativas = tentativas + 1, ultimo_erro = ? WHERE ean = ?', ['download', aBaixar[i].ean]); falhados++; }
    }
    if (okB64.length) {
      const vecs = await vetorizarVariasB64(okB64);
      const novos = [];
      for (let i = 0; i < ok.length; i++) {
        if (vecs[i]) novos.push({ ean: ok[i].ean, vec: vecs[i], fonte: ok[i].fonte || 'off' });
        else { await pool.query('UPDATE fila_vetorizar SET tentativas = tentativas + 1, ultimo_erro = ? WHERE ean = ?', ['embed', ok[i].ean]); falhados++; }
      }
      if (novos.length) {
        await upsertVetores(novos);
        await pool.query('UPDATE fila_vetorizar SET processado_em = NOW() WHERE ean IN (?)', [novos.map((n) => String(n.ean))]);
        processados = novos.length;
      }
    }
  }
  return { processados, falhados, jaLa };
}

let aCorrer = false;
// Worker em fundo: processa um lote a cada intervalo. Não-reentrante (salta se ainda a correr).
// unref → não segura o processo vivo no encerramento.
export function iniciarWorkerFila(pool, { intervaloMs = 180000, lote = 5 } = {}) {
  const tick = async () => {
    if (aCorrer) return;
    aCorrer = true;
    try {
      const r = await processarFila(pool, { lote });
      if (r.processados || r.falhados) console.log(`[fila-vetor] +${r.processados} vetorizados · ${r.jaLa} já no corpo · ${r.falhados} falhas`);
    } catch (e) { console.error('[fila-vetor] erro:', e.message); }
    finally { aCorrer = false; }
  };
  const t = setInterval(tick, intervaloMs);
  t.unref?.();
  return t;
}

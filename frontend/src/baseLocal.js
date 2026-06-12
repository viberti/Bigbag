// BASE LOCAL de produtos (réplica do conhecimento do servidor no telefone):
// o scan no mercado responde INSTANTÂNEO e OFFLINE para produtos que já conhecemos.
// Duas camadas em IndexedDB (dbLocal.js):
//   fichas   — ricas (nutrição/ingredientes/análise), poucas centenas → sync completo
//   catalogo — nome→EAN (dezenas de milhares, sem nutrição) → incremental por cursor
// Cresce com o uso: cada consulta externa (OFF/catálogo) é persistida no servidor
// (consultarOuGuardar) e entra aqui na sincronização seguinte.
import { txStore } from './dbLocal.js';
import { getAuth } from './api.js';

const KEY_TS = 'bb_base_sync_ts';
const KEY_CURSOR = 'bb_base_cat_cursor';
const KEY_VER = 'bb_base_ver';
// Versão da base: INCREMENTAR quando o servidor re-normaliza dados existentes
// (ex.: capitalização uniforme) — o cursor incremental não os re-desceria.
// Mudança de versão → resync completo na próxima sincronização.
const BASE_VER = '3'; // v3: nome_pt do Mercadona no catálogo (era ES no scan)
const INTERVALO_MS = 60 * 60 * 1000; // 1 h entre sincronizações automáticas

const parse = (j) => { try { return j ? (typeof j === 'string' ? JSON.parse(j) : j) : null; } catch { return null; } };

// Ficha rica local pelo EAN (nutrição/análise) — ou null.
export function fichaLocal(ean) {
  return txStore('fichas', 'readonly', (s) => s.get(String(ean))).catch(() => null);
}
// Entrada do catálogo (só nome/marca/tamanho) pelo EAN — ou null.
export function catalogoLocal(ean) {
  return txStore('catalogo', 'readonly', (s) => s.get(String(ean))).catch(() => null);
}

async function guardarLote(store, linhas) {
  if (!linhas?.length) return;
  await txStore(store, 'readwrite', (s) => { for (const l of linhas) if (l?.ean) s.put(l); });
}

// Sincroniza com o servidor (fire-and-forget; auto-limitada a 1x/hora salvo forcar).
// Fichas vêm sempre completas; o catálogo avança por cursor, em chunks, até ao fim
// (máx. 10 chunks por chamada — o resto continua na próxima).
export async function sincronizarBaseLocal({ forcar = false } = {}) {
  try {
    if (localStorage.getItem(KEY_VER) !== BASE_VER) {
      localStorage.removeItem(KEY_TS);
      localStorage.setItem(KEY_CURSOR, '0');
      localStorage.setItem(KEY_VER, BASE_VER);
    }
    const agora = Date.now();
    if (!forcar && agora - (Number(localStorage.getItem(KEY_TS)) || 0) < INTERVALO_MS) return;
    const auth = getAuth();
    if (!auth) return;
    let cursor = Number(localStorage.getItem(KEY_CURSOR)) || 0;
    for (let i = 0; i < 10; i++) {
      const r = await fetch(`/api/produto/base-local?catalogo_desde_id=${cursor}`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!r.ok) return;
      const d = await r.json();
      if (i === 0) {
        await guardarLote('fichas', (d.fichas || []).map((f) => ({
          ean: String(f.ean),
          nome: f.nome, marca: f.marca, quantidade: f.quantidade, categoria: f.categoria,
          ingredientes: f.ingredientes, alergenios: f.alergenios,
          nutricao_100g: parse(f.nutricao), nutricao_confirmada: f.nutricao_confirmada,
          analise: parse(f.analise), fonte: f.fonte,
        })));
      }
      await guardarLote('catalogo', (d.catalogo || []).map((c) => ({
        ean: String(c.ean), nome: c.nome, marca: c.marca, quantidade: c.quantidade,
      })));
      cursor = d.catalogo_cursor || cursor;
      localStorage.setItem(KEY_CURSOR, String(cursor));
      if (d.catalogo_fim) break;
    }
    localStorage.setItem(KEY_TS, String(agora));
  } catch {
    /* offline/falha → fica para a próxima */
  }
}

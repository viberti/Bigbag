// BUSCA LOCAL nas compras: réplica no telefone do histórico de itens comprados
// (produto, loja, data, preço) → o utilizador pesquisa "o que comprei, onde, quando e
// quanto paguei" INSTANTÂNEO e OFFLINE, sem ir ao servidor a cada tecla.
// Os itens vivem na store `compras` (dbLocal.js, chave = item.id); a sincronização é
// INCREMENTAL por cursor de id (só desce o que é novo). Um campo `_b` (nome+marca
// normalizado, sem acentos) é pré-computado no armazenamento p/ o filtro ser barato.
import { txStore } from './dbLocal.js';
import { itensComprados } from './api.js';

const KEY_CURSOR = 'bb_compras_cursor';
const KEY_TS = 'bb_compras_sync_ts';
const KEY_VER = 'bb_compras_ver';
const VER = '1'; // INCREMENTAR → resync total (ex.: mudou a resolução de nome no servidor)
const INTERVALO_MS = 30 * 60 * 1000; // 30 min entre sincronizações automáticas

// minúsculas + sem acentos → o match é insensível a acento/caixa ("cafe" acha "Café").
export function normBusca(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function limparCompras() {
  return txStore('compras', 'readwrite', (s) => s.clear()).catch(() => {});
}

async function guardarLote(itens) {
  if (!itens?.length) return;
  await txStore('compras', 'readwrite', (s) => {
    for (const it of itens) {
      if (it?.id == null) continue;
      s.put({ ...it, _b: normBusca(`${it.produto || ''} ${it.marca || ''}`) });
    }
  });
}

// Sincroniza o histórico de itens (fire-and-forget; auto-limitada a 1x/30min salvo forçar).
export async function sincronizarCompras({ forcar = false } = {}) {
  try {
    if (localStorage.getItem(KEY_VER) !== VER) {
      localStorage.removeItem(KEY_TS);
      localStorage.setItem(KEY_CURSOR, '0');
      localStorage.setItem(KEY_VER, VER);
      await limparCompras();
    }
    const agora = Date.now();
    if (!forcar && agora - (Number(localStorage.getItem(KEY_TS)) || 0) < INTERVALO_MS) return;
    let cursor = Number(localStorage.getItem(KEY_CURSOR)) || 0;
    for (let i = 0; i < 20; i++) {
      const d = await itensComprados(cursor);
      await guardarLote(d.itens || []);
      cursor = Number(d.cursor) || cursor;
      localStorage.setItem(KEY_CURSOR, String(cursor));
      if (d.fim) break;
    }
    localStorage.setItem(KEY_TS, String(agora));
  } catch {
    /* offline/falha → fica para a próxima */
  }
}

function todasCompras() {
  return txStore('compras', 'readonly', (s) => s.getAll()).catch(() => []);
}

// Ordena por data decrescente (compra mais recente primeiro), desempata por id.
function porRecencia(a, b) {
  const da = String(a.data || ''); const db = String(b.data || '');
  if (da !== db) return da < db ? 1 : -1;
  return (b.id || 0) - (a.id || 0);
}

// Cada resultado é UMA compra (ocorrência) do item — como no ecrã de referência, o mesmo
// produto comprado em datas diferentes aparece em linhas separadas. Match: TODOS os termos.
export async function buscarCompras(q) {
  const termo = normBusca(q).trim();
  if (!termo) return [];
  const termos = termo.split(/\s+/).filter(Boolean);
  const todas = await todasCompras();
  return todas
    .filter((it) => termos.every((t) => (it._b || '').includes(t)))
    .sort(porRecencia);
}

// Autocomplete: nomes DISTINTOS de produtos (mais frequentes primeiro). Sem prefixo →
// os produtos mais comprados (para os chips do estado vazio).
export async function sugestoesCompras(prefixo = '', limite = 6) {
  const p = normBusca(prefixo).trim();
  const todas = await todasCompras();
  const cont = new Map(); // chave(nome minúsculo) → { nome, n, _b }
  for (const it of todas) {
    const nome = it.produto;
    if (!nome) continue;
    const chave = String(nome).toLowerCase();
    const cur = cont.get(chave) || { nome, n: 0, _b: it._b || normBusca(nome) };
    cur.n += 1;
    cont.set(chave, cur);
  }
  let arr = [...cont.values()];
  if (p) arr = arr.filter((x) => (x._b || '').includes(p));
  arr.sort((a, b) => b.n - a.n);
  return arr.slice(0, limite).map((x) => x.nome);
}

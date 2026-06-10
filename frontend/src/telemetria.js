// Telemetria de uso (cliente): junta eventos só-UI e envia em LOTE, fire-and-forget.
// Só QUAL ação (nome do evento + props mínimas), NUNCA conteúdo. A maioria das
// funcionalidades já é captada no servidor (cada endpoint) — isto é para as ações
// que não tocam no backend (trocar de vista, abrir menu/carrinho).
import { getAuth } from './api.js';

const SESSAO = Math.random().toString(36).slice(2, 12); // id da visita (sem fingerprint)
let fila = [];
let timer = null;

function enviar() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!fila.length) return;
  const lote = fila;
  fila = [];
  const auth = getAuth();
  try {
    fetch('/api/telemetria', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Basic ${auth}` } : {}) },
      body: JSON.stringify({ eventos: lote }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* noop */
  }
}

export function track(evento, props) {
  if (!evento) return;
  fila.push({ evento, props: props || null, sessao: SESSAO });
  if (fila.length >= 20) enviar();
  else if (!timer) timer = setTimeout(enviar, 4000); // agrupa ~4s
}

// garante o envio do que falta ao esconder/fechar a app
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.hidden) enviar(); });
  window.addEventListener('pagehide', enviar);
}

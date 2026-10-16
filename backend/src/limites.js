// Limitadores em memória (processo único — o backend corre num só processo systemd).
// Usados no login (força bruta) e no /precos-ao-vivo (ronda às farmácias). Puros: testáveis.

// IP REAL do cliente atrás do Apache: o Apache ACRESCENTA o IP de quem ligou no FIM do
// X-Forwarded-For; o início da lista vem do cliente e pode ser forjado. Sem o header → req.ip.
export function ipCliente(req) {
  const xff = String(req?.get?.('X-Forwarded-For') || req?.headers?.['x-forwarded-for'] || '');
  return xff.split(',').map((x) => x.trim()).filter(Boolean).pop() || req?.ip || '?';
}

// Conta FALHAS por chave numa janela deslizante. `bloqueado(k)` = atingiu o máximo.
export function criarLimitador({ max, janelaMs, limiteChaves = 10000 }) {
  const mapa = new Map(); // chave → [timestamps]
  const vivos = (k, agora) => (mapa.get(k) || []).filter((t) => agora - t < janelaMs);
  return {
    bloqueado(k, agora = Date.now()) { return vivos(k, agora).length >= max; },
    falhou(k, agora = Date.now()) {
      const v = vivos(k, agora); v.push(agora); mapa.set(k, v);
      if (mapa.size > limiteChaves) mapa.clear();
    },
    limpar(k) { mapa.delete(k); },
  };
}

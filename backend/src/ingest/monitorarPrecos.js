// Monitor periódico (4/4h) de preço + ESTOQUE dos remédios "monitorados" (tabela
// medicamento_monitorado, hoje OZEMPIC+MOUNJARO). Para cada EAN COM OFERTA desses produtos,
// consulta TODAS as farmácias VTEX ao vivo (proxy nas geo) e grava 1 linha por (ean×farmácia)
// em medicamento_monitor_hist — histórico denso de variação de preço e de disponibilidade.
// NÃO apaga nada (append-only). Corre pelo cron (scripts/monitorar_precos.mjs).
import { readFileSync } from 'node:fs';
import { getPool } from '../db.js';
import { precoEstoqueVtex } from './precoVivo.js';

const MANIFESTO = JSON.parse(readFileSync(new URL('../../scripts/fontes_farmacia.json', import.meta.url), 'utf8'));
const VTEX = MANIFESTO.filter((f) => (f.motor || 'vtex') === 'vtex'); // monitor cobre as VTEX (preço+estoque por EAN)

export async function monitorarMonitorados({ log = console.log } = {}) {
  const pool = getPool();
  // EANs COM oferta dos produtos monitorados (não adianta monitorar EAN que ninguém vende).
  const [eans] = await pool.query(
    `SELECT DISTINCT m.ean, m.produto FROM medicamento m
       JOIN medicamento_monitorado mm ON UPPER(m.produto) = mm.produto AND mm.ativo = 1
      WHERE EXISTS (SELECT 1 FROM catalogo_produto cp WHERE cp.ean = m.ean AND cp.preco > 0 AND cp.moeda = 'BRL')`,
  );
  if (!eans.length) { log('[monitor] nenhum EAN monitorado com oferta'); return { eans: 0, linhas: 0 }; }

  let linhas = 0, esgotados = 0;
  for (const { ean, produto } of eans) {
    const res = await Promise.all(VTEX.map(async (f) => {
      const r = await precoEstoqueVtex(f.host, ean, { proxy: !!f.geo, timeout: 9000 }).catch(() => null);
      return { fonte: f.fonte, r };
    }));
    const vals = [];
    for (const { fonte, r } of res) {
      if (!r || !r.existe) continue;                  // farmácia não carrega este EAN → sem linha
      vals.push([ean, fonte, r.preco, r.disponivel ? 1 : 0, r.qtd]);
      if (!r.disponivel) esgotados += 1;
    }
    if (vals.length) {
      await pool.query('INSERT INTO medicamento_monitor_hist (ean, fonte, preco, disponivel, qtd_estoque) VALUES ?', [vals]);
      linhas += vals.length;
    }
    log(`[monitor] ${produto} ${ean} → ${vals.length} farmácias`);
  }
  log(`[monitor] CONCLUÍDO · ${eans.length} EANs · ${linhas} linhas (${esgotados} esgotados)`);
  return { eans: eans.length, linhas, esgotados };
}

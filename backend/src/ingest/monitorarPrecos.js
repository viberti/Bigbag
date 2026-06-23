// Monitor periódico (4/4h) de preço + ESTOQUE dos remédios "monitorados" (tabela
// medicamento_monitorado, hoje OZEMPIC+MOUNJARO). Para cada EAN COM OFERTA desses produtos,
// consulta TODAS as farmácias VTEX ao vivo (proxy nas geo) e grava 1 linha por (ean×farmácia)
// em medicamento_monitor_hist — histórico denso de variação de preço e de disponibilidade.
// NÃO apaga nada (append-only). Corre pelo cron (scripts/monitorar_precos.mjs).
import { readFileSync } from 'node:fs';
import { getPool } from '../db.js';
import { precoEstoqueVtex } from './precoVivo.js';
import { precoPanvelEan } from './precoPanvel.js';
import { precoNisseiEan } from './precoNissei.js';
import { precoAraujoEan } from './precoAraujo.js';

const MANIFESTO = JSON.parse(readFileSync(new URL('../../scripts/fontes_farmacia.json', import.meta.url), 'utf8'));
const VTEX = MANIFESTO.filter((f) => (f.motor || 'vtex') === 'vtex'); // VTEX: preço + estoque por EAN
const TEM_PANVEL = MANIFESTO.some((f) => f.motor === 'panvel');        // Panvel/Nissei/Araújo: só preço (sem estoque)
const TEM_NISSEI = MANIFESTO.some((f) => f.motor === 'nissei');
const TEM_ARAUJO = MANIFESTO.some((f) => f.motor === 'araujo');

export async function monitorarMonitorados({ log = console.log } = {}) {
  const pool = getPool();
  // EANs COM oferta dos produtos monitorados E de TODOS os seus equivalentes/genéricos
  // (mesma SUBSTÂNCIA — marcas, similares e genéricos, todas as forças/formas). Decisão do
  // dono (2026-06-23): a lista é por marca (OZEMPIC/MOUNJARO) mas o monitor cobre a classe
  // inteira (semaglutida/tirzepatida). Auto-inclui genéricos novos. Não adianta EAN sem oferta.
  const [eans] = await pool.query(
    `SELECT DISTINCT m.ean, m.produto FROM medicamento m
      WHERE m.substancia IN (
              SELECT DISTINCT m2.substancia FROM medicamento m2
                JOIN medicamento_monitorado mm ON UPPER(m2.produto) = mm.produto AND mm.ativo = 1
               WHERE m2.substancia IS NOT NULL)
        AND EXISTS (SELECT 1 FROM catalogo_produto cp WHERE cp.ean = m.ean AND cp.preco > 0 AND cp.moeda = 'BRL')`,
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
    // Panvel/Nissei (não-VTEX): só preço, sem sinal de estoque (disponivel=NULL = desconhecido).
    if (TEM_PANVEL) {
      const pv = await precoPanvelEan(ean).catch(() => null);
      if (pv && pv.existe && pv.preco != null) vals.push([ean, 'panvel', pv.preco, null, null]);
    }
    if (TEM_NISSEI) {
      const ns = await precoNisseiEan(ean).catch(() => null);
      if (ns && ns.existe && ns.preco != null) vals.push([ean, 'nissei', ns.preco, null, null]);
    }
    if (TEM_ARAUJO) {
      const ar = await precoAraujoEan(ean).catch(() => null);
      if (ar && ar.existe && ar.preco != null) vals.push([ean, 'araujo', ar.preco, null, null]);
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

// Backfill da NUTRIÇÃO-DE-CLASSE para staples (cereais/massas/pão) — o tipo 'basico'.
//
// Contexto: o modelo de nutrição herdada passou a 3 vias (decisão do dono,
// 2026-06-11): CLASSE (fresco + basico) vs PRODUTO (marca→EAN→OFF) vs irrelevante
// (álcool/não-alimentar). "basico" = embalado mas de nutrição PADRÃO da classe
// (arroz, massa, farinha, pão), que antes caía em 'processado' → nutrição NULL.
//
// Este script re-caracteriza (LLM, cacheado em produto_generico) os SKUs cujo nome
// casa as palavras de classe (DISPENSA_CLASSE_RE) e que ainda não têm nutrição,
// dando-lhes a nutrição típica por 100 g. A ingestão futura já usa o prompt novo;
// isto é só para o histórico. Os novos itens passam a sair da worklist por TEREM
// nutrição (não só por isenção de nome).
//
// Uso:  node scripts/backfill_generico_classe.mjs            (dry-run)
//       node scripts/backfill_generico_classe.mjs --aplicar
import { getPool } from '../src/db.js';
import { caracterizarProdutoNome } from '../src/ingest/produto.js';
import { DISPENSA_CLASSE_RE } from '../src/normaliza/categoria.js';
import { config } from '../src/config.js';

const APLICAR = process.argv.includes('--aplicar');

async function main() {
  const pool = getPool();
  // staples sem nutrição de classe ainda (sem generico, ou generico sem nutrição)
  const [skus] = await pool.query(
    `SELECT s.id, s.nome_canonico, pg.tipo, (pg.nutricao IS NOT NULL) tem_nut
       FROM sku_normalizado s
       LEFT JOIN produto_generico pg ON pg.sku_id = s.id
      WHERE s.nome_canonico REGEXP ?
        AND (pg.sku_id IS NULL OR pg.nutricao IS NULL)
      ORDER BY s.nome_canonico`,
    [DISPENSA_CLASSE_RE],
  );
  console.log(`[backfill] staples sem nutrição de classe: ${skus.length}`);
  let basico = 0, fresco = 0, processado = 0, erro = 0;
  for (const s of skus) {
    try {
      const { dados } = await caracterizarProdutoNome(s.nome_canonico);
      const tipo = ['fresco', 'basico'].includes(dados.tipo) ? dados.tipo : 'processado';
      const nut = tipo === 'processado' ? null : (dados.nutricao_100g || null);
      const kcal = nut?.energia_kcal;
      console.log(`   ${s.nome_canonico.slice(0, 38).padEnd(40)} → ${tipo}${kcal != null ? ` (${Math.round(kcal)} kcal/100g)` : ''}`);
      if (tipo === 'basico') basico++; else if (tipo === 'fresco') fresco++; else processado++;
      if (APLICAR) {
        await pool.query(
          `INSERT INTO produto_generico (sku_id, tipo, alimento, categoria, nutricao, modelo) VALUES (?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE tipo=VALUES(tipo), alimento=VALUES(alimento), categoria=VALUES(categoria), nutricao=VALUES(nutricao), modelo=VALUES(modelo)`,
          [s.id, tipo, dados.alimento || null, dados.categoria || null,
            nut ? JSON.stringify(nut) : null, config.openrouter.modelConsulta],
        );
      }
    } catch (e) { erro++; console.error('   erro:', s.nome_canonico, e.message.slice(0, 50)); }
  }
  console.log(`\n${APLICAR ? 'APLICADO' : 'DRY-RUN'}: basico ${basico}, fresco ${fresco}, processado ${processado}, erro ${erro}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

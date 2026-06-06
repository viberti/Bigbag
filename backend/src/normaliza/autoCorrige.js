// Auto-correção de outliers de preco_por_base.
// Ideia: quando o ppb de um item está MUITO acima da mediana do seu SKU
// (ex.: leite a 5 €/L vs mediana 0,90; ovos a 5,75/un vs 0,52), é quase de
// certeza um PACK não capturado — ppb ≈ K× a mediana. Tentamos dividir por um
// pack plausível (÷2,3,4,6,8,10,12,24); se o resultado cai perto da mediana,
// corrigimos e marcamos como INFERIDO (honesto, reversível). Se nenhuma divisão
// resolve, o item fica SUSPEITO — para o operador ver no /admin.
//
// Princípio: só age quando está MUITO longe (fator≥3) e só aplica se a correção
// é confiante (cai a ≤tolerância da mediana). A mediana exige ≥4 observações
// (senão não é fiável). Nunca toca em itens já inferidos (evita realimentação).
import { getPool } from '../db.js';

const PACKS = [2, 3, 4, 6, 8, 10, 12, 24];
const round4 = (v) => Math.round(v * 10000) / 10000;
const mediana = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// `aplicar`: se true, grava as correções; se false, é dry-run (só devolve).
// `fator`: quão longe da mediana conta como outlier (default 3×).
// `tolerancia`: quão perto da mediana a correção tem de cair p/ ser aceite.
export async function autoCorrigirOutliers(
  db = getPool(),
  { aplicar = false, fator = 3, tolerancia = 0.35, minObs = 4 } = {},
) {
  const [items] = await db.query(
    `SELECT i.id, i.sku_id, i.preco_por_base AS ppb, i.descricao_original AS descr,
            s.nome_canonico AS sku, s.unidade_base AS un, l.cadeia,
            DATE_FORMAT(f.data_compra, '%Y-%m-%d') AS data
     FROM item i
       JOIN sku_normalizado s ON s.id = i.sku_id
       JOIN fatura f ON f.id = i.fatura_id
       JOIN loja l ON l.id = f.loja_id
     WHERE i.preco_por_base IS NOT NULL AND i.is_non_product = 0
       AND f.needs_review = 0 AND i.ppb_inferido = 0`,
  );
  // mediana por SKU (só SKUs com observações suficientes)
  const porSku = {};
  for (const it of items) (porSku[it.sku_id] ||= []).push(Number(it.ppb));
  const med = {};
  for (const k in porSku) if (porSku[k].length >= minObs) med[k] = mediana(porSku[k]);

  const corrigidos = [];
  const suspeitos = [];
  for (const it of items) {
    const m = med[it.sku_id];
    if (!m || m <= 0) continue;
    const ppb = Number(it.ppb);
    const racio = ppb / m;
    if (racio >= fator) {
      // outlier ALTO → tentar pack
      let melhor = null;
      for (const K of PACKS) {
        const v = ppb / K;
        const erro = Math.abs(v - m) / m;
        if (erro <= tolerancia && (!melhor || erro < melhor.erro)) melhor = { K, v, erro };
      }
      const base = { id: it.id, sku: it.sku, cadeia: it.cadeia, data: it.data, descr: it.descr, un: it.un, mediana: round4(m) };
      if (melhor) {
        corrigidos.push({ ...base, de: round4(ppb), para: round4(melhor.v), pack: melhor.K });
        if (aplicar) {
          await db.query('UPDATE item SET preco_por_base = ?, ppb_inferido = 1 WHERE id = ?', [round4(melhor.v), it.id]);
        }
      } else {
        suspeitos.push({ ...base, ppb: round4(ppb), racio: round4(racio) });
      }
    } else if (racio <= 1 / fator) {
      // outlier BAIXO → sem correção automática segura (provável erro de unidade)
      suspeitos.push({
        id: it.id, sku: it.sku, cadeia: it.cadeia, data: it.data, descr: it.descr, un: it.un,
        mediana: round4(m), ppb: round4(ppb), racio: round4(racio),
      });
    }
  }
  return { analisados: items.length, skusComMediana: Object.keys(med).length, corrigidos, suspeitos };
}

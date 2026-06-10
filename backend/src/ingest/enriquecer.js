// Enriquece (Open Food Facts) os produtos cujo EAN veio na LINHA do talão
// (Makro, e agora também os talões digitais do Lidl Plus), guardando os dados
// como produto_ean autónomo (item_id NULL) → a ficha fica cheia, sem foto.
// Partilhado pela rota de faturas e pelo importador do Lidl Plus.
import { consultarOFF } from './produto.js';
import { tituloProduto } from '../normaliza/titulo.js';
import { garantirFichaPT } from './traduz.js';

export async function enriquecerEansFatura(pool, faturaId) {
  const [eans] = await pool.query('SELECT DISTINCT ean FROM item WHERE fatura_id = ? AND ean IS NOT NULL', [faturaId]);
  for (const { ean } of eans) {
    try {
      const [[ja]] = await pool.query('SELECT id FROM produto_ean WHERE ean = ? AND off_json IS NOT NULL LIMIT 1', [ean]);
      if (ja) continue;
      const off = await consultarOFF(ean);
      if (!off) continue;
      await pool.query(
        `INSERT INTO produto_ean (ean, item_id, fonte, nome, marca, quantidade, categoria, ingredientes, alergenios, nutricao, off_json)
           VALUES (?,NULL,'off',?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE nome=VALUES(nome), marca=VALUES(marca), quantidade=VALUES(quantidade), categoria=VALUES(categoria),
           ingredientes=VALUES(ingredientes), alergenios=VALUES(alergenios), nutricao=VALUES(nutricao), off_json=VALUES(off_json)`,
        [ean, tituloProduto(off.nome), tituloProduto(off.marca), off.quantidade, off.categoria, off.ingredientes, off.alergenios,
          off.nutricao_100g ? JSON.stringify(off.nutricao_100g) : null, JSON.stringify(off)],
      );
      garantirFichaPT(pool, ean).catch(() => {}); // OFF pode vir noutra língua → PT em fundo
    } catch (e) {
      console.error('[enriquecer ean]', ean, e.message);
    }
  }
}

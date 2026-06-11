// Enriquece (Open Food Facts) os produtos cujo EAN veio na LINHA do talão
// (Makro, e agora também os talões digitais do Lidl Plus), guardando os dados
// como produto_ean autónomo (item_id NULL) → a ficha fica cheia, sem foto.
// Partilhado pela rota de faturas e pelo importador do Lidl Plus.
import { consultarOFF } from './produto.js';
import { tituloProduto } from '../normaliza/titulo.js';
import { garantirFichaPT } from './traduz.js';
import { atualizarConteudoFicha } from '../normaliza/conteudo.js';

// Trunca ao tamanho da coluna: o OFF devolve a hierarquia COMPLETA de categorias
// (>120 chars) e um "Data too long for column 'categoria'" abortava este INSERT,
// deixando o EAN do talão SEM ficha (o kefir Milbona do Lidl era exatamente isto).
const lim = (s, n) => (s == null ? null : String(s).slice(0, n));

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
           ingredientes=VALUES(ingredientes), alergenios=VALUES(alergenios), nutricao=VALUES(nutricao), nutricao_confirmada=1, off_json=VALUES(off_json)`,
        [ean, lim(tituloProduto(off.nome), 200), lim(tituloProduto(off.marca), 120), lim(off.quantidade, 60), lim(off.categoria, 255), off.ingredientes, off.alergenios,
          off.nutricao_100g ? JSON.stringify(off.nutricao_100g) : null, JSON.stringify(off)],
      );
      await atualizarConteudoFicha(pool, ean);
      garantirFichaPT(pool, ean).catch(() => {}); // OFF pode vir noutra língua → PT em fundo
    } catch (e) {
      console.error('[enriquecer ean]', ean, e.message);
    }
  }
}

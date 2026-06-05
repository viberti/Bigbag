// Interface do COMPRADOR — explorar o histórico: que produtos compro, preço,
// variação ao longo do tempo e por mercado (onde é mais barato), frequência.
// Tudo em preco_por_base (€/kg, €/L, €/un) para ser comparável. Protegido.
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { getPool } from '../db.js';

export const explorarRouter = Router();
explorarRouter.use(requireAuth);

// Filtros comuns: só produtos, faturas que reconciliam.
const FILTRO = 'i.is_non_product = FALSE AND f.needs_review = FALSE AND i.preco_por_base IS NOT NULL';

// Meses com compras (para o seletor): 'YYYY-MM' + nº de notas.
explorarRouter.get('/meses', async (_req, res) => {
  try {
    const [rows] = await getPool().query(
      `SELECT DATE_FORMAT(f.data_compra, '%Y-%m') AS mes, COUNT(DISTINCT f.id) AS n
         FROM fatura f WHERE f.needs_review = FALSE AND f.data_compra IS NOT NULL
        GROUP BY mes ORDER BY mes`,
    );
    res.json({ meses: rows });
  } catch (e) {
    console.error('[explorar/meses] erro:', e.message);
    res.status(500).json({ erro: 'Falha a listar meses' });
  }
});

// Lista de produtos comprados, com resumo de preço/frequência/lojas.
// ?mes=YYYY-MM filtra aos produtos comprados nesse mês (e estatísticas do mês).
explorarRouter.get('/produtos', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 80);
    const mes = String(req.query.mes || '').trim();
    const args = [];
    let busca = '';
    if (q) {
      busca = 'AND (s.nome_canonico LIKE ? OR s.nome_simplificado LIKE ?)';
      args.push(`%${q}%`, `%${q}%`);
    }
    let filtroMes = '';
    if (/^\d{4}-\d{2}$/.test(mes)) {
      filtroMes = "AND DATE_FORMAT(f.data_compra, '%Y-%m') = ?";
      args.push(mes);
    }
    const [rows] = await getPool().query(
      `SELECT s.id, s.nome_canonico, s.nome_simplificado, s.categoria, s.unidade_base,
              COUNT(DISTINCT i.fatura_id) AS n_compras,
              COUNT(DISTINCT f.loja_id) AS n_lojas,
              ROUND(MIN(i.preco_por_base), 4) AS preco_min,
              ROUND(MAX(i.preco_por_base), 4) AS preco_max,
              CAST(SUBSTRING_INDEX(GROUP_CONCAT(i.preco_liquido ORDER BY f.data_compra DESC), ',', 1) AS DECIMAL(10,2)) AS ultimo_preco,
              ROUND(SUM(i.preco_liquido), 2) AS total_gasto,
              MAX(f.data_compra) AS ultima
         FROM sku_normalizado s
         JOIN item i ON i.sku_id = s.id
         JOIN fatura f ON f.id = i.fatura_id
        WHERE ${FILTRO} ${busca} ${filtroMes}
        GROUP BY s.id
        ORDER BY n_compras DESC, ultima DESC
        LIMIT 300`,
      args,
    );
    res.json({ produtos: rows });
  } catch (e) {
    console.error('[explorar/produtos] erro:', e.message);
    res.status(500).json({ erro: 'Falha a listar produtos' });
  }
});

// Detalhe de um produto: histórico de preço (€/base) + por loja + resumo.
explorarRouter.get('/produtos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const pool = getPool();
    const [[sku]] = await pool.query(
      'SELECT id, nome_canonico, nome_simplificado, unidade_base, marca, categoria FROM sku_normalizado WHERE id = ?',
      [id],
    );
    if (!sku) return res.status(404).json({ erro: 'Produto não encontrado' });
    // preco = preço PAGO (preco_liquido): consistente e é o que o utilizador
    // reconhece. (O €/base fica para o assistente / comparação interna.)
    const [historico] = await pool.query(
      `SELECT DATE(f.data_compra) AS data, i.preco_liquido AS preco, l.cadeia AS loja,
              i.is_clearance AS promo, i.preco_liquido AS pago, i.desconto_direto AS desconto
         FROM item i JOIN fatura f ON f.id = i.fatura_id JOIN loja l ON l.id = f.loja_id
        WHERE i.sku_id = ? AND ${FILTRO}
        ORDER BY f.data_compra`,
      [id],
    );
    const [por_loja] = await pool.query(
      `SELECT l.cadeia AS loja, COUNT(*) AS n,
              ROUND(AVG(i.preco_liquido), 2) AS preco_medio,
              ROUND(MIN(i.preco_liquido), 2) AS preco_min,
              ROUND(MAX(i.preco_liquido), 2) AS preco_max
         FROM item i JOIN fatura f ON f.id = i.fatura_id JOIN loja l ON l.id = f.loja_id
        WHERE i.sku_id = ? AND ${FILTRO}
        GROUP BY l.cadeia
        ORDER BY preco_medio ASC`,
      [id],
    );
    res.json({ sku, historico, por_loja });
  } catch (e) {
    console.error('[explorar/produtos/:id] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar produto' });
  }
});

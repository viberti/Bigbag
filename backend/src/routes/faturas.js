// Rota de ingestão de faturas. PROTEGIDA por requireAuth (a app está exposta).
// POST /api/faturas  (multipart, campo "fatura" = imagem) →
//   extrai (VLM) → reconcilia → grava imagem + BD → devolve resumo.
import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { getPool } from '../db.js';
import { criarJob, processarJob, repetirJob } from '../ingest/filaNotas.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

export const faturasRouter = Router();

faturasRouter.post('/', requireAuth, upload.single('fatura'), async (req, res) => {
  // INGESTÃO ASSÍNCRONA (dono, 2026-06-27): a foto/PDF é guardada e responde-se JÁ com um
  // job 'em_analise'; a interpretação (VLM, lenta) corre em fundo (ingest/filaNotas.js) e o
  // cartão "em análise" vira o talão lido sozinho. O utilizador nunca fica preso à espera.
  try {
    if (!req.file) return res.status(400).json({ erro: 'Falta o arquivo "fatura" (imagem ou PDF)' });
    const origemCaptura = (String(req.body?.origem || '').trim() || null)?.slice(0, 16) || null;
    const mime = req.file.mimetype || 'application/octet-stream';
    const ehPdf = mime === 'application/pdf' || /\.pdf$/i.test(req.file.originalname || '');
    await mkdir(config.uploads.faturas, { recursive: true });
    const ext = ehPdf ? 'pdf' : (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const ficheiro = path.join(config.uploads.faturas, `${randomUUID()}.${ext}`);
    await writeFile(ficheiro, req.file.buffer, { mode: 0o600 });
    const jobId = await criarJob(getPool(), {
      ficheiro, mime, metodo: ehPdf ? 'ocr_llm' : 'vlm', origemCaptura, userId: req.user.id,
    });
    // dispara o processamento sem o esperar; a varredura (server.js) é a rede de segurança
    processarJob(getPool(), jobId).catch((e) => console.error('[faturas] job', jobId, e.message));
    res.status(202).json({ job_id: jobId, estado: 'em_analise' });
  } catch (e) {
    console.error('[faturas] erro ao enfileirar:', e.message);
    res.status(500).json({ erro: 'Falha a receber a nota', detalhe: e.message });
  }
});

// Jobs de interpretação do utilizador: cartões "em análise"/"não consegui ler" e a transição
// para "lido". Inclui os terminados há pouco, p/ o poller ver a transição e abrir a fatura.
faturasRouter.get('/jobs', requireAuth, async (req, res) => {
  try {
    const [jobs] = await getPool().query(
      `SELECT id, estado, fatura_id, duplicada, n_itens, loja_nome, total, data_compra, erro, criado_em
         FROM fatura_job
        WHERE usuario_id = ?
          AND (estado IN ('em_analise','falhou') OR atualizado_em > (NOW() - INTERVAL 3 MINUTE))
        ORDER BY id DESC LIMIT 20`,
      [req.user.id],
    );
    res.json({ jobs });
  } catch (e) {
    console.error('[faturas/jobs] erro:', e.message);
    res.status(500).json({ erro: 'Falha a listar jobs' });
  }
});

// Repetir uma leitura que falhou ("tentar outra vez").
faturasRouter.post('/jobs/:id/retry', requireAuth, async (req, res) => {
  try {
    const ok = await repetirJob(getPool(), Number(req.params.id), req.user.id);
    if (!ok) return res.status(404).json({ erro: 'Job não encontrado ou não está em falha' });
    processarJob(getPool(), Number(req.params.id)).catch((e) => console.error('[faturas] retry', e.message));
    res.json({ estado: 'em_analise' });
  } catch (e) {
    console.error('[faturas/jobs retry] erro:', e.message);
    res.status(500).json({ erro: 'Falha a repetir' });
  }
});

// Lista as notas do utilizador (para a tela "As minhas compras"): data, loja,
// nº de itens, valor — por data decrescente.
faturasRouter.get('/', requireAuth, async (req, res) => {
  try {
    const [notas] = await getPool().query(`
      SELECT f.id, f.data_compra AS data, COALESCE(l.cadeia, l.nome) AS loja,
             f.total_impresso AS total,
             (SELECT COUNT(*) FROM item i WHERE i.fatura_id = f.id AND i.is_non_product = 0) AS n_itens
        FROM fatura f JOIN loja l ON l.id = f.loja_id
       ORDER BY f.data_compra DESC, f.id DESC`);
    res.json({ notas });
  } catch (e) {
    console.error('[faturas GET] erro:', e.message);
    res.status(500).json({ erro: 'Falha a listar notas' });
  }
});

// Resumo de GASTOS para a análise doméstica: mês corrente, anterior, média, série
// mensal e repartição por loja do mês corrente. (Antes de '/:id' para não colidir.)
faturasRouter.get('/gastos', requireAuth, async (req, res) => {
  try {
    const [[hoje]] = await getPool().query('SELECT YEAR(CURDATE()) y, MONTH(CURDATE()) m');
    // só datas PLAUSÍVEIS: uma leitura de data errada (ex.: VLM lê 2088) não pode
    // virar o "mês mais recente" e desnortear o resumo (caso real ZZDEDUP, 2026-06-13).
    const [meses] = await getPool().query(`
      SELECT YEAR(data_compra) ano, MONTH(data_compra) mes,
             ROUND(SUM(total_impresso), 2) total, COUNT(*) n
        FROM fatura
       WHERE data_compra >= '2010-01-01' AND data_compra < (CURDATE() + INTERVAL 1 DAY)
       GROUP BY ano, mes ORDER BY ano, mes`);
    const acha = (y, m) => meses.find((x) => x.ano === y && x.mes === m) || { ano: y, mes: m, total: 0, n: 0 };
    const atual = acha(hoje.y, hoje.m);
    const pm = hoje.m === 1 ? { y: hoje.y - 1, m: 12 } : { y: hoje.y, m: hoje.m - 1 };
    const anterior = acha(pm.y, pm.m);
    const totais = meses.map((x) => Number(x.total));
    const media = totais.length ? +(totais.reduce((a, b) => a + b, 0) / totais.length).toFixed(2) : 0;
    const total_geral = +totais.reduce((a, b) => a + b, 0).toFixed(2);
    const variacao = anterior.total > 0 ? Math.round(((atual.total - anterior.total) / anterior.total) * 100) : null;
    const serie = meses.slice(-12);
    const [por_loja] = await getPool().query(`
      SELECT COALESCE(l.cadeia, l.nome) AS loja, ROUND(SUM(f.total_impresso), 2) AS total, COUNT(*) AS n
        FROM fatura f JOIN loja l ON l.id = f.loja_id
       WHERE YEAR(f.data_compra) = ? AND MONTH(f.data_compra) = ?
       GROUP BY loja ORDER BY total DESC`, [hoje.y, hoje.m]);
    // "Em que gastou" — gasto por GRUPO do item (lente de loja, estável por SKU).
    // Inclui clearance (é dinheiro gasto), exclui não-produto (saco/taxa) e faturas
    // por rever. Itens sem SKU/grupo caem em 'outros'. Soma ≈ total do mês (aprox.).
    const [por_categoria] = await getPool().query(`
      SELECT COALESCE(s.grupo, 'outros') AS grupo, ROUND(SUM(i.preco_liquido), 2) AS total
        FROM item i
        JOIN fatura f ON f.id = i.fatura_id
        LEFT JOIN sku_normalizado s ON s.id = i.sku_id
       WHERE YEAR(f.data_compra) = ? AND MONTH(f.data_compra) = ?
         AND i.is_non_product = FALSE AND f.needs_review = FALSE AND i.preco_liquido IS NOT NULL
       GROUP BY grupo ORDER BY total DESC`, [hoje.y, hoje.m]);
    res.json({ atual, anterior, media, total_geral, variacao, serie, por_loja, por_categoria });
  } catch (e) {
    console.error('[faturas/gastos] erro:', e.message);
    res.status(500).json({ erro: 'Falha a calcular gastos' });
  }
});

// Produtos de uma categoria (1+ grupos) no mês atual, AGREGANDO iguais: mesmo SKU
// soma numa linha (nome + marca + total gasto + nº de compras + quantidade); itens
// sem SKU agregam pela descrição do talão. Para o drill-down do "Em que gastou".
faturasRouter.get('/gastos/categoria', requireAuth, async (req, res) => {
  try {
    const grupos = String(req.query.grupos || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!grupos.length) return res.status(400).json({ erro: 'grupos em falta' });
    const [[hoje]] = await getPool().query('SELECT YEAR(CURDATE()) y, MONTH(CURDATE()) m');
    const [produtos] = await getPool().query(`
      SELECT MAX(COALESCE((SELECT pe1.nome FROM produto_ean pe1 WHERE pe1.ean = i.ean AND pe1.nome IS NOT NULL AND pe1.nome <> '' ORDER BY pe1.id LIMIT 1), s.nome_simplificado, s.nome_canonico, i.descricao_original)) AS nome,
             MAX(s.marca) AS marca, MAX(i.ean) AS ean, MAX(i.sku_id) AS sku_id,
             ROUND(SUM(i.preco_liquido), 2) AS total, COUNT(*) AS n, ROUND(SUM(i.quantidade), 2) AS qtd
        FROM item i
        JOIN fatura f ON f.id = i.fatura_id
        LEFT JOIN sku_normalizado s ON s.id = i.sku_id
       WHERE YEAR(f.data_compra) = ? AND MONTH(f.data_compra) = ?
         AND COALESCE(s.grupo, 'outros') IN (?)
         AND i.is_non_product = FALSE AND f.needs_review = FALSE AND i.preco_liquido IS NOT NULL
       GROUP BY COALESCE(CAST(s.id AS CHAR), i.descricao_original)
       ORDER BY total DESC`, [hoje.y, hoje.m, grupos]);
    res.json({ grupos, produtos });
  } catch (e) {
    console.error('[faturas/gastos/categoria] erro:', e.message);
    res.status(500).json({ erro: 'Falha a listar produtos da categoria' });
  }
});

// Itens de UMA nota (ao tocar numa entrada da lista).
faturasRouter.get('/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[nota]] = await getPool().query(
      `SELECT f.id, f.data_compra AS data, COALESCE(l.cadeia, l.nome) AS loja, f.total_impresso AS total
         FROM fatura f JOIN loja l ON l.id = f.loja_id WHERE f.id = ?`,
      [id],
    );
    if (!nota) return res.status(404).json({ erro: 'Nota não encontrada' });
    // A identificação (EAN/ficha) resolve-se por (descrição do talão + CADEIA), não por
    // item_id: identificar UMA compra de "Salada Gourmet" no Continente vale para TODAS
    // as compras Continente com o mesmo nome (mesmo produto). Entre cadeias não — pode
    // ser marca-própria diferente. `ident` é a ficha por (descrição, cadeia).
    const [itens] = await getPool().query(
      `SELECT i.id, i.sku_id,
              COALESCE((SELECT pe1.nome FROM produto_ean pe1
                          WHERE pe1.ean = COALESCE(i.ean, ident.ean) AND pe1.nome IS NOT NULL AND pe1.nome <> ''
                          ORDER BY pe1.id LIMIT 1), s.nome_canonico, i.descricao_original) AS produto,
              i.quantidade, i.preco_liquido AS preco, s.unidade_base, i.preco_por_base,
              s.grupo,
              COALESCE(i.ean, ident.ean) AS ean,
              ident.marca AS marca,
              pg.tipo AS tipo_alimento,
              COALESCE(pg.categoria, (SELECT pe2.categoria FROM produto_ean pe2
                 WHERE pe2.ean = COALESCE(i.ean, ident.ean) AND pe2.categoria IS NOT NULL AND pe2.categoria <> ''
                 ORDER BY pe2.id LIMIT 1)) AS categoria,
              i.descricao_original AS descricao_raw,
              i.desconto_direto, i.is_clearance,
              (SELECT pe3.quantidade FROM produto_ean pe3
                 WHERE pe3.ean = COALESCE(i.ean, ident.ean) AND pe3.quantidade IS NOT NULL AND pe3.quantidade <> ''
                 ORDER BY pe3.id LIMIT 1) AS tamanho,
              (pg.nutricao IS NOT NULL) AS tem_generico,
              (
                COALESCE(ident.tem_ficha, 0) = 1
                OR pg.nutricao IS NOT NULL
                OR EXISTS (SELECT 1 FROM produto_ean pe
                             WHERE pe.ean = i.ean
                               AND (pe.off_json IS NOT NULL OR pe.vlm_json IS NOT NULL))
              ) AS tem_dados
         FROM item i
         LEFT JOIN sku_normalizado s ON s.id = i.sku_id
         LEFT JOIN produto_generico pg ON pg.sku_id = i.sku_id
         JOIN fatura f ON f.id = i.fatura_id
         JOIN loja l ON l.id = f.loja_id
         LEFT JOIN (
           SELECT i2.descricao_original AS d, COALESCE(l2.cadeia, l2.nome) AS chain,
                  MAX(pe.ean) AS ean,
                  MAX(COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(pe.off_json,'$.marca')), 'null'), pe.marca)) AS marca,
                  MAX(pe.off_json IS NOT NULL OR pe.vlm_json IS NOT NULL) AS tem_ficha
             FROM produto_ean pe
             JOIN item i2 ON i2.id = pe.item_id
             JOIN fatura f2 ON f2.id = i2.fatura_id
             JOIN loja l2 ON l2.id = f2.loja_id
            WHERE pe.ean IS NOT NULL
            GROUP BY d, chain
         ) ident ON ident.d = i.descricao_original AND ident.chain = COALESCE(l.cadeia, l.nome)
        WHERE i.fatura_id = ? AND i.is_non_product = 0
        ORDER BY i.id`,
      [id],
    );
    res.json({ nota, itens });
  } catch (e) {
    console.error('[faturas/:id] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar nota' });
  }
});

// Serve a imagem original da nota (para a tela de revisão do operador).
faturasRouter.get('/:id/imagem', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [[f]] = await getPool().query('SELECT ficheiro_original FROM fatura WHERE id = ?', [id]);
    if (!f?.ficheiro_original) return res.status(404).json({ erro: 'Sem imagem' });
    res.sendFile(f.ficheiro_original, (err) => {
      if (err && !res.headersSent) res.status(404).json({ erro: 'Imagem não encontrada' });
    });
  } catch (e) {
    console.error('[faturas/imagem] erro:', e.message);
    if (!res.headersSent) res.status(500).json({ erro: 'Falha a servir imagem' });
  }
});

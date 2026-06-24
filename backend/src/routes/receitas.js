// RECEITAS — sugere pratos a partir do que o usuário TEM (despensa) + COMPROU nos últimos 7 dias
// (talões), aprendendo com os 👍/👎 (as que gostou alimentam o prompt; as que não gostou evita).
// Só informação culinária; uma chamada LLM por conjunto de ingredientes+gostos (cacheada).
import { Router } from 'express';
import { createHash } from 'node:crypto';
import { getPool, parseJsonCol } from '../db.js';
import { requireAuth } from '../auth.js';
import { chatCompletion } from '../openrouter.js';
import { config } from '../config.js';

export const receitasRouter = Router();
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const _cache = new Map(); // hash(ingredientes+gostos) → receitas

// Ingredientes disponíveis: despensa (nome PT canónico) + comprados nos últimos 7 dias (talões).
async function ingredientesDisponiveis(pool) {
  const [desp] = await pool.query(
    `SELECT COALESCE(c.nome_pt, d.nome) AS nome FROM despensa d LEFT JOIN ean_classificacao c ON c.ean = d.ean`);
  const [comprados] = await pool.query(
    `SELECT DISTINCT s.nome_canonico AS nome FROM item i
       JOIN fatura f ON f.id = i.fatura_id JOIN sku_normalizado s ON s.id = i.sku_id
      WHERE f.data >= (CURDATE() - INTERVAL 7 DAY) AND s.nome_canonico IS NOT NULL AND s.nome_canonico <> '' LIMIT 150`);
  const set = new Map();
  for (const r of [...desp, ...comprados]) { const n = String(r.nome || '').trim(); if (n) set.set(norm(n), n); }
  return [...set.values()];
}

// GET /api/receitas → 6 sugestões a partir dos ingredientes + gostos.
receitasRouter.get('/', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const ingredientes = await ingredientesDisponiveis(pool);
    if (ingredientes.length < 4) return res.json({ receitas: [], poucos: true });
    const [votos] = await pool.query('SELECT nome, voto FROM receita_avaliacao WHERE utilizador = ?', [req.user.id]);
    const gostei = votos.filter((v) => v.voto > 0).map((v) => v.nome);
    const naoGostei = votos.filter((v) => v.voto < 0).map((v) => v.nome);
    const evitar = new Set([...gostei, ...naoGostei].map(norm)); // não repetir o já avaliado
    const hash = createHash('sha1').update(JSON.stringify([[...ingredientes].sort(), [...gostei].sort(), [...naoGostei].sort()])).digest('hex').slice(0, 16);
    if (_cache.has(hash)) return res.json({ receitas: _cache.get(hash), cacheada: true });
    const prompt = `Sou cozinheiro caseiro. Tenho estes ingredientes (na despensa ou comprados nos últimos 7 dias):
${ingredientes.slice(0, 150).join(', ')}.
${gostei.length ? `RECEITAS QUE GOSTEI antes (sugira no mesmo gosto/estilo, mas NÃO repita estas): ${gostei.join('; ')}.` : ''}
${naoGostei.length ? `EVITE o estilo destas que NÃO gostei: ${naoGostei.join('; ')}.` : ''}
Sugira 6 receitas que usem MAJORITARIAMENTE os meus ingredientes (pode contar com básicos: sal, azeite, alho, cebola, ovos, água, farinha). Varie (entrada, prato principal, etc.). Para cada:
- "nome": curto e apetitoso, português do Brasil.
- "tempo": aprox. (ex.: "25 min").
- "desc": 1 linha.
- "usa": ingredientes-chave QUE USA (dos meus listados acima).
- "falta": o que falta comprar (máx 2; vazio se nada falta).
Responda SÓ JSON: {"receitas":[{"nome":"...","tempo":"...","desc":"...","usa":["..."],"falta":["..."]}]}`;
    let receitas = [];
    try {
      const r = await chatCompletion({ messages: [{ role: 'user', content: prompt }], model: config.openrouter.modelConsulta, responseFormat: { type: 'json_object' }, contexto: 'receitas' });
      receitas = (JSON.parse(r || '{}').receitas || [])
        .filter((x) => x && x.nome && !evitar.has(norm(x.nome)))
        .slice(0, 6)
        .map((x) => ({ nome: String(x.nome).slice(0, 120), tempo: x.tempo ? String(x.tempo).slice(0, 24) : null, desc: String(x.desc || '').slice(0, 200), usa: Array.isArray(x.usa) ? x.usa.map(String).slice(0, 8) : [], falta: Array.isArray(x.falta) ? x.falta.map(String).slice(0, 2) : [] }));
    } catch (e) { console.error('[receitas] LLM:', e.message); }
    if (receitas.length) { if (_cache.size > 200) _cache.clear(); _cache.set(hash, receitas); }
    res.json({ receitas, base: { despensa_e_compras: ingredientes.length, gostei: gostei.length } });
  } catch (e) { console.error('[receitas]', e.message); res.status(500).json({ erro: 'Falha ao gerar receitas' }); }
});

// POST /api/receitas/avaliar { nome, voto:1|-1, desc?, usa? } — 👍/👎; idempotente por (user, receita).
receitasRouter.post('/avaliar', requireAuth, async (req, res) => {
  try {
    const nome = String(req.body?.nome || '').trim().slice(0, 200);
    const voto = Number(req.body?.voto) > 0 ? 1 : Number(req.body?.voto) < 0 ? -1 : 0;
    if (!nome || !voto) return res.status(400).json({ erro: 'nome e voto (1|-1) obrigatórios' });
    const usa = Array.isArray(req.body?.usa) ? JSON.stringify(req.body.usa.slice(0, 8)) : null;
    await getPool().query(
      `INSERT INTO receita_avaliacao (utilizador, nome, nome_norm, voto, descricao, ingredientes) VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE voto = VALUES(voto), descricao = VALUES(descricao), ingredientes = VALUES(ingredientes)`,
      [req.user.id, nome, norm(nome), voto, String(req.body?.desc || '').slice(0, 300) || null, usa]);
    res.json({ ok: true });
  } catch (e) { console.error('[receitas/avaliar]', e.message); res.status(500).json({ erro: 'Falha ao guardar' }); }
});

// GET /api/receitas/gostei → as que o usuário gostou (acumuladas).
receitasRouter.get('/gostei', requireAuth, async (req, res) => {
  try {
    const [rows] = await getPool().query(
      'SELECT nome, descricao, ingredientes FROM receita_avaliacao WHERE utilizador = ? AND voto > 0 ORDER BY atualizado_em DESC LIMIT 100', [req.user.id]);
    res.json({ receitas: rows.map((r) => ({ nome: r.nome, desc: r.descricao || '', usa: parseJsonCol(r.ingredientes) || [] })) });
  } catch (e) { console.error('[receitas/gostei]', e.message); res.status(500).json({ erro: 'erro' }); }
});

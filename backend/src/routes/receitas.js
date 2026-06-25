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
// FOTO real do prato via PEXELS (server-side; a chave nunca vai ao frontend). Cacheada por query.
// Sem PEXELS_API_KEY → devolve null e o frontend cai no fallback keyless (LoremFlickr).
const _fotoCache = new Map();
async function fotoPexels(query) {
  const q = String(query || '').trim();
  if (!q || !process.env.PEXELS_API_KEY) return null;
  if (_fotoCache.has(q)) return _fotoCache.get(q);
  let url = null;
  try {
    const r = await fetch(`https://api.pexels.com/v1/search?per_page=1&orientation=landscape&query=${encodeURIComponent(q)}`,
      { headers: { Authorization: process.env.PEXELS_API_KEY }, signal: AbortSignal.timeout(5000) });
    if (r.ok) { const j = await r.json(); url = j?.photos?.[0]?.src?.large || j?.photos?.[0]?.src?.medium || null; }
  } catch { /* rede/timeout → fallback no frontend */ }
  if (_fotoCache.size > 1500) _fotoCache.clear();
  _fotoCache.set(q, url);
  return url;
}
const resolverFotos = (recs) => Promise.all(recs.map(async (x) => { if (!x.foto_url) x.foto_url = await fotoPexels(x.foto); }));

// Ingredientes disponíveis, em DOIS grupos para o prompt poder priorizar:
//  - comprados: o que entrou nos talões dos últimos 7 dias (mais recente 1.º) — sinal FRESCO e forte
//    (carnes/peixes que se acabou de comprar devem virar pratos); deduplicado.
//  - despensa: o que se tem em casa (base/temperos/acompanhamentos), excluindo o que já está em comprados.
async function ingredientesDisponiveis(pool) {
  const [desp] = await pool.query(
    `SELECT COALESCE(c.nome_pt, d.nome) AS nome FROM despensa d LEFT JOIN ean_classificacao c ON c.ean = d.ean`);
  const [comp] = await pool.query(
    `SELECT COALESCE(s.nome_canonico, i.descricao_original) AS nome, MAX(f.data_compra) AS dc FROM item i
       JOIN fatura f ON f.id = i.fatura_id LEFT JOIN sku_normalizado s ON s.id = i.sku_id
      WHERE f.data_compra >= (CURDATE() - INTERVAL 7 DAY)
        AND COALESCE(s.nome_canonico, i.descricao_original) IS NOT NULL AND COALESCE(s.nome_canonico, i.descricao_original) <> ''
        AND (i.is_non_product IS NULL OR i.is_non_product = 0)
      GROUP BY nome ORDER BY dc DESC LIMIT 120`);
  const visto = new Set();
  const comprados = [];
  for (const r of comp) { const n = String(r.nome || '').trim(); const k = norm(n); if (n && !visto.has(k)) { visto.add(k); comprados.push(n); } }
  const despensa = [];
  for (const r of desp) { const n = String(r.nome || '').trim(); const k = norm(n); if (n && !visto.has(k)) { visto.add(k); despensa.push(n); } }
  return { comprados, despensa, total: comprados.length + despensa.length };
}

// GET /api/receitas → 6 sugestões a partir dos ingredientes + gostos.
receitasRouter.get('/', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const excluir = String(req.query.ex || '').split('||').map((s) => s.trim()).filter(Boolean).slice(0, 60); // já vistas nesta sessão
    const ing = await ingredientesDisponiveis(pool);
    if (ing.total < 4) return res.json({ receitas: [], poucos: true });
    const [votos] = await pool.query('SELECT nome, voto FROM receita_avaliacao WHERE utilizador = ?', [req.user.id]);
    const gostei = votos.filter((v) => v.voto > 0).map((v) => v.nome);
    const naoGostei = votos.filter((v) => v.voto < 0).map((v) => v.nome);
    const jaVistas = [...new Set([...gostei, ...naoGostei, ...excluir])];
    const evitar = new Set(jaVistas.map(norm)); // não repetir o já avaliado/mostrado
    const hash = createHash('sha1').update(JSON.stringify([[...ing.comprados].sort(), [...ing.despensa].sort(), [...gostei].sort(), [...naoGostei].sort()])).digest('hex').slice(0, 16);
    if (!excluir.length && _cache.has(hash)) { const recs = _cache.get(hash); await resolverFotos(recs); return res.json({ receitas: recs, cacheada: true }); }
    const prompt = `Sou cozinheiro caseiro.
COMPREI nos últimos 7 dias (DÊ PRIORIDADE a estes — sobretudo CARNES, PEIXES e outras PROTEÍNAS, que devem ser a base de VÁRIAS receitas): ${ing.comprados.slice(0, 100).join(', ') || '(nada recente)'}.
TENHO na despensa (base, temperos e acompanhamentos): ${ing.despensa.slice(0, 120).join(', ') || '(vazia)'}.
${gostei.length ? `RECEITAS QUE GOSTEI (sugira no MESMO estilo, mas não as repita): ${gostei.slice(-30).join('; ')}.` : ''}
${naoGostei.length ? `EVITE o estilo destas que NÃO gostei: ${naoGostei.slice(-30).join('; ')}.` : ''}
${excluir.length ? `JÁ MOSTRADAS — NÃO repita NENHUMA: ${excluir.slice(-60).join('; ')}.` : ''}
Sugira 20 receitas VARIADAS (e DIFERENTES das já mostradas) que usem MAJORITARIAMENTE os meus ingredientes (pode contar com básicos: sal, azeite, alho, cebola, ovos, água, farinha). Equilibre: VÁRIAS receitas devem usar as CARNES/PEIXES/PROTEÍNAS que comprei; varie o resto (saladas, sopas, massas, doces). Para cada:
- "nome": curto e apetitoso, português do Brasil.
- "tempo": aprox. (ex.: "25 min").
- "dificuldade": "Fácil", "Médio" ou "Difícil".
- "refeicao": "Café da manhã", "Almoço", "Jantar", "Lanche", "Sobremesa" ou "Acompanhamento".
- "desc": 1 linha.
- "usa": ingredientes-chave QUE EU TENHO (dos meus listados acima) e que a receita usa.
- "falta": ingredientes que a receita pede mas que NÃO estão na minha lista (o que eu teria de comprar; máx 3; vazio se nada falta).
- "foto": 2 a 4 PALAVRAS-CHAVE EM INGLÊS do PRATO PRONTO (para buscar uma foto de stock), ex.: "tuna pasta", "grilled chicken salad", "greek yogurt bowl".
Responda SÓ JSON: {"receitas":[{"nome":"...","tempo":"...","dificuldade":"...","refeicao":"...","desc":"...","usa":["..."],"falta":["..."],"foto":"..."}]}`;
    let receitas = [];
    try {
      const r = await chatCompletion({ messages: [{ role: 'user', content: prompt }], model: config.openrouter.modelConsulta, responseFormat: { type: 'json_object' }, contexto: 'receitas' });
      receitas = (JSON.parse(r || '{}').receitas || [])
        .filter((x) => x && x.nome && !evitar.has(norm(x.nome)))
        .slice(0, 20)
        .map((x) => ({ nome: String(x.nome).slice(0, 120), tempo: x.tempo ? String(x.tempo).slice(0, 24) : null, dificuldade: x.dificuldade ? String(x.dificuldade).slice(0, 16) : null, refeicao: x.refeicao ? String(x.refeicao).slice(0, 24) : null, desc: String(x.desc || '').slice(0, 200), usa: Array.isArray(x.usa) ? x.usa.map(String).slice(0, 8) : [], falta: Array.isArray(x.falta) ? x.falta.map(String).slice(0, 3) : [], foto: x.foto ? String(x.foto).slice(0, 80) : null }));
    } catch (e) { console.error('[receitas] LLM:', e.message); }
    if (receitas.length && !excluir.length) { if (_cache.size > 200) _cache.clear(); _cache.set(hash, receitas); }
    await resolverFotos(receitas);
    res.json({ receitas, base: { comprados: ing.comprados.length, despensa: ing.despensa.length, gostei: gostei.length } });
  } catch (e) { console.error('[receitas]', e.message); res.status(500).json({ erro: 'Falha ao gerar receitas' }); }
});

// POST /api/receitas/avaliar { nome, voto:1|-1, desc?, usa? } — 👍/👎; idempotente por (user, receita).
receitasRouter.post('/avaliar', requireAuth, async (req, res) => {
  try {
    const nome = String(req.body?.nome || '').trim().slice(0, 200);
    const voto = Number(req.body?.voto) > 0 ? 1 : Number(req.body?.voto) < 0 ? -1 : 0;
    if (!nome || !voto) return res.status(400).json({ erro: 'nome e voto (1|-1) obrigatórios' });
    const usa = Array.isArray(req.body?.usa) ? JSON.stringify(req.body.usa.slice(0, 8)) : null;
    const foto = req.body?.foto ? String(req.body.foto).slice(0, 120) : null;
    await getPool().query(
      `INSERT INTO receita_avaliacao (utilizador, nome, nome_norm, voto, descricao, ingredientes, foto) VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE voto = VALUES(voto), descricao = VALUES(descricao), ingredientes = VALUES(ingredientes), foto = COALESCE(VALUES(foto), foto)`,
      [req.user.id, nome, norm(nome), voto, String(req.body?.desc || '').slice(0, 300) || null, usa, foto]);
    res.json({ ok: true });
  } catch (e) { console.error('[receitas/avaliar]', e.message); res.status(500).json({ erro: 'Falha ao guardar' }); }
});

// GET /api/receitas/gostei → as que o usuário gostou (acumuladas).
receitasRouter.get('/gostei', requireAuth, async (req, res) => {
  try {
    const [rows] = await getPool().query(
      'SELECT nome, descricao, ingredientes, foto FROM receita_avaliacao WHERE utilizador = ? AND voto > 0 ORDER BY atualizado_em DESC LIMIT 100', [req.user.id]);
    const recs = rows.map((r) => ({ nome: r.nome, desc: r.descricao || '', usa: parseJsonCol(r.ingredientes) || [], foto: r.foto || null }));
    await resolverFotos(recs);
    res.json({ receitas: recs });
  } catch (e) { console.error('[receitas/gostei]', e.message); res.status(500).json({ erro: 'erro' }); }
});

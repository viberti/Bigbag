// Perfis nutricionais por membro. Carregar (texto do ficheiro) → extrai resumo →
// guarda e ativa. Um perfil ativo de cada vez (usado nas avaliações personalizadas).
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { getPool } from '../db.js';
import { extrairPerfil } from '../ingest/perfil.js';

export const perfilRouter = Router();
perfilRouter.use(requireAuth);

// Lista os perfis (com o resumo) e marca qual está ativo.
perfilRouter.get('/', async (req, res) => {
  try {
    const [rows] = await getPool().query('SELECT id, nome, resumo, ativo, atualizado_em FROM perfil_membro ORDER BY ativo DESC, nome');
    res.json({ perfis: rows.map((r) => ({ ...r, resumo: typeof r.resumo === 'string' ? JSON.parse(r.resumo) : r.resumo })) });
  } catch (e) {
    console.error('[perfil GET] erro:', e.message);
    res.status(500).json({ erro: 'Falha a listar perfis' });
  }
});

// Carregar/atualizar um perfil: { nome, texto }. Extrai o resumo e fica ativo.
perfilRouter.post('/', async (req, res) => {
  try {
    const texto = String(req.body?.texto || '').trim();
    if (!texto) return res.status(400).json({ erro: 'Falta o texto do perfil' });
    const { resumo, custo } = await extrairPerfil(texto);
    const nome = String(req.body?.nome || resumo.nome || 'Membro').trim().slice(0, 80);

    const pool = getPool();
    // upsert por nome (um perfil por membro) + ativar só este
    const [[ja]] = await pool.query('SELECT id FROM perfil_membro WHERE nome = ? LIMIT 1', [nome]);
    let id;
    if (ja) {
      await pool.query('UPDATE perfil_membro SET texto = ?, resumo = ? WHERE id = ?', [texto, JSON.stringify(resumo), ja.id]);
      id = ja.id;
    } else {
      const [r] = await pool.query('INSERT INTO perfil_membro (nome, texto, resumo) VALUES (?,?,?)', [nome, texto, JSON.stringify(resumo)]);
      id = r.insertId;
    }
    await pool.query('UPDATE perfil_membro SET ativo = IF(id = ?, 1, 0)', [id]);
    res.json({ id, nome, resumo, custo });
  } catch (e) {
    console.error('[perfil POST] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar o perfil' });
  }
});

// Ativar um perfil (o que está ativo é o usado nas avaliações).
perfilRouter.post('/:id/ativar', async (req, res) => {
  try {
    await getPool().query('UPDATE perfil_membro SET ativo = IF(id = ?, 1, 0)', [Number(req.params.id)]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[perfil ativar] erro:', e.message);
    res.status(500).json({ erro: 'Falha a ativar' });
  }
});

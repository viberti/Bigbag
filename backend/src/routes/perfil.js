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

// Criar/atualizar um membro: { nome, texto? }. O TEXTO é opcional — dá para criar
// um membro só com nome (p/ a lista partilhada / cor por membro) e juntar o perfil
// de saúde depois. Quando vem texto, extrai o resumo. Fica ativo.
perfilRouter.post('/', async (req, res) => {
  try {
    const texto = String(req.body?.texto || '').trim();
    let resumo = null, custo = 0;
    if (texto) { const r = await extrairPerfil(texto); resumo = r.resumo; custo = r.custo; }
    const nome = String(req.body?.nome || resumo?.nome || '').trim().slice(0, 80);
    if (!nome) return res.status(400).json({ erro: 'Falta o nome do membro' });

    const pool = getPool();
    // upsert por nome (um membro por nome). Membro só-nome NÃO apaga o perfil
    // existente: só sobrescreve texto/resumo quando vem texto novo.
    const [[ja]] = await pool.query('SELECT id FROM perfil_membro WHERE nome = ? LIMIT 1', [nome]);
    let id;
    if (ja) {
      if (texto) await pool.query('UPDATE perfil_membro SET texto = ?, resumo = ? WHERE id = ?', [texto, JSON.stringify(resumo), ja.id]);
      id = ja.id;
    } else {
      const [r] = await pool.query('INSERT INTO perfil_membro (nome, texto, resumo) VALUES (?,?,?)', [nome, texto || null, resumo ? JSON.stringify(resumo) : null]);
      id = r.insertId;
    }
    await pool.query('UPDATE perfil_membro SET ativo = IF(id = ?, 1, 0)', [id]);
    res.json({ id, nome, resumo, custo });
  } catch (e) {
    console.error('[perfil POST] erro:', e.message);
    res.status(500).json({ erro: 'Falha a guardar o membro' });
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

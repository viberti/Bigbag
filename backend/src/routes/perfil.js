// Perfis nutricionais por membro. Carregar (texto do ficheiro) → extrai resumo →
// guarda e ativa. Um perfil ativo de cada vez (usado nas avaliações personalizadas).
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { getPool, parseJsonCol } from '../db.js';
import { extrairPerfil } from '../ingest/perfil.js';

export const perfilRouter = Router();
perfilRouter.use(requireAuth);

// Limpa um array de strings (trim, sem vazios, dedup, teto). Para as características do editor.
const limparArr = (x) => [...new Set((Array.isArray(x) ? x : []).map((s) => String(s || '').trim()).filter(Boolean))].slice(0, 40);
// Os 6 grupos do editor → campos do resumo (as ATIVAS, lidas pela avaliação). `nut` é um array
// novo (`metas`) — distinto do `nutrientes` (objeto) que o LLM extrai do texto.
const GRUPO_CAMPO = { obj: 'objetivos', cond: 'condicoes', diet: 'restricoes', pref: 'preferir', evit: 'evitar', nut: 'metas' };
// Demografia saneada (só os campos esperados, como strings curtas).
function limparDemografia(d) {
  if (!d || typeof d !== 'object') return null;
  const out = {}; let tem = false;
  for (const k of ['email', 'idade', 'sexo', 'peso', 'altura']) { const v = String(d[k] ?? '').trim().slice(0, 80); if (v) { out[k] = v; tem = true; } }
  return tem ? out : null;
}

// Lista os perfis (com o resumo + estado do editor de saúde) e marca qual está ativo.
perfilRouter.get('/', async (req, res) => {
  try {
    const [rows] = await getPool().query('SELECT id, nome, resumo, saude_estado, ativo, atualizado_em FROM perfil_membro ORDER BY ativo DESC, nome');
    res.json({ perfis: rows.map((r) => ({ ...r, resumo: parseJsonCol(r.resumo), saude_estado: parseJsonCol(r.saude_estado) })) });
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

    const demografia = limparDemografia(req.body?.demografia);
    const pool = getPool();
    // upsert por nome (um membro por nome). Membro só-nome NÃO apaga o perfil
    // existente: só sobrescreve texto/resumo quando vem texto novo.
    const [[ja]] = await pool.query('SELECT id, saude_estado FROM perfil_membro WHERE nome = ? LIMIT 1', [nome]);
    let id;
    if (ja) {
      if (texto) await pool.query('UPDATE perfil_membro SET texto = ?, resumo = ? WHERE id = ?', [texto, JSON.stringify(resumo), ja.id]);
      if (demografia) { const est = parseJsonCol(ja.saude_estado) || {}; est.demografia = { ...(est.demografia || {}), ...demografia }; await pool.query('UPDATE perfil_membro SET saude_estado = ? WHERE id = ?', [JSON.stringify(est), ja.id]); }
      id = ja.id;
    } else {
      const est = demografia ? JSON.stringify({ demografia }) : null;
      const [r] = await pool.query('INSERT INTO perfil_membro (nome, texto, resumo, saude_estado) VALUES (?,?,?,?)', [nome, texto || null, resumo ? JSON.stringify(resumo) : null, est]);
      id = r.insertId;
    }
    await pool.query('UPDATE perfil_membro SET ativo = IF(id = ?, 1, 0)', [id]);
    res.json({ id, nome, resumo, custo });
  } catch (e) {
    console.error('[perfil POST] erro:', e.message);
    res.status(500).json({ erro: 'Falha a guardar o membro' });
  }
});

// Guarda as características de saúde do EDITOR (handoff cartoon). Body:
//   { ativas: {obj,cond,diet,pref,evit,nut: string[]}, inativas: {...}, demografia? }
// As ATIVAS entram no `resumo` (os campos que a avaliação lê), preservando o que o editor não
// mexe (nome, alergias, intolerancias, nutrientes-objeto, notas). As INATIVAS + demografia ficam
// em `saude_estado` (não vão ao prompt da avaliação). Não mexe no `texto` original.
perfilRouter.post('/:id/saude', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ativas = req.body?.ativas || {};
    const inativas = req.body?.inativas || {};
    const pool = getPool();
    const [[m]] = await pool.query('SELECT resumo, saude_estado FROM perfil_membro WHERE id = ? LIMIT 1', [id]);
    if (!m) return res.status(404).json({ erro: 'Membro não encontrado' });
    const resumo = parseJsonCol(m.resumo) || {};
    for (const [g, campo] of Object.entries(GRUPO_CAMPO)) resumo[campo] = limparArr(ativas[g]);
    // TEXTO LIVRE: o que não cabe em pílula (plano de refeições, suplementos, horários…) →
    // fica em resumo.notas, que o prompt já inclui (linha "- Notas:"). null se vazio.
    if (typeof req.body?.notas === 'string') resumo.notas = req.body.notas.trim().slice(0, 4000) || null;
    const est = parseJsonCol(m.saude_estado) || {};
    est.inativas = Object.fromEntries(Object.keys(GRUPO_CAMPO).map((g) => [g, limparArr(inativas[g])]));
    const demografia = limparDemografia(req.body?.demografia);
    if (demografia) est.demografia = { ...(est.demografia || {}), ...demografia };
    await pool.query('UPDATE perfil_membro SET resumo = ?, saude_estado = ? WHERE id = ?', [JSON.stringify(resumo), JSON.stringify(est), id]);
    res.json({ ok: true, resumo, saude_estado: est });
  } catch (e) {
    console.error('[perfil saude] erro:', e.message);
    res.status(500).json({ erro: 'Falha a guardar as características de saúde' });
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

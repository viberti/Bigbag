// Ponto de entrada do backend Bigbag.
// MVP do esqueleto: app Express + /health para smoke test (systemd/Apache).
// Rotas de upload e consulta entram nos Blocos 2 e 3, atrás de auth.
import express from 'express';
import { config } from './config.js';
import { faturasRouter } from './routes/faturas.js';
import { consultaRouter } from './routes/consulta.js';
import { vozRouter } from './routes/voz.js';
import { adminRouter } from './routes/admin.js';
import { explorarRouter } from './routes/explorar.js';
import { produtoRouter } from './routes/produto.js';
import { perfilRouter } from './routes/perfil.js';
import { requireAuth } from './auth.js';
import { telemetriaApi, registarEventos } from './telemetria.js';

const app = express();

app.use(express.json());

// Telemetria de uso: regista (no fim) cada pedido /api que casou rota. Não bloqueia.
app.use(telemetriaApi);

// Eventos de uso só-frontend (ações que não tocam noutro endpoint: trocar de vista,
// abrir menu, carrinho…). Em lote, fire-and-forget. Só QUAL ação, nunca o conteúdo.
app.post('/api/telemetria', requireAuth, (req, res) => {
  const eventos = Array.isArray(req.body?.eventos) ? req.body.eventos.slice(0, 50) : [];
  // um só INSERT para o lote inteiro (fire-and-forget)
  registarEventos(eventos.map((e) => ({
    fonte: 'ui',
    utilizador: req.user.id,
    sessao: e?.sessao || null,
    evento: e?.evento,
    props: e?.props && typeof e.props === 'object' ? e.props : null,
  })));
  res.json({ ok: true, n: eventos.length });
});

// Smoke test — usado para validar o deploy (systemd + Apache + HTTPS).
// Público de propósito: não toca na BD nem na chave OpenRouter.
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'bigbag-backend',
    env: config.nodeEnv,
  });
});

// Validação de sessão (usado pelo login da PWA).
app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.user }));

// Histórico da conversa (a PWA mostra-o ao abrir).
app.get('/api/historico', requireAuth, async (req, res) => {
  try {
    const { listarHistorico } = await import('./historico.js');
    res.json({ mensagens: await listarHistorico(req.user.id) });
  } catch (e) {
    console.error('[historico] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar histórico' });
  }
});

// Custos das chamadas ao modelo (por contexto e por modelo).
app.get('/api/custos', requireAuth, async (req, res) => {
  try {
    const { resumoCustos } = await import('./custo.js');
    res.json(await resumoCustos());
  } catch (e) {
    console.error('[custos] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar custos' });
  }
});

// Qualidade da extração por modelo (sinal de reconciliação).
app.get('/api/qualidade', requireAuth, async (req, res) => {
  try {
    const { resumoQualidade } = await import('./custo.js');
    res.json(await resumoQualidade());
  } catch (e) {
    console.error('[qualidade] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar qualidade' });
  }
});

// Lista de compras habitual (produtos recorrentes) — para o ícone 🛒 na PWA.
// Agrupa por nome simplificado (quando definido) e só conta produtos comprados
// ≥2 vezes nos ÚLTIMOS 60 DIAS, para a lista ser útil e atual.
app.get('/api/habituais', requireAuth, async (req, res) => {
  try {
    const { produtos_habituais } = await import('./queries.js');
    const { getPool } = await import('./db.js');
    const periodo_inicio = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    res.json({ produtos: await produtos_habituais(getPool(), { min_idas: 2, periodo_inicio }) });
  } catch (e) {
    console.error('[habituais] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar lista habitual' });
  }
});

// Histórico de compras de um produto (data, loja, preço) — para o ícone 🧾 que
// se expande em cada item da Lista de compras na PWA.
app.get('/api/produto/historico', requireAuth, async (req, res) => {
  try {
    const nome = String(req.query.nome || '').trim();
    if (!nome) return res.json({ historico: [] });
    const { historico_produto } = await import('./queries.js');
    const { getPool } = await import('./db.js');
    res.json({ historico: await historico_produto(getPool(), { produto: nome }) });
  } catch (e) {
    console.error('[historico_produto] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar histórico do produto' });
  }
});

// Perfil do usuário (memória de longo prazo) — o que o assistente sabe.
app.get('/api/perfil', requireAuth, async (req, res) => {
  try {
    const { carregarPerfil } = await import('./perfil.js');
    res.json({ fatos: await carregarPerfil(req.user.id) });
  } catch (e) {
    console.error('[perfil] erro:', e.message);
    res.status(500).json({ erro: 'Falha a carregar perfil' });
  }
});

// Rotas de aplicação (protegidas por requireAuth lá dentro).
app.use('/api/faturas', faturasRouter);
app.use('/api/consulta', consultaRouter);
app.use('/api/voz', vozRouter);
app.use('/api/admin', adminRouter);
app.use('/api/explorar', explorarRouter);
app.use('/api/produto', produtoRouter);
app.use('/api/perfil', perfilRouter);

const server = app.listen(config.port, () => {
  console.log(`[bigbag-backend] a escutar na porta ${config.port} (${config.nodeEnv})`);
});

// Encerramento limpo para o systemd parar/reiniciar sem deixar a porta presa.
for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, () => {
    console.log(`[bigbag-backend] recebido ${sinal}, a encerrar.`);
    server.close(() => process.exit(0));
  });
}

export { app };

// Telemetria de USO — self-hosted, na nossa BD (tabela `evento_uso`). Regista QUE
// funcionalidade foi usada, por quem e quando; nunca o CONTEÚDO (não o que foi
// escrito/comprado). Fire-and-forget: nunca bloqueia nem quebra um pedido.
import { getPool } from './db.js';

// Grava um evento. Erros são engolidos — telemetria jamais deve afetar a app.
export async function registarEvento({ fonte = 'ui', utilizador = null, sessao = null, evento, props = null }) {
  if (!evento) return;
  try {
    await getPool().query(
      'INSERT INTO evento_uso (fonte, utilizador, sessao, evento, props) VALUES (?,?,?,?,?)',
      [fonte, utilizador, sessao ? String(sessao).slice(0, 40) : null, String(evento).slice(0, 120), props ? JSON.stringify(props) : null],
    );
  } catch (e) {
    console.error('[telemetria]', e.message);
  }
}

// Grava VÁRIOS eventos num só INSERT (o lote do frontend chega com até 50).
export async function registarEventos(eventos) {
  const linhas = (eventos || []).filter((e) => e?.evento);
  if (!linhas.length) return;
  try {
    await getPool().query(
      'INSERT INTO evento_uso (fonte, utilizador, sessao, evento, props) VALUES ?',
      [linhas.map((e) => [
        e.fonte || 'ui',
        e.utilizador || null,
        e.sessao ? String(e.sessao).slice(0, 40) : null,
        String(e.evento).slice(0, 120),
        e.props && typeof e.props === 'object' ? JSON.stringify(e.props) : null,
      ])],
    );
  } catch (e) {
    console.error('[telemetria] lote:', e.message);
  }
}

// Rotas a NÃO registar (ruído / recursão / pings).
const IGNORAR = new Set(['/api/telemetria', '/api/me', '/api/historico', '/health']);

// Middleware: no FIM de cada pedido /api que casou uma rota, regista o PADRÃO da
// rota (agregável: GET /api/faturas/:id, não /api/faturas/247), o utilizador e o
// estado. Corre depois da resposta → não adiciona latência.
export function telemetriaApi(req, res, next) {
  res.on('finish', () => {
    try {
      if (!req.route) return; // não casou rota (404) → ignora
      const padrao = (req.baseUrl || '') + (req.route.path && req.route.path !== '/' ? req.route.path : '');
      const nome = padrao || req.path;
      if (!nome.startsWith('/api')) return;
      if (IGNORAR.has(nome) || IGNORAR.has(req.path)) return;
      registarEvento({
        fonte: 'api',
        utilizador: req.user?.id || null,
        evento: `${req.method} ${nome}`,
        props: { status: res.statusCode },
      });
    } catch {
      /* noop */
    }
  });
  next();
}

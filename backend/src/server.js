// Ponto de entrada do backend Bigbag.
// MVP do esqueleto: app Express + /health para smoke test (systemd/Apache).
// Rotas de upload e consulta entram nos Blocos 2 e 3, atrás de auth.
import express from 'express';
import { config } from './config.js';
import { faturasRouter } from './routes/faturas.js';
import { consultaRouter } from './routes/consulta.js';
import { vozRouter } from './routes/voz.js';
import { requireAuth } from './auth.js';

const app = express();

app.use(express.json());

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

// Rotas de aplicação (protegidas por requireAuth lá dentro).
app.use('/api/faturas', faturasRouter);
app.use('/api/consulta', consultaRouter);
app.use('/api/voz', vozRouter);

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

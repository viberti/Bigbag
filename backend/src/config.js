// Carrega variáveis de ambiente do .env (não versionado) e expõe a configuração.
// Segredos vivem SÓ no .env — nunca hardcoded aqui.
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 4200,
  nodeEnv: process.env.NODE_ENV || 'development',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    name: process.env.DB_NAME || 'app_bigbag',
    user: process.env.DB_USER || 'bigbag',
    password: process.env.DB_PASSWORD || '',
  },
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    // Modelo geral (canonicalização, extração de PDF-texto): barato.
    model: process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-lite',
    // Consulta (tool-use): o flash-lite é inconsistente a chamar ferramentas
    // (ora chama, ora devolve vazio); o flash (full) é muito mais fiável e a
    // consulta é uma fração mínima do custo (a extração é ~87%).
    modelConsulta: process.env.OPENROUTER_MODEL_CONSULTA || 'google/gemini-2.5-flash',
    // Extração de fatura por IMAGEM (VLM): modelo mais forte (precisão em
    // térmicas amassadas vale mais que a economia).
    modelExtracao: process.env.OPENROUTER_MODEL_EXTRACAO || 'google/gemini-3.7-flash',
    // Tradução PT — 2.º voto numa FAMÍLIA DIFERENTE do gemini. Modelos da MESMA família alucinam
    // da MESMA maneira (caso real: "Cottage Cheese"→"Ricota" igual nos 2 votos gemini → consenso
    // inútil). Votos cross-família (Google + OpenAI) discordam na alucinação → o gate dispara.
    modelTraducaoAlt: process.env.OPENROUTER_MODEL_TRADUCAO_ALT || 'openai/gpt-4o-mini',
    timeoutMs: Number(process.env.OPENROUTER_TIMEOUT_MS) || 20000,
    // EXTRAÇÃO de talão (VLM/PDF) tem timeout PRÓPRIO e generoso: corre no worker em FUNDO
    // (ninguém está à espera — a app já respondeu 202) e um talão denso leva 20-60 s. Com os
    // 20 s interativos, talões grandes abortavam ("This operation was aborted") e o job
    // esgotava as 3 tentativas → "Não consegui ler" num talão perfeitamente legível
    // (caso real 2026-08-11: job 53 levou 19 s, à beira; o 55 passou e falhou 3×).
    timeoutExtracaoMs: Number(process.env.OPENROUTER_TIMEOUT_EXTRACAO_MS) || 120000,
    // Voz: modelo de transcrição (áudio é sensível; manter um modelo forte).
    sttModel: process.env.OPENROUTER_STT_MODEL || 'google/gemini-2.5-flash',
    // Auto-correção da extração: nº MÁXIMO de re-tentativas quando não reconcilia.
    maxCorrecoes: Math.max(0, Number(process.env.OPENROUTER_MAX_CORRECOES ?? 2)),
  },
  auth: {
    // Auth PRÓPRIA (email+senha → JWT nosso, HS256). Segredo só no .env; sem isto o login não assina.
    jwtSecret: process.env.AUTH_JWT_SECRET || '',
    tokenTtl: process.env.AUTH_TOKEN_TTL || '30d',
    // Test-auth (Basic) — rede de segurança para os e2e (ENABLE_TEST_AUTH=true). Off em produção.
    enableTestAuth: String(process.env.ENABLE_TEST_AUTH || '').toLowerCase() === 'true',
    testUsers: parseTestUsers(process.env.TEST_USERS),
  },
  uploads: {
    faturas: process.env.UPLOAD_DIR_FATURAS || './uploads/comprovantes',
    voz: process.env.UPLOAD_DIR_VOZ || './uploads/notas_voz',
  },
  // Lidl Plus (faturas digitais com EAN por linha). Só o refresh token é segredo
  // (vai no .env); o login inicial (browser+password+OTP) faz-se à parte com a
  // ferramenta `lidl-plus` e nunca toca no Bigbag. Ver src/ingest/lidlplus.js.
  lidlplus: {
    refreshToken: process.env.LIDLPLUS_REFRESH_TOKEN || '',
    country: process.env.LIDLPLUS_COUNTRY || 'PT',
    language: process.env.LIDLPLUS_LANGUAGE || 'pt',
    // Onde guardar o refresh token ROTACIONADO (o módulo atualiza-o a cada uso).
    // Prod: /var/lib/bigbag/lidlplus_token (chmod 600). Semente: LIDLPLUS_REFRESH_TOKEN.
    tokenFile: process.env.LIDLPLUS_TOKEN_FILE || './.lidlplus_token',
  },
  // Camada PREÇO+LOCALE por país (Visao_Multi_Pais). A IDENTIDADE (EAN) é partilhada;
  // o país do utilizador decide moeda + que fontes de catálogo dão o preço/nome locais.
  // `fontesPreco`: fontes de catalogo_produto desse país (ordem = preferência).
  paisDefault: 'PT',
  paises: {
    PT: { moeda: 'EUR', simbolo: '€', fontesPreco: ['continente', 'auchan', 'pingodoce', 'lidl', 'mercadona', 'mercadona-off', 'lidl-fr', 'harvest', 'nutripedia'] },
    BR: { moeda: 'BRL', simbolo: 'R$', fontesPreco: ['savegnago', 'zaffari', 'supernosso', 'comper', 'atacadao', 'supermuffato', 'prezunic', 'zonasul', 'carone', 'giassi', 'mambo', 'condor', 'assai', 'dia-br'] },
  },
};

// País → config (com fallback ao default). Fonte única para moeda/símbolo/fontes.
export function paisCfg(pais) {
  return config.paises[(pais || config.paisDefault || 'PT').toUpperCase()] || config.paises[config.paisDefault] || config.paises.PT;
}

function parseTestUsers(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => x && x.u && x.p) : [];
  } catch {
    return [];
  }
}

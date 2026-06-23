// Entry-point standalone do MOTOR de gatilho (dry-run). Normalmente roda LOGO APÓS a colheita
// densa (ver monitorar_precos.mjs, que chama os dois em sequência), mas pode correr à mão p/
// re-avaliar com o último snapshot. NÃO envia nada (grava alerta_log entregue=0).
//   node --env-file=.env scripts/avaliar_alertas.mjs
import { avaliarAlertas } from '../src/ingest/motorAlertas.js';
import { closePool } from '../src/db.js';
const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
console.log(`\n===== avaliar_alertas ${ts()} =====`);
try { await avaliarAlertas(); } catch (e) { console.error('[motor] erro:', e); process.exitCode = 1; } finally { await closePool(); }

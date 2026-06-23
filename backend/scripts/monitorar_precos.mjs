// Colheita periódica (CRON, 4/4h) de preço + estoque dos remédios monitorados → histórico
// denso. Ver ingest/monitorarPrecos.js. Instalar no crontab do `dev`:
//   0 */4 * * * cd /home/dev/bigbag/backend && /usr/bin/node --env-file=.env scripts/monitorar_precos.mjs >> /home/dev/bigbag/logs/monitor.log 2>&1
import { monitorarMonitorados } from '../src/ingest/monitorarPrecos.js';
import { closePool } from '../src/db.js';

const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
console.log(`\n===== monitor_precos ${ts()} =====`);
try {
  await monitorarMonitorados();
} catch (e) {
  console.error('[monitor] erro:', e);
  process.exitCode = 1;
} finally {
  await closePool();
}

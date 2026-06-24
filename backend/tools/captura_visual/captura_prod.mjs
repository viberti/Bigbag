// CAPTURA DE SINAL DE PROGRAMA — PRODUÇÃO (tarefa c). Render real (chromium) → fpVisual → cascata
// (estruturado → texto → VLM só-no-resíduo-e-só-se-fpVisual-mudou) → máquina de estados. Escreve em
// programa_sinal. Cache de fingerprint em diag_cache.json (sem migração). VLM SÓ detecta programa
// (nome+existência), nunca preço/percentual. NÃO toca preço/captura estruturada/motor/cluster2/catálogo.
//   Modos:  (default) DIÁRIO incremental — VLM só onde fpVisual mudou.
//           --full     SEMANAL full-scan — VLM em TODAS (leitura independente; promove quarentena).
//   Escopo: Mounjaro (tirzepatida). FONTES=a,b limita (p/ execução observável).
//
// QUESTÃO A (anti-alucinação): o gate >=2 que PROMOVE da quarentena exige DUAS leituras INDEPENDENTES
//   (2 VLM reais, OU 1 VLM + corroboração estrutural/texto). fpVisual IGUAL renova um VALIDADO mas
//   NUNCA promove um DETECTADO (senão a alucinação da 1ª leitura promover-se-ia a si mesma).
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';

const DIR = process.env.CAPTURA_DIR || '/home/dev/diag';
const FULL = process.argv.includes('--full');
const FONTES_ENV = (process.env.FONTES || '').split(',').filter(Boolean);
const env = Object.fromEntries(readFileSync('/home/dev/bigbag/backend/.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const KEY = env.OPENROUTER_API_KEY; const MODELO = 'google/gemini-2.5-flash';
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const RENDER_MIN = 0.5; // limiar de saúde por fonte (abaixo = captura cega)

const MAN = JSON.parse(readFileSync('/home/dev/bigbag/backend/scripts/fontes_farmacia.json', 'utf8'));
const meta = new Map(MAN.map((f) => [f.fonte, { motor: f.motor || 'vtex', geo: !!f.geo, host: f.host }]));
const PX = env.PROXY_URL || ''; const pmx = PX.match(/^https?:\/\/(?:([^:]+):([^@]+)@)?([^:]+):(\d+)/);
const proxy = pmx ? { server: `http://${pmx[3]}:${pmx[4]}`, username: pmx[1], password: pmx[2] } : null;
const cache = existsSync(`${DIR}/diag_cache.json`) ? JSON.parse(readFileSync(`${DIR}/diag_cache.json`, 'utf8')) : {};

// ── heurísticas (idênticas à (b), apertadas) ──
const GENERICO = /^(ofertas?|promo[çc][ãa]o|destaque|novidades?|mais vendidos?|frete|cupom gen)/i;
const normPrograma = (s) => { s = String(s || ''); if (/lilly/i.test(s)) return 'Lilly'; if (/novo ?nordisk/i.test(s)) return 'Novo Nordisk'; if (/novo ?dia/i.test(s)) return 'NovoDia'; if (/laborat/i.test(s) || /desc.*lab/i.test(s)) return 'Desconto de Laboratório'; const t = s.trim(); return (!t || GENERICO.test(t)) ? null : t.slice(0, 60); };
function progDoTexto(txt) {
  if (!txt) return null;
  if (/desconto\s+de\s+laborat[óo]rio/i.test(txt)) return 'Desconto de Laboratório';
  const lab = '(lilly|novo ?nordisk|novo ?dia)', tok = '(programa|desconto|benef[íi]cio|cadastr|cupom)';
  if (new RegExp(`${tok}[\\s\\S]{0,40}${lab}`, 'i').test(txt) || new RegExp(`${lab}[\\s\\S]{0,40}${tok}`, 'i').test(txt)) { const m = txt.match(new RegExp(lab, 'i')); return normPrograma(m[0]); }
  if (/(desconto|programa)[\s\S]{0,30}laborat[óo]rio|laborat[óo]rio[\s\S]{0,30}(desconto|programa)/i.test(txt)) return 'Desconto de Laboratório';
  return null;
}

// VLM de PRODUÇÃO: só programa (existência + nome). Nunca preço/percentual.
const PB = `Você vê o SCREENSHOT da página de um produto de farmácia (Mounjaro). Detecte SÓ a EXISTÊNCIA e o NOME de um PROGRAMA DE DESCONTO DE LABORATÓRIO (ex.: Lilly, Novo Nordisk, "Desconto de Laboratório", "programa de benefício/cadastro"). NÃO leia preço, NÃO leia percentual, NÃO calcule. Banners genéricos ("Ofertas", "Promoção", frete) NÃO são programa de laboratório. Responda SÓ JSON: {"programa_presente": true|false, "programa_nome": string|null, "evidencia": string}`;
async function vlmDetecta(b64) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODELO, response_format: { type: 'json_object' }, usage: { include: true }, temperature: 0,
      messages: [{ role: 'user', content: [{ type: 'text', text: PB }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + b64 } }] }] }) });
  const j = await r.json(); if (!j.choices) throw new Error('VLM ' + JSON.stringify(j).slice(0, 160));
  let o = {}; try { o = JSON.parse(j.choices[0].message.content); } catch { o = {}; }
  const prog = o.programa_presente ? normPrograma(o.programa_nome || '') : null;
  return { prog, usage: j.usage || {} };
}

const db = await mysql.createConnection({ host: env.DB_HOST || 'localhost', user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME || 'app_bigbag' });
let [grid] = await db.query(
  `SELECT cp.ean, cp.fonte, cp.url, cp.preco_cond, cp.preco_cond_obs FROM catalogo_produto cp JOIN medicamento m ON m.ean=cp.ean
    WHERE m.substancia='TIRZEPATIDA' AND cp.preco>0 AND cp.moeda='BRL' AND cp.url IS NOT NULL
      AND cp.fonte IN (${MAN.map(() => '?').join(',')}) ORDER BY cp.fonte, cp.ean`, MAN.map((f) => f.fonte));
if (FONTES_ENV.length) grid = grid.filter((r) => FONTES_ENV.includes(r.fonte));
const [[{ now }]] = await db.query('SELECT NOW() now');
const plus14 = new Date(now.getTime() + 14 * 864e5);
const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const [existRows] = await db.query('SELECT * FROM programa_sinal');
const prevByEF = new Map(); for (const r of existRows) prevByEF.set(`${r.ean}|${r.fonte}`, r);

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const health = {}; // fonte → {render_ok, total, vlm}
const log = { promovidos: [], expirados: [], congelados: [], aus_virou_pres: [], vlmReais: 0, vlmPoupadas: 0, custo: 0 };

for (const g of grid) {
  const key = `${g.fonte}__${g.ean}`, mt = meta.get(g.fonte) || {};
  const prev = prevByEF.get(`${g.ean}|${g.fonte}`) || null;
  const H = (health[g.fonte] ??= { render_ok: 0, total: 0, vlm: 0 }); H.total++;
  // ── RENDER ──
  let fpVisual = null, b64 = null, txt = '', renderOk = false;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1800 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36', ...(mt.geo && proxy ? { proxy } : {}) });
  try {
    const page = await ctx.newPage();
    await page.goto(g.url, { waitUntil: 'domcontentloaded', timeout: 13000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const buf = await page.screenshot({ fullPage: false }).catch(() => null);
    const html = await page.content().catch(() => '');
    const vis = await page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
    const imgs = await page.evaluate(() => Array.from(document.images).map((i) => i.currentSrc || i.src).filter(Boolean)).catch(() => []);
    renderOk = buf && buf.length > 40000 && html.length > 2000;
    if (renderOk) {
      H.render_ok++; b64 = buf.toString('base64'); txt = html;
      const vals = [...new Set([...vis.matchAll(/R\$\s?[\d.\s]+,\d{2}/g)].map((m) => m[0].replace(/\s/g, '')))].sort();
      const kws = [...new Set([...vis.matchAll(/(desconto|laborat[óo]rio|programa|lilly|economize|cupom|pbm|[-−]\d+%|frete gr[áa]tis|leve|combo|receita)/gi)].map((m) => m[0].toLowerCase()))].sort();
      const ib = [...new Set(imgs.map((u) => { try { return new URL(u).pathname.split('/').pop().toLowerCase(); } catch { return ''; } }).filter(Boolean))].sort();
      fpVisual = sha(vals.join('|') + '#' + kws.join('|') + '#' + ib.join('|'));
    }
  } catch { /* render falhou */ }
  await ctx.close();

  const prevFp = cache[key]?.fpVisual || null;
  const mudou = !prevFp || fpVisual !== prevFp;

  // ── CASCATA ──
  let programa = null, via = null, vlmReal = false;
  const pe = (g.preco_cond != null) ? normPrograma(g.preco_cond_obs) || 'Desconto de Laboratório' : null;  // (a) estruturado
  if (pe) { programa = pe; via = 'estruturado'; }
  if (!via && renderOk) { const pt = progDoTexto(txt); if (pt) { programa = pt; via = 'texto'; } }          // (b) texto
  if (!via && renderOk && (mudou || FULL)) {                                                                // (c) VLM real (só no resíduo + mudou/full)
    try { const r = await vlmDetecta(b64); H.vlm++; log.vlmReais++; vlmReal = true; log.custo += r.usage.cost || 0;
      if (r.prog) { programa = r.prog; via = 'vlm_real'; } else via = 'ausente_boa'; }
    catch { via = 'falha'; }
  } else if (!via && renderOk && !mudou && prev) { via = 'implicita'; programa = prev.programa_detectado; log.vlmPoupadas++; } // (d) re-confirmação implícita
  else if (!via && renderOk) { via = 'ausente_boa'; log.vlmPoupadas++; }                                    // unchanged, sem sinal e sem VLM
  else if (!via) { via = 'falha'; }

  // atualiza cache de fingerprint (mesmo sem sinal)
  if (renderOk) { cache[key] = { ...(cache[key] || {}), fpVisual, ts: fmt(now) }; }

  // ── MÁQUINA DE ESTADOS (Questão A resolvida) ──
  if (via === 'falha') { continue; } // CAPTURA FALHADA → NÃO mexe no sinal nem na expiração; a saúde-por-fonte regista
  let estado, conf = prev?.confirmacoes || 0, renova = false, valNow = false, presente = prev?.presente || 0, shot = prev?.shot_hash || fpVisual;
  if (via === 'estruturado' || via === 'texto') {
    estado = 'VALIDADO'; conf = Math.max(conf, 1); renova = true; valNow = !prev || prev.estado_validacao !== 'VALIDADO'; presente = 1; shot = fpVisual || shot;
    if (prev && prev.presente === 0) log.aus_virou_pres.push(`${g.fonte}/${g.ean} (via ${via})`);
  } else if (via === 'vlm_real') {
    presente = 1; shot = fpVisual; renova = true;
    if (!prev || prev.estado_validacao === 'EXPIRADO') { estado = 'DETECTADO'; conf = 1; }                  // 1ª leitura → quarentena
    else if (prev.estado_validacao === 'VALIDADO') { estado = 'VALIDADO'; }                                 // já validado → renova
    else if (prev.programa_detectado === programa) { estado = 'VALIDADO'; conf = (prev.confirmacoes || 1) + 1; valNow = true; log.promovidos.push(`${g.fonte}/${g.ean} ${programa} (2ª leitura VLM independente)`); } // GATE >=2 por leitura INDEPENDENTE
    else { estado = 'DETECTADO'; conf = 1; }                                                                // programa mudou → re-quarentena
    if (prev && prev.presente === 0) log.aus_virou_pres.push(`${g.fonte}/${g.ean} (via vlm)`);
  } else if (via === 'implicita') {
    presente = prev.presente; shot = fpVisual || prev.shot_hash;
    if (prev.estado_validacao === 'VALIDADO') { estado = 'VALIDADO'; renova = true; }                       // renova de graça
    else { estado = prev.estado_validacao; renova = true; }                                                 // QUARENTENA: renova FRESCOR mas NÃO promove (Questão A)
  } else if (via === 'ausente_boa') {
    if (!prev) { continue; }                                                                                // sem sinal, nada a escrever
    estado = prev.estado_validacao; conf = prev.confirmacoes;                                               // AUSÊNCIA em captura boa → NÃO renova (caminha p/ expirar)
    presente = 0;
  }
  const ultConf = renova ? fmt(now) : (prev?.ultima_confirmacao ? fmt(new Date(prev.ultima_confirmacao)) : null);
  let expira = renova ? fmt(plus14) : (prev?.expira_em ? fmt(new Date(prev.expira_em)) : null);
  const valEm = valNow ? fmt(now) : (prev?.validado_em ? fmt(new Date(prev.validado_em)) : null);
  if (expira && new Date(expira) < now) { estado = 'EXPIRADO'; log.expirados.push(`${g.fonte}/${g.ean}`); }
  const fonteSinal = via === 'implicita' ? prev.fonte_sinal : (via === 'vlm_real' ? 'vlm' : via === 'estruturado' ? 'html_estruturado' : 'html_texto');
  const modelo = (via === 'vlm_real') ? MODELO : (via === 'implicita' ? prev.modelo_vlm : null);
  await db.query(
    `INSERT INTO programa_sinal (ean,fonte,programa_detectado,presente,fonte_sinal,modelo_vlm,shot_hash,estado_validacao,confirmacoes,validado_em,ultima_confirmacao,expira_em)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE presente=VALUES(presente),fonte_sinal=VALUES(fonte_sinal),modelo_vlm=VALUES(modelo_vlm),
       shot_hash=VALUES(shot_hash),estado_validacao=VALUES(estado_validacao),confirmacoes=VALUES(confirmacoes),validado_em=VALUES(validado_em),
       ultima_confirmacao=VALUES(ultima_confirmacao),expira_em=VALUES(expira_em)`,
    [g.ean, g.fonte, programa, presente, fonteSinal, modelo, shot, estado, conf, valEm, ultConf, expira]);
}

// ── SAÚDE-POR-FONTE + CONGELAR-NA-CEGUEIRA ──
// Render-cego só ameaça sinais que DEPENDEM da captura visual (vlm/texto). Sinais estruturados
// (preco_cond) re-corroboram SEM render → fonte render-cega mas coberta por estruturado NÃO é cega.
const alarmes = [], infoBlind = [];
for (const [fonte, h] of Object.entries(health)) {
  const taxa = h.total ? h.render_ok / h.total : 0;
  if (taxa >= RENDER_MIN) continue;
  const [r] = await db.query("UPDATE programa_sinal SET ultima_confirmacao=?, expira_em=? WHERE fonte=? AND estado_validacao='VALIDADO' AND fonte_sinal IN('vlm','html_texto')", [fmt(now), fmt(plus14), fonte]);
  if (r.affectedRows) { alarmes.push(`⚠️ CAPTURA CEGA em ${fonte}: render ${Math.round(taxa * 100)}% (${h.render_ok}/${h.total}) → ${r.affectedRows} sinais VLM/texto CONGELADOS + investigar`); log.congelados.push(`${fonte}: ${r.affectedRows}`); }
  else infoBlind.push(`${fonte}: render ${Math.round(taxa * 100)}% mas sinais cobertos por ESTRUTURADO → não-cego p/ sinal (sem alarme)`);
}
writeFileSync(`${DIR}/diag_cache.json`, JSON.stringify(cache, null, 0));
await db.end(); await browser.close();

// ── OBSERVABILIDADE ──
console.log(`═══ CAPTURA PROGRAMA — ${FULL ? 'FULL-SCAN' : 'INCREMENTAL'} · ${fmt(now)} · ${grid.length} pares ═══`);
console.log('\nSAÚDE por fonte (render_ok/total · vlm):');
for (const [f, h] of Object.entries(health).sort()) console.log(`  ${f.padEnd(20)} render ${h.render_ok}/${h.total} (${Math.round(h.render_ok / h.total * 100)}%) · vlm ${h.vlm}`);
console.log(`\nVLM: reais ${log.vlmReais} · poupadas (pré-filtro+implícita+unchanged) ${log.vlmPoupadas} · custo $${log.custo.toFixed(4)}`);
console.log('TRANSIÇÕES:');
console.log(`  promovidos (quarentena→VALIDADO, 2ª leitura independente): ${log.promovidos.length}`); log.promovidos.slice(0, 10).forEach((x) => console.log('    + ' + x));
console.log(`  expirados: ${log.expirados.length}`); log.expirados.slice(0, 8).forEach((x) => console.log('    × ' + x));
console.log(`  congelados-na-cegueira: ${log.congelados.length}`); log.congelados.forEach((x) => console.log('    ❄ ' + x));
console.log(`  ausência→presença (texto perdeu, VLM pegou): ${log.aus_virou_pres.length}`); log.aus_virou_pres.slice(0, 8).forEach((x) => console.log('    ↑ ' + x));
if (alarmes.length) { console.log('\nALARMES:'); alarmes.forEach((a) => console.log('  ' + a)); }
if (infoBlind.length) { console.log('\nrender-cego mas coberto por estruturado (info):'); infoBlind.forEach((a) => console.log('  ' + a)); }
const [[c]] = await (await mysql.createConnection({ host: env.DB_HOST || 'localhost', user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME || 'app_bigbag' })).query("SELECT SUM(estado_validacao='VALIDADO') val, SUM(estado_validacao='DETECTADO') det, SUM(estado_validacao='EXPIRADO') exp FROM programa_sinal");
console.log(`\nESTADO GLOBAL programa_sinal: VALIDADO ${c.val} · DETECTADO(quarentena) ${c.det} · EXPIRADO ${c.exp}`);

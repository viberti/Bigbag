// CAPTURA DE SINAL DE PROGRAMA DE LABORATÓRIO (tarefa b). Reusa o cache (shots/texts/fpVisual + B do
// diagnóstico). Cascata barato→caro (estruturado → texto → VLM-só-no-resíduo → re-confirmação implícita),
// máquina de estados de validação, escreve em programa_sinal (migr. 084). NÃO agenda crons. NÃO toca
// preço/captura estruturada/motor/cluster 2/catálogo. VLM só programa (nome+existência). Idempotente.
//   Uso: node --env-file=… (creds lidas do .env do projeto)  · escopo: Mounjaro, todas as farmácias.
import { readFileSync, existsSync } from 'node:fs';
import mysql from 'mysql2/promise';

const DIR = process.env.CAPTURA_DIR || '/home/dev/diag'; // (c) moverá o cache p/ local de prod
const env = Object.fromEntries(readFileSync('/home/dev/bigbag/backend/.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const MODELO_VLM = 'google/gemini-2.5-flash';
const cache = JSON.parse(readFileSync(`${DIR}/diag_cache.json`, 'utf8'));
const db = await mysql.createConnection({ host: env.DB_HOST || 'localhost', user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME || 'app_bigbag' });

// ── heurísticas (PROPOSTA — mostradas no relatório) ──
const normPrograma = (s) => { s = String(s || ''); if (/lilly/i.test(s)) return 'Lilly'; if (/novo ?dia/i.test(s)) return 'NovoDia'; if (/novo ?nordisk/i.test(s)) return 'Novo Nordisk'; if (/laborat/i.test(s) || /desc.*lab/i.test(s)) return 'Desconto de Laboratório'; const t = s.trim(); return t ? t.slice(0, 60) : 'Desconto de Laboratório'; };
// TEXTO (APERTADA): o nome de marca/lab SOZINHO NÃO conta (Lilly é o FABRICANTE do Mounjaro → está
//   em toda a página). Exige CONTEXTO de desconto/programa: a frase explícita "desconto de laboratório",
//   OU um token de programa (programa/desconto/benefício/cadastre/cupom) PERTO do nome do lab/marca.
function progDoTexto(txt) {
  if (!txt) return null;
  if (/desconto\s+de\s+laborat[óo]rio/i.test(txt)) return 'Desconto de Laboratório';
  const nomeLab = '(lilly|novo ?nordisk|novo ?dia)';
  const tokenPrograma = '(programa|desconto|benef[íi]cio|cadastr|cupom)';
  if (new RegExp(`${tokenPrograma}[\\s\\S]{0,40}${nomeLab}`, 'i').test(txt) || new RegExp(`${nomeLab}[\\s\\S]{0,40}${tokenPrograma}`, 'i').test(txt)) {
    const m = txt.match(new RegExp(nomeLab, 'i')); return normPrograma(m[0]);
  }
  if (/(desconto|programa)[\s\S]{0,30}laborat[óo]rio|laborat[óo]rio[\s\S]{0,30}(desconto|programa)/i.test(txt)) return 'Desconto de Laboratório';
  return null;
}
// VLM (reusa o B do cache): só conta banner que NOMEIA um lab/programa — genéricos ("Ofertas",
//   "Promoção") NÃO são programa de laboratório.
function progDoVlm(B) {
  if (!B || B === 'RENDER_FALHOU') return null;
  for (const b of (B.banners || [])) {
    const s = `${b.programa || ''} ${b.texto || ''}`;
    if (/lilly|novo ?nordisk|novo ?dia/i.test(s)) return normPrograma(s);
    if (/desconto.*laborat|laborat[óo]rio|desc\.?\s*lab/i.test(s)) return 'Desconto de Laboratório';
  }
  return null;
}

// grade Mounjaro + estruturado (preco_cond/obs)
const MAN = JSON.parse(readFileSync('/home/dev/bigbag/backend/scripts/fontes_farmacia.json', 'utf8')).map((f) => f.fonte);
const [grid] = await db.query(
  `SELECT cp.ean, cp.fonte, cp.preco_cond, cp.preco_cond_obs FROM catalogo_produto cp JOIN medicamento m ON m.ean=cp.ean
    WHERE m.substancia='TIRZEPATIDA' AND cp.preco>0 AND cp.moeda='BRL' AND cp.url IS NOT NULL
      AND cp.fonte IN (${MAN.map(() => '?').join(',')}) ORDER BY cp.fonte, cp.ean`, MAN);
if (process.env.RESET) { const [r] = await db.query('DELETE FROM programa_sinal'); console.log(`(RESET: ${r.affectedRows} linhas anteriores apagadas — populadas só por esta execução de diagnóstico)`); }
const [[{ now }]] = await db.query('SELECT NOW() now');
const plus14 = new Date(now.getTime() + 14 * 864e5);
const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const [existentes] = await db.query('SELECT * FROM programa_sinal');
const prevByEF = new Map(); for (const r of existentes) prevByEF.set(`${r.ean}|${r.fonte}`, r);

const cont = { html_estruturado: 0, html_texto: 0, vlm: 0, implicita: 0, ausencia: 0, falha: 0 };
const estCont = { VALIDADO: 0, DETECTADO: 0, NAO_CORROBORADO: 0, EXPIRADO: 0 };
let vlmNovas = 0, vlmReusadas = 0;
const linhas = [];

for (const g of grid) {
  const key = `${g.fonte}__${g.ean}`;
  const ce = cache[key] || {};
  const fpVisual = ce.fpVisual || null;
  const prev = prevByEF.get(`${g.ean}|${g.fonte}`) || null;
  const txt = existsSync(`${DIR}/texts/${key}.txt`) ? readFileSync(`${DIR}/texts/${key}.txt`, 'utf8') : '';

  // ── CASCATA (para no 1.º nível que resolve) ──
  let programa = null, via = null, tipoNaoVi = null;
  // (d) RE-CONFIRMAÇÃO IMPLÍCITA: já há sinal e o fpVisual é o mesmo da última captura
  if (prev && prev.shot_hash && fpVisual && prev.shot_hash === fpVisual) { via = 'implicita'; programa = prev.programa_detectado; }
  if (!via) { const p = (g.preco_cond != null) ? normPrograma(g.preco_cond_obs) : null; if (p) { programa = p; via = 'html_estruturado'; } } // (a)
  if (!via) { const p = progDoTexto(txt); if (p) { programa = p; via = 'html_texto'; } }                                                   // (b)
  if (!via) { const p = progDoVlm(ce.B); if (p) { programa = p; via = 'vlm'; vlmReusadas++; } }                                            // (c) reusa o B do cache
  // ── os três tipos de "não vi" ──
  if (!via) {
    const renderOk = ce.B && ce.B !== 'RENDER_FALHOU';
    if (!renderOk && g.preco_cond == null && !progDoTexto(txt)) { tipoNaoVi = 'CAPTURA_FALHADA'; cont.falha++; }
    else { tipoNaoVi = 'AUSENCIA_GENUINA'; cont.ausencia++; }
  } else if (via !== 'implicita') cont[via]++;
  else cont.implicita++;

  // ── MÁQUINA DE ESTADOS ──
  // observação → (estado, confirmacoes, renova?, validado_agora?)
  let estado, conf, renova = false, valNow = false, presente = 0, shot = prev?.shot_hash || fpVisual;
  if (tipoNaoVi === 'CAPTURA_FALHADA') {
    if (!prev) { linhas.push({ g, programa: '—', via: 'captura_falhada', estado: '—', exp: null }); continue; } // nada a escrever
    estado = prev.estado_validacao; conf = prev.confirmacoes; presente = prev.presente; // NÃO mexe (nem expira)
  } else if (tipoNaoVi === 'AUSENCIA_GENUINA') {
    if (!prev) { linhas.push({ g, programa: '—', via: 'ausencia', estado: '—', exp: null }); continue; } // sem sinal
    estado = prev.estado_validacao; conf = prev.confirmacoes; presente = prev.presente; // NÃO renova → caminha p/ expirar
  } else if (via === 'html_estruturado' || via === 'html_texto') {
    estado = 'VALIDADO'; conf = Math.max(prev?.confirmacoes || 0, 1); renova = true; valNow = !prev || prev.estado_validacao !== 'VALIDADO'; presente = 1; shot = fpVisual || shot;
  } else if (via === 'vlm') {
    presente = 1; shot = fpVisual || shot;
    if (!prev) { estado = 'DETECTADO'; conf = 1; renova = true; }                                  // quarentena
    else if (prev.estado_validacao === 'VALIDADO') { estado = 'VALIDADO'; conf = prev.confirmacoes; renova = true; }
    else if (prev.programa_detectado === programa) { estado = 'VALIDADO'; conf = 2; renova = true; valNow = true; } // gate ≥2
    else { estado = 'DETECTADO'; conf = 1; renova = true; }
  } else if (via === 'implicita') {
    presente = prev.presente; shot = fpVisual;
    if (prev.estado_validacao === 'DETECTADO' || prev.estado_validacao === 'NAO_CORROBORADO') { estado = 'VALIDADO'; conf = 2; renova = true; valNow = true; } // 2.ª visão → promove
    else { estado = prev.estado_validacao; conf = prev.confirmacoes; renova = true; }
  }
  const ultConf = renova ? fmt(now) : (prev?.ultima_confirmacao ? fmt(new Date(prev.ultima_confirmacao)) : null);
  const expira = renova ? fmt(plus14) : (prev?.expira_em ? fmt(new Date(prev.expira_em)) : null);
  const valEm = valNow ? fmt(now) : (prev?.validado_em ? fmt(new Date(prev.validado_em)) : null);
  // expiração final
  if (expira && new Date(expira) < now) estado = 'EXPIRADO';
  const fonteSinal = (via === 'implicita') ? prev.fonte_sinal : via;
  const modelo = via === 'vlm' ? MODELO_VLM : (via === 'implicita' ? prev.modelo_vlm : null);

  await db.query(
    `INSERT INTO programa_sinal (ean, fonte, programa_detectado, presente, fonte_sinal, modelo_vlm, shot_hash, estado_validacao, confirmacoes, validado_em, ultima_confirmacao, expira_em)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE presente=VALUES(presente), fonte_sinal=VALUES(fonte_sinal), modelo_vlm=VALUES(modelo_vlm), shot_hash=VALUES(shot_hash),
       estado_validacao=VALUES(estado_validacao), confirmacoes=VALUES(confirmacoes), validado_em=VALUES(validado_em),
       ultima_confirmacao=VALUES(ultima_confirmacao), expira_em=VALUES(expira_em)`,
    [g.ean, g.fonte, programa, presente, fonteSinal, modelo, shot, estado, conf, valEm, ultConf, expira]);
  estCont[estado] = (estCont[estado] || 0) + 1;
  linhas.push({ g, programa, via, estado, exp: expira });
}
await db.end();

// ── RELATÓRIO ──
console.log('═══ CAPTURA DE PROGRAMA — Mounjaro (execução à mão) ═══');
console.log(`pares: ${grid.length} · serverNow=${fmt(now)} · janela expira=+14d (${fmt(plus14)})\n`);
console.log('fonte                ean             via                programa                       estado       expira_em');
for (const l of linhas) console.log(`${l.g.fonte.padEnd(20)} ${l.g.ean}  ${String(l.via).padEnd(17)} ${String(l.programa).padEnd(28)} ${String(l.estado).padEnd(11)} ${l.exp || '-'}`);
console.log('\n── contagem por VIA ──'); for (const k of Object.keys(cont)) console.log(`  ${k}: ${cont[k]}`);
console.log('── contagem por ESTADO ──'); for (const k of Object.keys(estCont)) if (estCont[k]) console.log(`  ${k}: ${estCont[k]}`);
console.log(`\n── VLM ── chamadas NOVAS: ${vlmNovas} · REUSADAS do cache: ${vlmReusadas} · poupadas pelo pré-filtro (estrut+texto): ${cont.html_estruturado + cont.html_texto}`);
console.log(`custo VLM desta execução: $${(vlmNovas * 0.0025).toFixed(4)} (reusou o cache → 0 chamadas novas)`);
const comPrograma = linhas.filter((l) => l.programa && l.programa !== '—').length;
console.log(`\n── CRUZAMENTO vs diagnóstico ── (ean×fonte) com programa: ${comPrograma}/115 · via estruturado ${cont.html_estruturado} (panvel/araujo) · texto ${cont.html_texto} · vlm ${cont.vlm}`);
console.log(`diagnóstico: VLM via selo em ~91 · estruturado ~31. Aqui a cascata para no 1.º nível, por isso 'vlm' = só o resíduo SÓ_B; estrut+texto+vlm devem cobrir ~os com programa.`);

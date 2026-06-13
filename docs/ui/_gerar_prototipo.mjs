// Gera um protótipo clicável (single-file HTML) das telas do BigBag, a partir dos
// screenshots reais + o mapa de navegação. Hotspots em % (robustos à resolução);
// controles do protótipo (voltar/início/zonas/índice) garantem navegabilidade.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const DIR = '../docs/ui';
const b64 = (f) => 'data:image/png;base64,' + readFileSync(`${DIR}/${f}`).toString('base64');

// id → { titulo, ficheiro, hotspots:[{x,y,w,h,to,lbl}] }  (x,y,w,h em %)
const T = {
  principal: { t: 'Principal (chat)', f: '01_principal.png', hs: [
    { x: 46, y: 1.5, w: 13, h: 5, to: 'lista', lbl: 'Lista' },
    { x: 59, y: 1.5, w: 13, h: 5, to: 'despensa', lbl: 'Despensa' },
    { x: 72, y: 1.5, w: 10, h: 5, to: 'menu', lbl: 'Menu ⋮' },
    { x: 82, y: 1.5, w: 16, h: 5, to: 'conta', lbl: 'Conta' },
    { x: 0, y: 92, w: 20, h: 8, to: '_camara', lbl: 'Câmara' },
    { x: 20, y: 92, w: 20, h: 8, to: 'scanner', lbl: 'Scanner' },
    { x: 40, y: 92, w: 20, h: 8, to: 'comparar', lbl: 'Comparar' },
    { x: 60, y: 92, w: 20, h: 8, to: '_compras', lbl: 'Compras' },
    { x: 80, y: 92, w: 20, h: 8, to: 'voz', lbl: 'Voz' },
  ] },
  lista: { t: 'Lista de compras', f: '02_lista.png', hs: [
    { x: 0, y: 0, w: 100, h: 13, to: 'principal', lbl: 'fechar (toque fora)' },
    { x: 85, y: 13, w: 14, h: 6, to: 'principal', lbl: 'fechar ✕' },
  ] },
  despensa: { t: 'Despensa', f: '03_despensa.png', hs: [
    { x: 0, y: 0, w: 100, h: 13, to: 'principal', lbl: 'fechar' },
    { x: 85, y: 13, w: 14, h: 6, to: 'principal', lbl: 'fechar ✕' },
    { x: 4, y: 26, w: 78, h: 50, to: 'ficha', lbl: 'tocar num produto → ficha' },
    { x: 4, y: 90, w: 92, h: 9, to: 'scanner', lbl: 'Escanear produto' },
  ] },
  menu: { t: 'Menu (kebab)', f: '04_menu.png', hs: [
    { x: 0, y: 0, w: 100, h: 8, to: 'principal', lbl: 'fechar' },
    { x: 4, y: 30, w: 92, h: 7, to: 'scanner', lbl: 'Consultar produto' },
    { x: 4, y: 38, w: 92, h: 7, to: 'gastos', lbl: 'Meus gastos' },
    { x: 4, y: 53, w: 92, h: 7, to: '_diag', lbl: 'Diagnóstico do scanner' },
  ] },
  gastos: { t: 'Meus gastos', f: '05_gastos.png', hs: [
    { x: 0, y: 0, w: 100, h: 14, to: 'principal', lbl: 'fechar' },
    { x: 85, y: 14, w: 14, h: 6, to: 'principal', lbl: 'fechar ✕' },
  ] },
  conta: { t: 'Conta', f: '06_conta.png', hs: [
    { x: 4, y: 10, w: 92, h: 8, to: 'perfil', lbl: 'Perfil nutricional' },
    { x: 0, y: 30, w: 100, h: 70, to: 'principal', lbl: 'fechar' },
  ] },
  perfil: { t: 'Perfil nutricional', f: '07_perfil.png', hs: [
    { x: 0, y: 0, w: 100, h: 14, to: 'principal', lbl: 'fechar' },
    { x: 85, y: 14, w: 14, h: 6, to: 'principal', lbl: 'fechar ✕' },
  ] },
  comparar: { t: 'Comparar produtos', f: '08_comparar.png', hs: [
    { x: 0, y: 0, w: 100, h: 24, to: 'principal', lbl: 'fechar' },
    { x: 85, y: 24, w: 14, h: 6, to: 'principal', lbl: 'fechar ✕' },
  ] },
  scanner: { t: 'Scanner / Consultar produto ⚠️', f: '09_scanner.png', hs: [
    { x: 0, y: 0, w: 100, h: 23, to: 'principal', lbl: 'fechar' },
    { x: 85, y: 23, w: 14, h: 6, to: 'principal', lbl: 'fechar ✕' },
    { x: 4, y: 41, w: 92, h: 16, to: 'ficha', lbl: 'lê o código → ficha' },
  ] },
  ficha: { t: 'Ficha de produto', f: '11_ficha.png', hs: [
    { x: 0, y: 0, w: 100, h: 14, to: 'principal', lbl: 'fechar' },
    { x: 85, y: 14, w: 14, h: 6, to: 'principal', lbl: 'fechar ✕' },
  ] },
  voz: { t: 'Voz (gravação)', f: '12_voz.png', hs: [
    { x: 0, y: 0, w: 100, h: 100, to: 'principal', lbl: 'fechar' },
  ] },
};
const STUBS = { _camara: 'Abre a CÂMARA NATIVA do telemóvel (não é uma tela da app).', _compras: 'Abre a lista de TALÕES (NotasSheet) — não capturada neste lote.', _diag: 'Abre /diag (página de diagnóstico do scanner) — fora deste protótipo.' };

const imgs = Object.fromEntries(Object.entries(T).map(([k, v]) => [k, b64(v.f)]));
const dados = JSON.stringify({ T: Object.fromEntries(Object.entries(T).map(([k, v]) => [k, { t: v.t, hs: v.hs }])), imgs, STUBS });

const html = `<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BigBag — protótipo navegável</title><style>
*{box-sizing:border-box;margin:0} body{background:#0c120f;color:#cfe;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;display:flex;min-height:100vh}
#side{width:210px;flex:0 0 auto;background:#0f1714;border-right:1px solid #1f2b25;padding:14px 10px;overflow:auto}
#side h1{font-size:15px;color:#3fd07f;margin-bottom:2px} #side .v{font-size:11px;color:#6b8} #side h2{font-size:11px;color:#789;margin:14px 0 6px;text-transform:uppercase;letter-spacing:.5px}
.nav{display:block;width:100%;text-align:left;background:none;border:0;color:#bcd;padding:7px 9px;border-radius:8px;cursor:pointer;font-size:13px}
.nav:hover{background:#16221c} .nav.on{background:#1d3a2a;color:#7fe6a8;font-weight:600}
#main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;gap:14px;position:relative}
#bar{display:flex;gap:8px;align-items:center} #bar button{background:#16221c;color:#cfe;border:1px solid #28382f;border-radius:9px;padding:8px 13px;cursor:pointer;font-size:13px}
#bar button:hover{background:#1d2c24} #ttl{font-weight:600;color:#9fe}
#phone{position:relative;width:360px;border:11px solid #1a1a1a;border-radius:42px;box-shadow:0 18px 50px rgba(0,0,0,.6);overflow:hidden;background:#000}
#phone img{display:block;width:100%}
.hs{position:absolute;cursor:pointer;border-radius:6px} .hs.show{background:rgba(63,208,127,.28);outline:1px solid rgba(63,208,127,.7)}
.hs .tip{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:#063;color:#cfe;font-size:10px;padding:1px 5px;border-radius:5px;white-space:nowrap;opacity:0;pointer-events:none}
.hs.show .tip{opacity:1}
#stub{position:absolute;inset:0;display:none;align-items:center;justify-content:center;text-align:center;padding:30px;background:rgba(8,14,11,.94);color:#bcd;font-size:14px}
#hint{font-size:12px;color:#678;max-width:360px;text-align:center}
</style></head><body>
<div id="side"><h1>BigBag</h1><div class="v">protótipo navegável · screenshots reais</div>
<h2>Telas</h2><div id="lista"></div>
<h2>Como usar</h2><div style="font-size:12px;color:#789">Clica nas zonas da tela (como no telemóvel). Liga <b>“mostrar zonas”</b> para ver onde podes clicar. Setas ← → ou Backspace para voltar.</div></div>
<div id="main">
  <div id="bar"><button id="back">← Voltar</button><button id="home">🏠 Início</button><button id="zones">👁 Mostrar zonas</button><span id="ttl"></span></div>
  <div id="phone"><img id="scr"><div id="hsbox"></div><div id="stub"></div></div>
  <div id="hint"></div>
</div>
<script>
const D = ${dados};
let atual='principal', hist=[], zonas=false;
const $=id=>document.getElementById(id);
function lista(){ $('lista').innerHTML=''; for(const k in D.T){ const b=document.createElement('button'); b.className='nav'+(k===atual?' on':''); b.textContent=D.T[k].t; b.onclick=()=>ir(k,true); $('lista').appendChild(b);} }
function ir(k,push){ if(D.STUBS[k]){ $('stub').style.display='flex'; $('stub').textContent=D.STUBS[k]; setTimeout(()=>$('stub').style.display='none',1800); return; }
  if(push&&k!==atual) hist.push(atual); atual=k; render(); }
function render(){ const o=D.T[atual]; $('scr').src=D.imgs[atual]; $('ttl').textContent=o.t; $('hint').textContent='';
  const box=$('hsbox'); box.innerHTML='';
  for(const h of o.hs){ const d=document.createElement('div'); d.className='hs'+(zonas?' show':''); d.style.left=h.x+'%';d.style.top=h.y+'%';d.style.width=h.w+'%';d.style.height=h.h+'%';
    d.onclick=()=>ir(h.to,true); const tp=document.createElement('span');tp.className='tip';tp.textContent=h.lbl;d.appendChild(tp); box.appendChild(d); }
  lista(); }
$('back').onclick=()=>{ if(hist.length){ atual=hist.pop(); render(); } };
$('home').onclick=()=>{ if(atual!=='principal')hist.push(atual); atual='principal'; render(); };
$('zones').onclick=()=>{ zonas=!zonas; $('zones').textContent=zonas?'👁 Esconder zonas':'👁 Mostrar zonas'; render(); };
document.onkeydown=e=>{ if(e.key==='Backspace'||e.key==='ArrowLeft')$('back').click(); };
lista(); render();
</script></body></html>`;
writeFileSync('../docs/ui/prototipo.html', html);
console.error('gerado: docs/ui/prototipo.html ·', Math.round(html.length / 1024), 'KB ·', Object.keys(T).length, 'telas');

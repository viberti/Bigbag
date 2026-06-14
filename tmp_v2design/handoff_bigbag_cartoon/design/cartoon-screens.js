/* BigBag — protótipo cartoon: router + telas. */
(function(){
  const M=window.BIGBAG_MARK, I=window.ICON;
  const scr=document.getElementById("screen"), hint=document.getElementById("hintbar");
  let stack=[];
  const stbar=`<div class="stbar"><span>9:41</span><span>●●● ▼ ▮</span></div>`;
  const motif=`<svg class="bg-motif" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice"><defs>
    <g id="lf"><path d="M0 0C-10 6-13 18-8 27 1 18 10 9 9 -3 5 -2 1 -1 0 0Z" fill="#d6e6bf"/></g>
    <g id="dr"><path d="M0 -8c5 7 7 10 7 13a7 7 0 1 1-14 0c0-3 2-6 7-13Z" fill="#cfe3e0"/></g></defs>
    <use href="#lf" x="34" y="150"/><use href="#dr" x="356" y="170"/><use href="#lf" x="366" y="360" transform="rotate(40 366 360)"/>
    <use href="#dr" x="24" y="380"/><use href="#lf" x="30" y="600" transform="rotate(-30 30 600)"/><use href="#dr" x="360" y="560"/><use href="#lf" x="352" y="730"/></svg>`;
  const nav=(on)=>{const cur=typeof on==='number'?["home","lista","despensa","perfil"][on]:on;
    return `<div class="cnav">${[["home","Início","home"],["list","Lista","lista"],["history","Histórico","historico"],["user","Perfil","perfil"]].map(([ic,lb,go])=>
    `<button class="nb ${cur===go?'on':''}" data-go="${go}"><span class="ni">${I(ic,{size:23,stroke:2})}</span>${lb}</button>`).join("")}</div>`;};
  const ctop=(title,sub,opts)=>{opts=opts||{};return `<div class="ctop">
    ${opts.back?`<button class="bk" data-go="_back"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>Voltar</button>`:`<span class="mk ${opts.amber?'amber':''}">${M({size:30})}</span>`}
    <div class="hi"><b>${title}</b>${sub?`<span>${sub}</span>`:''}</div>${opts.action||''}${opts.av?'<span class="av" data-go="perfil">S</span>':''}</div>`;};

  const S={};
  S.home=()=>`${stbar}${motif}${ctop('Olá, Sue','vamos às compras?',{av:1})}
    <div class="scrollarea">
      <div class="herolist" data-go="lista"><span class="mkbig">${M({size:110})}</span>
        <div class="k">A minha lista</div><div class="v">16 produtos</div><div class="s">12 alinhados com o seu perfil</div>
        <button class="go">Ver a lista →</button></div>
      <div class="quick">
        <button class="round-act" data-go="scanner"><span class="circ">${I('scan',{size:24,stroke:2})}</span><b>Consultar</b></button>
        <button class="round-act" data-go="receitas"><span class="circ" style="color:var(--coral)">${I('recipe',{size:24,stroke:2})}</span><b>Receitas</b></button>
        <button class="round-act" data-go="comparar"><span class="circ">${I('compare',{size:24,stroke:2})}</span><b>Comparar</b></button>
        <button class="round-act" data-go="despensa"><span class="circ" style="color:var(--amber-d)">${I('talao',{size:24,stroke:2})}</span><b>Despensa</b></button>
        <button class="round-act" data-go="notas"><span class="circ" style="color:var(--sky)">${I('chart',{size:24,stroke:2})}</span><b>Gastos</b></button>
      </div>
      <div class="clabel-row"><span class="clabel" style="font:800 17px var(--disp);color:var(--ink)">Comprado há pouco</span><button class="seeall" data-go="notas">Ver tudo →</button></div>
      <div class="frow" data-go="recibo"><span class="fdot" style="background:#e2231a">CO</span><div class="fb"><div class="fn">Continente</div><div class="fs">Hoje · 21 itens</div></div><span class="fp">38,74 €</span></div>
      <div class="frow" data-go="recibo"><span class="fdot" style="background:#0050aa">LI</span><div class="fb"><div class="fn">Lidl</div><div class="fs">Ontem · 9 itens</div></div><span class="fp">17,14 €</span></div>
    </div>${nav(0)}`;

  // lista partilhada (família a comprar ao mesmo tempo)
  const LU={sue:{n:"Sue",c:"#3f7a3f",s:"#e0efd2"},gus:{n:"Gustavo",c:"#5a6fb0",s:"#dcebf6"}};
  let activeU="sue";
  let addCollapsed=false;
  const picks={tomate:"gus"};            // o Gustavo já apanhou o tomate
  const qty={};
  const q=(id)=>qty[id]!=null?qty[id]:1;
  const qlabel=(it)=>it.u==='kg'?`${q(it.id).toFixed(1).replace('.',',')} kg`:`${q(it.id)} un`;
  const LITEMS=[
    {id:"banana",n:"Banana",sub:"~0,88 €/kg",pr:0.88,u:"kg",by:"sue",fits:["sue","gus"],sec:"Frutas e vegetais",h:"good",hl:"no perfil"},
    {id:"tomate",n:"Tomate",sub:"~1,39 €/kg",pr:1.39,u:"kg",by:"gus",fits:["sue","gus"],sec:"Frutas e vegetais",h:"good",hl:"no perfil"},
    {id:"alface",n:"Alface",sub:"~0,89 €",pr:0.89,u:"un",by:"sue",fits:["sue"],sec:"Frutas e vegetais",h:"good",hl:"no perfil"},
    {id:"maca",n:"Maçã",sub:"~1,49 €/kg",pr:1.49,u:"kg",by:"gus",fits:["sue","gus"],sec:"Frutas e vegetais",h:"good",hl:"no perfil"},
    {id:"leite",n:"Leite meio-gordo",sub:"~0,79 €/L",pr:0.79,u:"un",by:"gus",fits:["gus"],sec:"Laticínios",h:"good",hl:"no perfil"},
    {id:"iogurte",n:"Iogurte grego",sub:"~1,19 €",pr:1.19,u:"un",by:"sue",fits:["sue"],sec:"Laticínios",h:"good",hl:"no perfil"},
    {id:"ovos",n:"Ovos (dúzia)",sub:"~2,05 €",pr:2.05,u:"un",by:"sue",fits:["sue","gus"],sec:"Laticínios",h:"good",hl:"no perfil"},
    {id:"frango",n:"Peito de frango",sub:"~5,49 €/kg",pr:5.49,u:"kg",by:"gus",fits:["sue","gus"],sec:"Talho e peixe",h:"good",hl:"no perfil"},
    {id:"pao",n:"Pão de forma",sub:"Continente",pr:1.15,u:"un",by:"sue",fits:[],sec:"Padaria",h:"swap",hl:"integral"},
    {id:"bolachas",n:"Bolachas",sub:"Continente",pr:1.19,u:"un",by:"sue",fits:[],sec:"Mercearia",h:"swap",hl:"integrais"},
  ];
  function togglePick(id){ if(picks[id]===activeU) delete picks[id]; else picks[id]=activeU; }

  // notas (talões) + filtro por mercado
  const STORESF=[["todas","Todas",null,0],["continente","Continente","#e2231a",24],["pingo","Pingo Doce","#0a8a3f",18],["lidl","Lidl","#0050aa",15],["aldi","Aldi","#1f3a93",9],["minipreco","Minipreço","#e94e1b",4]];
  const _cdates=["Hoje","Ontem","12 jun","10 jun","07 jun","04 jun","31 mai","28 mai","24 mai","21 mai","17 mai","14 mai","10 mai","06 mai","02 mai","28 abr","24 abr","20 abr","16 abr","11 abr","06 abr","02 abr","28 mar","23 mar"];
  const _conti=_cdates.map((d,i)=>{const itens=6+((i*7)%20); const tot=(8+ (i*3.7)%34); return {s:"continente",ini:"CO",c:"#e2231a",n:"Continente",d:`${d} · ${itens} itens`,t:tot.toFixed(2).replace('.',',')+" €"};});
  const NOTAS=[
    ..._conti,
    {s:"pingo",ini:"PD",c:"#0a8a3f",n:"Pingo Doce",d:"Hoje · 5 itens",t:"12,30 €"},
    {s:"lidl",ini:"LI",c:"#0050aa",n:"Lidl",d:"Ontem · 9 itens",t:"17,14 €"},
    {s:"aldi",ini:"AL",c:"#1f3a93",n:"Aldi",d:"08 jun · 13 itens",t:"21,05 €"},
    {s:"pingo",ini:"PD",c:"#0a8a3f",n:"Pingo Doce",d:"03 jun · 8 itens",t:"19,05 €"},
    {s:"minipreco",ini:"MP",c:"#e94e1b",n:"Minipreço",d:"01 jun · 4 itens",t:"6,40 €"},
  ];
  let notasFilter="todas";

  S.lista=()=>{
    const cart=Object.keys(picks).length;
    const itemHtml=(it)=>{
      const p=picks[it.id], u=p?LU[p]:null;
      const hc=it.h==='good'?'var(--leaf-d)':'var(--amber-d)';
      const by=LU[it.by]||LU.sue;
      return `<div class="item ${p?'done':''}" data-pick="${it.id}" style="border-right:6px solid ${by.c}" title="adicionado por ${by.n}">
        <div class="ib"><div class="iname" style="${p?`color:#9aa888;text-decoration-color:${u.c}`:''}">${it.n}</div>
          ${p?`<span class="pickcart">${qlabel(it)} · no carrinho de ${u.n}</span>`:`<div class="isub">${it.h==='good'?`<span class="fits">${it.fits.map(m=>`<i class="profav" style="background:${LU[m].c}" title="no perfil de ${LU[m].n}">${LU[m].n[0]}</i>`).join('')}</span>`:`<b style="color:${hc}">${it.hl}</b>`} · ${it.sub}</div>`}</div>
        ${p?`<span class="pickav" style="background:${u.c}">${u.n[0]}</span>`
           :`<span class="qval">${qlabel(it)}</span><div class="qty"><button data-qty="${it.id}|-1">−</button><button data-qty="${it.id}|1">+</button></div>`}
      </div>`;
    };
    let html="", lastSec="";
    LITEMS.filter(it=>!picks[it.id]).forEach(it=>{
      if(it.sec!==lastSec){ html+=`<div class="sec">${it.sec}</div>`; lastSec=it.sec; }
      html+=itemHtml(it);
    });
    const bought=LITEMS.filter(it=>picks[it.id]);
    if(bought.length){
      html+=`<div class="sec boughtsec">${I('check',{size:13,stroke:2.6})} No carrinho · ${bought.length}</div>`;
      bought.forEach(it=>html+=itemHtml(it));
    }
    const au=LU[activeU];
    const estTot=LITEMS.reduce((a,b)=>a+b.pr,0).toFixed(2).replace('.',',');
    return `${stbar}${motif}${ctop('A minha lista','compartilhada<br>com a família',{back:1})}
      <div class="pricetag"><span class="pt-hole"></span><div class="pt-v"><b>${estTot} €</b><small>estimado</small></div></div>
      <div class="scrollarea">
        <!-- ideia guardada p/ depois: faixa "Provavelmente está a acabar" (sugestões de habituais a recompor) -->
        ${html}
      </div>
      <div class="actfoot"><div class="addmore" id="addMore">
        <div class="addfield">Escrever produto…</div>
        <button class="addopt">${I('list',{size:17,stroke:2})} Habituais</button>
        <button class="addopt">${I('search',{size:17,stroke:2})} Catálogo</button>
      </div>
      <div class="addbar">
        <button class="addfab scan" title="Ler código">${I('scan',{size:23,stroke:2,color:'#3f7a3f'})}</button>
        <button class="addfab mic" title="Voz">${I('mic',{size:24,stroke:2,color:'#f4fff0'})}</button>
        <button class="addfab plus" data-addtoggle title="Outras formas">${I('plus',{size:24,stroke:2.4,color:'#3f7a3f'})}</button>
      </div></div>${nav(1)}`;
  };

  S.despensa=()=>`${stbar}${motif}${ctop('Tenho em casa','51 itens',{back:1,amber:1})}
    <div class="scrollarea">
      <div class="sec amber">Frutas e vegetais</div>
      <div class="item" data-go="ficha"><div class="ib"><div class="iname">Banana</div><div class="isub">cacho</div></div></div>
      <div class="item" data-go="ficha"><div class="ib"><div class="iname">Cenoura</div><div class="isub">1 kg · estimado</div></div></div>
      <div class="sec amber">Conservas</div>
      <div class="item" data-go="ficha"><div class="ib"><div class="iname">Atum em lata</div><div class="isub">3×80g</div></div></div>
    </div>
    <div class="actfoot"><div class="addbar"><button class="addfab scan amber" data-go="scannerDesp" title="Escanear produto">${I('scan',{size:24,stroke:2,color:'#9a6a16'})}</button></div></div>${nav(2)}`;

  S.comparar=()=>`${stbar}${motif}${ctop('Comparar','escolha 2 a 6 produtos',{back:1})}
    <div class="scrollarea">
      <div class="item"><div class="ib"><div class="iname">Iogurte grego natural</div><div class="isub">Continente · 4×125g</div></div><span style="color:var(--ink-3)">${I('close',{size:16})}</span></div>
      <div class="selbox">adicione mais 1 para comparar</div>
      <div class="sec">Adicionar produto</div>
      <div class="scanmode">
        <button class="smode" data-go="cmpres">${I('scan',{size:24,stroke:2})}<span>Código</span></button>
        <button class="smode" data-go="cmpres">${I('photoprod',{size:24,stroke:2})}<span>Produto</span></button>
        <button class="smode" data-go="voz">${I('mic',{size:24,stroke:2})}<span>Voz</span></button>
        <button class="smode" data-go="texto">${I('search',{size:24,stroke:2})}<span>Texto</span></button>
      </div>
    </div>
    <div class="actfoot"><button class="cbtn cbtn-leaf" style="width:100%" data-go="cmpres">Comparar · 2 produtos</button></div>${nav(1)}`;

  S.cmpres=()=>`${stbar}${motif}${ctop('Comparar','iogurte grego · 2 versões',{back:1})}
    <div class="scrollarea">
      <div style="font:800 18px var(--disp);color:var(--ink);margin:2px 0">Melhor para a Sue</div>
      <div style="font:500 12.5px var(--font);color:var(--ink-2);margin-bottom:12px">por adequação ao perfil · preço de referência</div>
      <div class="item" data-go="ficha"><div class="ib"><div class="iname">Grego natural</div><div class="isub">Nutri-Score A · <span style="color:var(--ink-3)">ref. 1,19 €</span></div></div><span class="hpill good">${I('leaf',{size:12,stroke:2.4})} Adequado</span></div>
      <div class="item" data-go="ficha"><div class="ib"><div class="iname">Grego de sabores</div><div class="isub">Nutri-Score C · <span style="color:var(--ink-3)">ref. 1,05 €</span></div></div><span class="hpill swap">${I('swap',{size:12,stroke:2.4})} moderação</span></div>
      <div class="parecer" style="margin-top:12px"><p style="margin:0">A de sabores é mais barata, mas tem mais açúcar. Para o seu perfil, a <b style="color:var(--leaf-d)">natural</b> é a melhor escolha.</p></div>
    </div>${nav(1)}`;

  const fichaOpen={ing:false,selos:false,aval:false,fotos:false};
  let altSort="saude";
  // régua semáforo: nível 0..3 (sem/baixo, baixo, moderado, alto) — destaca o ativo
  const REG=(label,val,lvl,word)=>{
    const cols=['#7ec46a','#cdb83e','#e6a23c','#e0734f'];
    const segs=[0,1,2,3].map(i=>`<span class="rg-seg" style="background:${i===lvl?cols[lvl]:'var(--cream-2)'}"></span>`).join('');
    return `<div class="rgrow"><span class="rg-l">${label}</span><span class="rg-v">${val}</span>
      <span class="rg-bar">${segs}</span><span class="rg-w" style="color:${cols[lvl]}">${word}</span></div>`;
  };
  const accord=(key,title)=>`<button class="acc ${fichaOpen[key]?'open':''}" data-ficha="${key}"><span>${title}</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>`;

  S.recibo=()=>`${stbar}${motif}${ctop('Talão','',{back:1})}
    <div class="scrollarea">
      <div class="rec-band"><span class="fdot" style="background:#e2231a;width:46px;height:46px;border-radius:13px;font:800 16px var(--disp)">CO</span>
        <div><div style="font:800 16px var(--disp);color:var(--ink)">Continente</div><div style="font:600 12.5px var(--font);color:var(--ink-2)">14 jun 2026 · 21 itens</div></div>
        <span class="rec-tot">38,74 €</span></div>
      ${[['Banana','1,2 kg','1,06'],['Leite meio-gordo','6 un','4,74'],['Iogurte grego natural','4 un','3,16'],['Ovos (dúzia)','1 un','2,35'],['Peito de frango','0,8 kg','4,39'],['Tomate','1 kg','1,39'],['Pão de forma','2 un','2,30'],['Azeite virgem extra','1 un','5,49'],['Bolachas','3 un','3,57']].map(p=>
        `<div class="rec-item" data-go="ficha"><span class="ri-nm">${p[0]}</span><span class="ri-q">${p[1]}</span><span class="ri-p">${p[2]} €</span></div>`).join('')}
      <div class="rec-foot">21 itens · <b>38,74 €</b></div>
    </div>${nav(0)}`;

  S.ficha=()=>`${stbar}${motif}${ctop('Informação do produto','',{back:1,action:`<button class="hist-cmp" data-go="lista" title="Adicionar"><span style="color:var(--leaf-d)">${I('plus',{size:20,stroke:2.4})}</span></button>`})}
    <div class="scrollarea">
      <div class="f-hero">
        <div class="f-thumb"><svg viewBox="0 0 60 60"><rect width="60" height="60" rx="13" fill="#dfeaf4"/><rect x="14" y="20" width="32" height="30" rx="3" fill="#fff"/><rect x="14" y="14" width="32" height="12" rx="3" fill="#2f5fae"/><text x="30" y="23" text-anchor="middle" font-family="Baloo 2" font-weight="800" font-size="7" fill="#fff">GREGO</text></svg></div>
        <div class="f-name">Iogurte Grego Natural</div>
        <span class="ns-pill" style="background:#86c43b" title="Nutri-Score B">B</span>
      </div>

      <div class="parecer attn">
        <div class="ph">Para a Sue <span class="selo attn">Atenção</span></div>
        <p>Apesar de "natural", entra em <b>atenção</b> para você: a gordura saturada e o leite integral merecem cuidado, considerando seus objetivos de reduzir LDL.</p>
        <button class="acc-link" data-ficha="selos">Análise completa →</button>
      </div>

      <div class="reguas">
        ${REG('Açúcares','3,9 g',1,'baixo')}
        ${REG('Gordura','10,8 g',2,'moderado')}
        ${REG('Saturados','6,7 g',3,'alto')}
        ${REG('Sal','0,1 g',0,'muito baixo')}
        ${REG('Fibra','0,1 g',1,'baixo')}
        ${REG('Proteína','5,2 g',2,'fonte')}
      </div>

      <div class="alt-sec">
        <div class="alt-h">Alternativas similares</div>
        <div class="alt-sub">Produtos parecidos · nutrição por 100 g</div>
        ${[['Skyr Natural','4,23',['prot 11','good'],['gord. sat 0','good'],['açúc 3,7','good']],
           ['Iogurte Natural Oikos','4,86',['prot 3,4','mid'],['gord. sat 4,4','good'],['açúc 4,4','warn']],
           ['Iogurte Grego de Coco','3,67',['prot 3,5','mid'],['gord. sat 6,1','warn'],['açúc 14,1','bad']]].map(a=>
          `<div class="altx" data-go="ficha"><div class="alt-top"><span class="alt-n">${a[0]}</span><span class="alt-p">${a[1]} €/kg</span></div>
            <div class="alt-pills"><span class="ap ${a[2][1]}">${a[2][0]}</span><span class="ap ${a[3][1]}">${a[3][0]}</span><span class="ap ${a[4][1]}">${a[4][0]}</span></div></div>`).join('')}
      </div>

      <div class="accbox">
        ${accord('ing','Ingredientes <span class="acc-count">4</span>')}
        ${fichaOpen.ing?`<div class="acc-body">
          <div class="ing-nova">NOVA 3 · alimento processado — preparado com nata e leite em pó.</div>
          <div class="ing"><b>Leite pasteurizado inteiro</b> <i>base</i><p>Principal componente, fornece a base láctea. · origem: leite · <span class="origem">origem espanhola</span></p></div>
          <div class="ing"><b>Nata</b> <i>base</i><p>Dá cremosidade e o teor de gordura do iogurte grego. · origem: leite</p></div>
          <div class="ing"><b>Leite em pó desnatado</b> <i>espessante</i><p>Engrossa o iogurte e aumenta os sólidos lácteos. · origem: leite</p></div>
          <div class="ing"><b>Fermentos lácticos</b> <i>fermento</i><p>Transformam a lactose em ácido láctico, dando textura e sabor. · origem: leite</p></div>
          <div class="alerg">⚠ Alergénios: <b>Leite, Laticínios</b></div>
        </div>`:''}

        ${accord('selos','Porquê dos selos')}
        ${fichaOpen.selos?`<div class="acc-body">
          <p>Iogurte estilo grego natural, com leite pasteurizado inteiro e nata como ingredientes principais.</p>
          <p><b>Parecer:</b> boa fonte de cálcio, mas teor de gordura e saturada considerável. Os açúcares são os naturais do leite. Combine com fruta ou cereais para uma refeição equilibrada.</p>
          <p><b>Nutri-Score:</b> não foi fornecido; pelos valores por 100 g, o alto teor de gordura saturada penalizaria a nota.</p>
          <div class="chips-why">
            <span class="cw warn">Gordura relativamente alta (10,8 g)</span>
            <span class="cw warn">Saturada significativa (6,7 g)</span>
            <span class="cw">Açúcares da lactose (3,9 g)</span>
            <span class="cw good">Poucos ingredientes, essenciais</span>
          </div>
          <div class="fontes">Fontes: dados nutricionais e Nutri-Score do Open Food Facts; ingredientes lidos do rótulo por IA; NOVA e limiares do semáforo segundo a FSA (Reino Unido), por 100 g.<br><i>Informação factual. Não é aconselhamento de saúde nem substitui um profissional.</i></div>
        </div>`:''}

        ${accord('aval','Como avaliamos')}
        ${fichaOpen.aval?`<div class="acc-body small">
          <div class="th"><b>Açúcares</b> <span class="t good">≤0,5 sem</span><span class="t good">≤5 baixo</span><span class="t warn">≤22,5 moderado</span><span class="t bad">&gt;22,5 alto</span></div>
          <div class="th"><b>Gordura</b> <span class="t good">≤0,5 sem</span><span class="t good">≤3 baixo</span><span class="t warn">≤17,5 moderado</span><span class="t bad">&gt;17,5 alto</span></div>
          <div class="th"><b>Saturados</b> <span class="t good">≤0,1 sem</span><span class="t good">≤1,5 baixo</span><span class="t warn">≤5 moderado</span><span class="t bad">&gt;5 alto</span></div>
          <div class="th"><b>Sal</b> <span class="t good">≤0,1 muito baixo</span><span class="t good">≤0,3 baixo</span><span class="t warn">≤1,5 moderado</span><span class="t bad">&gt;1,5 alto</span></div>
          <div class="th"><b>Fibra</b> <span class="t warn">≤3 baixo</span><span class="t good">≤6 fonte</span><span class="t good">&gt;6 alto</span></div>
          <div class="th"><b>Proteína</b> <span class="t warn">≤12% baixo</span><span class="t good">≤20% fonte</span><span class="t good">&gt;20% alto</span></div>
          <div class="fontes">Critérios por 100 g (sólidos): alegações da UE (Reg. CE 1924/2006), limiares do semáforo UK FSA para "alto", e doses de referência (Reg. UE 1169/2011).<br><br>Fontes: dados nutricionais e Nutri-Score do <b>Open Food Facts</b>; ingredientes lidos do rótulo por IA; NOVA e limiares do semáforo segundo a FSA (Reino Unido), por 100 g.<br><i>Informação factual. Não é aconselhamento de saúde nem substitui um profissional.</i></div>
        </div>`:''}
      </div>
    </div>`;

  let scanMode="codigo";  // codigo | foto
  S.scanner=()=>{
    const isCode=scanMode==="codigo";
    return `${stbar}${motif}${ctop('Consultar produto', isCode?'aponte para o código':'fotografe o produto',{back:1})}
    <div class="scrollarea" style="display:flex;flex-direction:column">
      <div class="sc-cam ${isCode?'':'photo'}" data-go="ficha"><button class="sc-torch" data-torch title="Lanterna">${I('torch',{size:15,stroke:2,color:'#fff'})}</button><div class="sc-frame">${isCode?'<i class="tr"></i><i class="bl"></i>':''}</div><span class="sc-mk">${M({size:34})}</span></div>
      <div class="sc-hint">${isCode?'É só apontar para o código de barras —<br>eu encontro o produto pra você.':'Tire uma foto do produto —<br>eu reconheço o que é.'}</div>
      <div class="scanmode">
        <button class="smode ${isCode?'on':''}" data-scanmode="codigo">${I('scan',{size:24,stroke:2})}<span>Código</span></button>
        <button class="smode ${!isCode?'on':''}" data-scanmode="foto">${I('photoprod',{size:24,stroke:2})}<span>Produto</span></button>
        <button class="smode" data-go="voz">${I('mic',{size:24,stroke:2})}<span>Voz</span></button>
        <button class="smode" data-go="texto">${I('search',{size:24,stroke:2})}<span>Texto</span></button>
      </div>
    </div>`;
  };

  S.scannerDesp=()=>`${stbar}${motif}${ctop('Guardar na despensa','aponte e pronto',{back:1,amber:1})}
    <div class="scrollarea" style="display:flex;flex-direction:column">
      <span class="ctxpill">${I('talao',{size:13,stroke:2.2})} vai para a despensa</span>
      <div class="sc-cam" data-go="despensa"><div class="sc-frame"><i class="tr"></i><i class="bl"></i></div><span class="sc-mk">${M({size:34})}</span></div>
      <div class="sc-hint">Aponte para o código e adiciono na sua despensa.</div>
    </div>`;

  S.voz=()=>`${stbar}${motif}${ctop('Estou ouvindo…','',{back:1})}
    <div class="voz-wrap"><div class="voz-orb">${I('mic',{size:46,stroke:2,color:'#f4fff0'})}</div>
      <div class="voz-mk">${M({size:60})}</div>
      <div class="voz-bubble">Me diga o que você procura</div></div>`;

  S.perfil=()=>`${stbar}${motif}${ctop('Perfil nutricional','membro ativo')}
    <div class="scrollarea">
      <div class="parecer" style="background:var(--card)"><div style="display:flex;align-items:center;gap:12px"><span class="m-av" style="background:var(--leaf-soft);color:var(--leaf-d);border:0">S</span><div><div style="font:800 17px var(--disp);color:var(--ink)">Sue</div><div style="font:500 12.5px var(--font);color:var(--ink-2)">perfil ativo · usado nos pareceres</div></div></div>
        <div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:13px"><span class="hpill good">+ proteína</span><span class="hpill good">menos açúcar</span><span class="hpill" style="background:var(--card);color:var(--ink);border:1px solid var(--line)">sem lactose</span></div></div>

      <div class="menu-cap">Quem está comprando</div>
      <div class="members">
        <div class="member sue on"><div class="m-av">S</div><div class="m-name">Sue</div><div class="m-on">ativo</div></div>
        <div class="member gus" data-go="perfil"><div class="m-av">G</div><div class="m-name">Gustavo</div><div class="m-on">trocar</div></div>
        <div class="member add"><div class="m-av">+</div><div class="m-name" style="color:var(--ink-3)">Membro</div></div>
      </div>

      <div class="pf-load">
        <div class="pf-load-h">${I('spark',{size:16,color:'var(--leaf-d)'})} Carregar perfil de saúde</div>
        <p class="pf-load-s">Cole ou envie o ficheiro do perfil gerado pelo seu assistente. Fica ativo nas avaliações dos produtos.</p>
        <button class="pf-upload">${I('upload',{size:18,stroke:2})} Enviar ficheiro do perfil</button>
        <div class="pf-or"><span>ou cole o texto</span></div>
        <textarea class="pf-text" placeholder="Cole aqui o conteúdo do perfil que a Sue gerou…"></textarea>
        <button class="cbtn cbtn-leaf" style="width:100%;margin-top:4px">Guardar perfil</button>
      </div>
    </div>${nav("perfil")}`;

  S.notas=()=>{
    const chips=STORESF.map(([id,nm,c,ct])=>
      `<span class="sf ${notasFilter===id?'on':''}" data-sf="${id}">${c?`<i style="background:${c}"></i>`:''}${nm}${ct?` <span class="ct">${ct}</span>`:''}</span>`).join("");
    const list=NOTAS.filter(n=>notasFilter==="todas"||n.s===notasFilter);
    const parseT=(t)=>parseFloat(t.replace(/[^\d,]/g,'').replace(',','.'));
    const MN={jan:'Janeiro',fev:'Fevereiro',mar:'Março',abr:'Abril',mai:'Maio',jun:'Junho',jul:'Julho',ago:'Agosto',set:'Setembro',out:'Outubro',nov:'Novembro',dez:'Dezembro'};
    const monthOf=(d)=>{const m=d.match(/jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez/);return m?MN[m[0]]:'Junho';};
    const MR={jan:1,fev:2,mar:3,abr:4,mai:5,jun:6,jul:7,ago:8,set:9,out:10,nov:11,dez:12};
    const rank=(d)=>{const m=d.match(/jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez/);return m?MR[m[0]]:6;};
    list.sort((a,b)=>rank(b.d)-rank(a.d));
    const groups=[];
    list.forEach(n=>{const mn=monthOf(n.d); let g=groups.find(x=>x.m===mn); if(!g){g={m:mn,total:0,items:[]};groups.push(g);} g.total+=parseT(n.t); g.items.push(n);});
    const eur=(v)=>v.toFixed(2).replace('.',',')+" €";
    const rows=groups.map(g=>`<div class="monthsep-retro">
        <span class="ms-obj"><svg width="22" height="30" viewBox="0 0 22 30"><path d="M7 2h8v3l2 3v17a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8l2-3z" fill="#fff" stroke="#3f7a3f" stroke-width="1.6"/><rect x="5" y="15" width="12" height="11" rx="1.5" fill="#bfe3c8"/><rect x="6.5" y="1" width="9" height="2.6" rx="1.3" fill="#e8765a"/></svg></span>
        <span class="ms-month">${g.m}</span><span class="ms-rule"></span>
        <span class="ms-badge"><span class="rays"></span><b>${eur(g.total)}</b></span></div>`
      + g.items.map(n=>`<div class="frow" data-go="recibo"><span class="fdot" style="background:${n.c}">${n.ini}</span><div class="fb"><div class="fn">${n.n}</div><div class="fs">${n.d}</div></div><span class="fp">${n.t}</span></div>`).join("")).join("");
    const heroTot=groups.length?groups[0].total:0, prevTot=groups.length>1?groups[1].total:0;
    const pct=prevTot?Math.round((1-heroTot/prevTot)*100):0;
    const heroLine=groups.length>1?(pct>=0?`${pct}% menos que em ${groups[1].m}`:`${-pct}% mais que em ${groups[1].m}`):'';
    const heroMonth=groups.length?groups[0].m:'este mês';
    const fname=notasFilter==="todas"?"todos os mercados":STORESF.find(s=>s[0]===notasFilter)[1];
    return `${stbar}${motif}${ctop('Minhas compras',fname,{back:1})}
    <div class="scrollarea">
      <div class="herolist" data-go="gastos"><div class="k">Gasto em ${heroMonth}</div><div class="v">${eur(heroTot)}</div><div class="s">${heroLine}</div><span class="hero-link">ver análise ${I('chart',{size:13,color:'#f4fff0'})} →</span></div>
      <div class="storefilter">${chips}</div>
      ${rows}
    </div>
    <button class="fab-talao" data-go="camera"><span class="c">${I('camera',{size:20,stroke:2.2,color:'#f4fff0'})}</span>Ler talão</button>${nav(0)}`;
  };

  S.gastos=()=>{
    const pT=(t)=>parseFloat(t.replace(/[^\d,]/g,'').replace(',','.'));
    const mo=(d)=>{const m=d.match(/jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez/);return m?m[0]:'jun';};
    const eur=v=>v.toFixed(2).replace('.',',')+' €';
    const months=[['mar','Mar'],['abr','Abr'],['mai','Mai'],['jun','Jun']];
    const mtot=m=>NOTAS.filter(n=>mo(n.d)===m).reduce((a,b)=>a+pT(b.t),0);
    const totals=months.map(([k,l])=>({l,v:mtot(k)})); const max=Math.max(...totals.map(t=>t.v));
    const avg=totals.reduce((a,b)=>a+b.v,0)/totals.length;
    const jun=mtot('jun'), mai=mtot('mai'); const pct=Math.round((1-jun/mai)*100);
    const stores=[['continente','Continente','#e2231a'],['pingo','Pingo Doce','#0a8a3f'],['lidl','Lidl','#0050aa'],['aldi','Aldi','#1f3a93'],['minipreco','Minipreço','#e94e1b']];
    const stot=stores.map(([id,nm,c])=>({nm,c,v:NOTAS.filter(n=>n.s===id&&mo(n.d)==='jun').reduce((a,b)=>a+pT(b.t),0)})).filter(s=>s.v>0).sort((a,b)=>b.v-a.v);
    const smax=Math.max(...stot.map(s=>s.v));
    const cats=[['Frutas e vegetais',58.20,'#5a9f57'],['Laticínios',41.10,'#67b2c9'],['Mercearia',39.80,'#e6a23c'],['Talho e peixe',24.34,'#e0734f'],['Outros',16.00,'#9b8cc4']];
    const cmax=Math.max(...cats.map(c=>c[1]));
    return `${stbar}${motif}${ctop('Análise de gastos','Junho',{back:1})}
    <div class="scrollarea">
      <div class="ghero"><div class="gh-l"><div class="k">Gasto em Junho</div><div class="v">${eur(jun)}</div></div>
        <div class="gh-r"><span class="gchip">▼ ${pct}% vs Maio</span><span class="gmed">média<br><b>${eur(avg)}</b>/mês</span></div></div>
      <div class="sec">Últimos meses</div>
      <div class="gbars">${totals.map(t=>`<div class="gcol"><span class="gv">${Math.round(t.v)}</span><div class="gbar ${t.l==='Jun'?'on':''}" style="height:${Math.max(8,Math.round(t.v/max*92))}%"></div><b>${t.l}</b></div>`).join('')}</div>
      <div class="sec">Em que gastou</div>
      ${cats.map(c=>`<div class="gstore"><span class="gname">${c[0]}</span><span class="gamt">${eur(c[1])}</span><div class="gtrack"><div class="gfill" style="width:${Math.round(c[1]/cmax*100)}%;background:${c[2]}"></div></div></div>`).join('')}
      <div class="sec">Onde gastou</div>
      ${stot.map(s=>`<div class="gstore"><span class="gname">${s.nm}</span><span class="gamt">${eur(s.v)}</span><div class="gtrack"><div class="gfill" style="width:${Math.round(s.v/smax*100)}%;background:${s.c}"></div></div></div>`).join('')}
    </div>`;
  };

  const HIST=[
    {id:"h1",n:"Iogurte grego natural",sub:"Continente · 4×125g · hoje",h:"good",hl:"Adequado"},
    {id:"h2",n:"Leite meio-gordo",sub:"Continente · 1L · hoje",h:"good",hl:"Adequado"},
    {id:"h3",n:"Bolachas com chocolate",sub:"Continente · ontem",h:"swap",hl:"moderação"},
    {id:"h4",n:"Azeite virgem extra",sub:"Gallo · 750ml · ontem",h:"good",hl:"Adequado"},
    {id:"h5",n:"Refrigerante de cola",sub:"2L · segunda",h:"swap",hl:"moderação"},
  ];
  let histCompare=false; const histSel=new Set();
  S.historico=()=>{
    const rows=HIST.map(it=>{
      const sel=histSel.has(it.id);
      return `<div class="item hist ${sel?'sel':''}" ${histCompare?`data-histsel="${it.id}"`:'data-go="ficha"'}>
        ${histCompare?`<span class="histcheck ${sel?'on':''}">${sel?I('check',{size:14,stroke:3,color:'#fff'}):''}</span>`:''}
        <div class="ib"><div class="iname">${it.n}</div><div class="isub">${it.sub}</div></div>
        <span class="hpill ${it.h}">${I(it.h==='good'?'leaf':'swap',{size:12,stroke:2.4})} ${it.hl}</span></div>`;
    }).join("");
    return `${stbar}${motif}${ctop('Histórico', histCompare?`${histSel.size} selecionado(s)`:'produtos consultados',{back:1, action:`<button class="hist-cmp ${histCompare?'on':''}" data-histcompare title="Comparar">${I('compare',{size:20,stroke:2})}</button>`})}
      <div class="scrollarea">${rows}</div>
      ${histCompare&&histSel.size>=2?`<div class="actfoot"><button class="cbtn cbtn-leaf" style="width:100%" data-go="cmpres">Comparar ${histSel.size} produtos</button></div>`:''}
      ${nav("historico")}`;
  };

  S.receitas=()=>`${stbar}${motif}${ctop('Receitas','para o seu perfil',{back:1})}
    <div class="scrollarea">
      <div class="item" style="padding:0;overflow:hidden;border:2px solid #fff" data-go="receitas"><div style="height:88px;flex:0 0 96px;background:linear-gradient(135deg,#cfe6b0,#a6cd8c);display:grid;place-items:center;color:#3f7a3f">${I('recipe',{size:34,stroke:2})}</div><div class="ib" style="padding:11px 13px"><div class="iname">Salada de frango grelhado</div><div class="isub">rica em proteína · 20 min</div></div></div>
      <div class="item" style="padding:0;overflow:hidden;border:2px solid #fff" data-go="receitas"><div style="height:88px;flex:0 0 96px;background:linear-gradient(135deg,#f4d9b0,#e6b34a);display:grid;place-items:center;color:#9a6a16">${I('recipe',{size:34,stroke:2})}</div><div class="ib" style="padding:11px 13px"><div class="iname">Omelete de legumes</div><div class="isub">baixo açúcar · 12 min</div></div></div>
      <div class="item" style="padding:0;overflow:hidden;border:2px solid #fff" data-go="receitas"><div style="height:88px;flex:0 0 96px;background:linear-gradient(135deg,#f3c2b0,#e0734f);display:grid;place-items:center;color:#fff">${I('recipe',{size:34,stroke:2})}</div><div class="ib" style="padding:11px 13px"><div class="iname">Sopa de tomate caseira</div><div class="isub">usa o que tens na despensa</div></div></div>
    </div>${nav(0)}`;

  S.texto=()=>`${stbar}${motif}${ctop('Consultar por nome','escreva o produto',{back:1})}
    <div class="scrollarea">
      <div class="txtsearch"><span class="ts-ic">${I('search',{size:20,stroke:2})}</span><input class="ts-field" placeholder="Ex.: iogurte grego…" value="iog"><span class="ts-clear">${I('close',{size:16,stroke:2.4})}</span></div>
      <div class="sec">Resultados</div>
      <div class="frow" data-go="ficha"><span class="fdot" style="background:#67b2c9">${I('photoprod',{size:20,stroke:2,color:'#fff'})}</span><div class="fb"><div class="fn">Iogurte grego natural</div><div class="fs">Continente · 4×125g</div></div><span style="color:var(--ink-3)">${I('search',{size:0})}›</span></div>
      <div class="frow" data-go="ficha"><span class="fdot" style="background:#67b2c9">${I('photoprod',{size:20,stroke:2,color:'#fff'})}</span><div class="fb"><div class="fn">Iogurte grego 0% açúcar</div><div class="fs">Continente · 4×125g</div></div><span style="color:var(--ink-3)">›</span></div>
      <div class="frow" data-go="ficha"><span class="fdot" style="background:#e6a23c">${I('photoprod',{size:20,stroke:2,color:'#fff'})}</span><div class="fb"><div class="fn">Iogurte grego de frutos</div><div class="fs">Pingo Doce · 4×125g</div></div><span style="color:var(--ink-3)">›</span></div>
    </div>${nav(0)}`;

  const TITLE={home:"Início",lista:"Lista",despensa:"Despensa",comparar:"Comparar",cmpres:"Comparação",ficha:"Ficha",recibo:"Talão",scanner:"Consultar",scannerDesp:"Despensa",voz:"Voz",texto:"Consultar por nome",perfil:"Perfil",notas:"Compras",gastos:"Análise de gastos",receitas:"Receitas",historico:"Histórico"};
  function go(id){
    if(id==="camera"){nativeCam();return;}
    if(id==="_back"){id=stack.pop()||"home";}
    else if(id!=="home"){if(scr.dataset.cur&&scr.dataset.cur!==id)stack.push(scr.dataset.cur);}
    else stack=[];
    scr.innerHTML=(S[id]||S.home)();scr.dataset.cur=id;
    const sa=scr.querySelector('.scrollarea'); if(sa)sa.scrollTop=0;
    hint.textContent = id==="home"?"Toque para navegar":(TITLE[id]||id)+" · ✕/← volta";
  }
  function nativeCam(){const o=document.createElement('div');o.className='nativecam';
    o.innerHTML=`<div class="nc-box">${I('camera',{size:42,stroke:2,color:'#fff'})}<div class="nc-t">Câmara do telemóvel</div><div class="nc-s">usa a câmara nativa do sistema · talão ou produto</div></div>`;
    document.querySelector('.phone').appendChild(o);setTimeout(()=>o.remove(),1600);}
  document.addEventListener("click",e=>{
    const tr=e.target.closest("[data-torch]"); if(tr){ tr.classList.toggle("on"); return; }
    const at=e.target.closest("[data-addtoggle]"); if(at){ const p=document.getElementById("addMore"); if(p)p.classList.toggle("open"); return; }
    const ac=e.target.closest("[data-addcollapse]"); if(ac){ addCollapsed=!addCollapsed; scr.innerHTML=S.lista(); scr.dataset.cur="lista"; return; }
    const fa=e.target.closest("[data-ficha]"); if(fa){ const k=fa.getAttribute("data-ficha"); fichaOpen[k]=!fichaOpen[k]; scr.innerHTML=S.ficha(); scr.dataset.cur="ficha"; return; }
    const as=e.target.closest("[data-altsort]"); if(as){ altSort=as.getAttribute("data-altsort"); scr.innerHTML=S.ficha(); scr.dataset.cur="ficha"; return; }
    const hc=e.target.closest("[data-histcompare]"); if(hc){ histCompare=!histCompare; if(!histCompare) histSel.clear(); scr.innerHTML=S.historico(); scr.dataset.cur="historico"; return; }
    const hs=e.target.closest("[data-histsel]"); if(hs){ const id=hs.getAttribute("data-histsel"); histSel.has(id)?histSel.delete(id):histSel.add(id); scr.innerHTML=S.historico(); scr.dataset.cur="historico"; return; }
    const sm=e.target.closest("[data-scanmode]"); if(sm){ scanMode=sm.getAttribute("data-scanmode"); scr.innerHTML=S.scanner(); scr.dataset.cur="scanner"; return; }
    const sf=e.target.closest("[data-sf]"); if(sf){ notasFilter=sf.getAttribute("data-sf"); scr.innerHTML=S.notas(); scr.dataset.cur="notas"; return; }
    const qb=e.target.closest("[data-qty]"); if(qb){ const a=qb.getAttribute("data-qty").split("|"); const it=LITEMS.find(x=>x.id===a[0]); const st=it&&it.u==='kg'?0.5:1; qty[a[0]]=Math.max(st, (qty[a[0]]!=null?qty[a[0]]:1)+(+a[1])*st); scr.innerHTML=S.lista(); scr.dataset.cur="lista"; return; }
    const sw=e.target.closest("[data-switch]"); if(sw){ activeU=activeU==="sue"?"gus":"sue"; scr.innerHTML=S.lista(); scr.dataset.cur="lista"; return; }
    const p=e.target.closest("[data-pick]"); if(p){ togglePick(p.getAttribute("data-pick")); scr.innerHTML=S.lista(); scr.dataset.cur="lista"; return; }
    const t=e.target.closest("[data-go]");if(t)go(t.getAttribute("data-go"));
  });
  window.addEventListener("keydown",e=>{if(e.key==="Backspace"||e.key==="ArrowLeft")go("_back");});
  go("home");
})();

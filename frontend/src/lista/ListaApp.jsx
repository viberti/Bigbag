// App "Lista" (/lista) — SÓ a lista de compras, com a ajuda dos dados do BigBag.
// Mesmo servidor e mesmo login do BigBag; lista PRÓPRIA (header X-Lista: simples, migr. 099).
// O que vem do BigBag: autocomplete com os genéricos que a casa compra, secções do mercado,
// último preço pago, peso vs unidades, "talvez precise de" (cadência + habituais), voz e
// código de barras. Otimista + fila offline (estado.js): no mercado a rede falha.
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  verificarSessao, login, obterLista, adicionar, adicionarLote, atualizar, remover, limpar, restaurar, concluir,
  sair, sugestoes as sugestoesCadencia, habituais, autocompleteProduto, consultarProdutoEan, vozParaLista,
} from './api.js';
import { enfileirar, aplicar, novaMedida } from './estado.js';
import { resolverId } from '../listaOutbox.js';
import { agruparSec, setMoeda, fmtTamanho, precoLista, qtdTxt } from '../listaFormato.js';
import { limparMarca, nomeTalao } from '../produtoDisplay.js';
import { lerCodigoBarras } from '../leitorCodigo.js';
import { t, detetarLocale } from '../i18n.js';
import './lista.css';

detetarLocale('pt-BR');

const K_FILA = 'lista_simples_fila';
const K_CACHE = 'lista_simples_cache';
const K_REMAP = 'lista_simples_remap'; // tmp → id real (sobrevive entre envios e recargas)
const POLL_MS = 4000;
const ler = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? def; } catch { return def; } };
const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota/privado */ } };
const ehTmp = (id) => String(id).startsWith('tmp');
const utilizador = (r) => r?.user || r || null; // /api/me → { user }
const naRede = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/* ── Ícones (SVG em linha, traço 2, 24×24) ──────────────────────────────── */
const ICO = {
  mais: 'M12 5.5v.01M12 12v.01M12 18.5v.01',
  plus: 'M12 5v14M5 12h14',
  seta: 'M12 19V5M5 12l7-7 7 7',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v3',
  barras: 'M4 6v12M7 6v12M11 6v12M14 6v12M17 6v12M20 6v12',
  lista: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  menos: 'M5 12h14',
};
const Ico = ({ d, size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

/* ── Login (mesma conta do BigBag) ─────────────────────────────────────── */
function Login({ onEntrar }) {
  const [email, setEmail] = useState(''); const [senha, setSenha] = useState('');
  const [erro, setErro] = useState(''); const [aEntrar, setAEntrar] = useState(false);
  async function submeter(e) {
    e.preventDefault(); setErro(''); setAEntrar(true);
    try { await login(email, senha); onEntrar(utilizador(await verificarSessao())); }
    catch (err) { setErro(err?.message || t('lista.loginErro')); }
    finally { setAEntrar(false); }
  }
  return (
    <div className="ls ls-login">
      <img src="/lista-icons/lista-192.png" alt="" width="72" height="72" />
      <h1>{t('lista.loginTitulo')}</h1>
      <p>{t('lista.loginSub')}</p>
      <form onSubmit={submeter}>
        <input placeholder={t('lista.email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" autoComplete="username" />
        <input placeholder={t('lista.senha')} type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" />
        {erro && <div className="ls-erro">{erro}</div>}
        <button className="ls-btn" disabled={aEntrar || !email || !senha}>{aEntrar ? '…' : t('lista.entrar')}</button>
      </form>
    </div>
  );
}

/* ── Leitor de código de barras (ecrã inteiro) ──────────────────────────── */
function Scanner({ onCodigo, onFechar }) {
  const video = useRef(null); const [erro, setErro] = useState('');
  const cb = useRef(onCodigo); cb.current = onCodigo;
  useEffect(() => {
    let h = null; let vivo = true;
    lerCodigoBarras(video.current, (c) => { if (vivo) { vivo = false; h?.stop(); cb.current(c); } }, () => setErro(t('lista.scanErro')))
      .then((x) => { h = x; if (!vivo) x?.stop(); });
    return () => { vivo = false; h?.stop(); };
  }, []);
  return (
    <div className="ls-scan">
      <video ref={video} playsInline muted />
      <div className="ls-scan-moldura" />
      <div className="ls-scan-barra">
        <span>{erro || t('lista.scanDica')}</span>
        <button className="ls-btn ls-btn-claro" onClick={onFechar}>{t('lista.fechar')}</button>
      </div>
    </div>
  );
}

/* ── Linha de um item ───────────────────────────────────────────────────── */
function Item({ it, onMarcar, onMais, onMenos }) {
  const noCarrinho = it.estado === 'carrinho';
  const sub = noCarrinho ? null : [it.marca && limparMarca(it.marca), fmtTamanho(it.tamanho), precoLista(it)].filter(Boolean).join(' · ');
  return (
    <li className={`ls-item ${noCarrinho ? 'feito' : ''} ${it.pendente ? 'pendente' : ''}`}>
      <button className="ls-item-corpo" onClick={() => onMarcar(it, !noCarrinho)} aria-pressed={noCarrinho}>
        <span className={`ls-check ${noCarrinho ? 'on' : ''}`} aria-hidden="true">{noCarrinho && <Ico d={ICO.check} size={14} />}</span>
        <span className="ls-item-txt">
          <span className="ls-nome">{nomeTalao(it.nome)}</span>
          {sub && <span className="ls-sub">{sub}</span>}
        </span>
      </button>
      {noCarrinho
        ? <span className="ls-qtd-fixa">{qtdTxt(it)}</span>
        : (
          <span className="ls-stepper">
            <button onClick={() => onMenos(it)} aria-label="−"><Ico d={ICO.menos} size={16} /></button>
            <span className="ls-qtd">{qtdTxt(it)}</span>
            <button onClick={() => onMais(it)} aria-label="+"><Ico d={ICO.plus} size={16} /></button>
          </span>
        )}
    </li>
  );
}

/* ── App ─────────────────────────────────────────────────────────────────── */
export default function ListaApp() {
  const [sessao, setSessao] = useState(undefined); // undefined = a verificar; null = precisa de login
  useEffect(() => {
    verificarSessao().then((r) => setSessao(utilizador(r))).catch((e) => setSessao(e?.message === '401' || e?.message === '403' ? null : (ler(K_CACHE, null) ? { offline: true } : null)));
  }, []);
  useEffect(() => { if (sessao?.moeda) setMoeda(sessao.moeda); }, [sessao]);
  if (sessao === undefined) return <div className="ls ls-carregar">…</div>;
  if (!sessao) return <Login onEntrar={setSessao} />;
  return <Lista sessao={sessao} onSair={() => { sair(); setSessao(null); }} />;
}

function Lista({ sessao, onSair }) {
  const [itens, setItens] = useState(() => ler(K_CACHE, []));
  const [fila, setFila] = useState(() => ler(K_FILA, []));
  const [online, setOnline] = useState(naRede());
  const [texto, setTexto] = useState('');
  const [ac, setAc] = useState([]);           // autocomplete
  const [cad, setCad] = useState([]);         // cadência ("está na altura")
  const [hab, setHab] = useState([]);         // habituais da casa
  const [aviso, setAviso] = useState(null);   // { txt, desfazer? }
  const [voz, setVoz] = useState('');         // '' | 'ouvir' | 'pensar'
  const [scan, setScan] = useState(false);
  const [eanPendente, setEanPendente] = useState(null); // scan sem nome → o utilizador escreve
  const [menu, setMenu] = useState(false);
  const [foco, setFoco] = useState(false); // barra de adicionar focada → mostra as sugestões
  const etag = useRef(null);
  const filaRef = useRef(fila); filaRef.current = fila;
  const enviando = useRef(false);
  const remapRef = useRef(ler(K_REMAP, {}));
  const gravador = useRef(null);
  const quem = sessao?.nome || sessao?.email || null;

  const avisar = useCallback((txt, desfazer) => {
    setAviso({ txt, desfazer, k: Date.now() });
  }, []);
  useEffect(() => { if (!aviso) return undefined; const h = setTimeout(() => setAviso(null), aviso.desfazer ? 6000 : 3500); return () => clearTimeout(h); }, [aviso]);

  useEffect(() => { gravar(K_FILA, fila); }, [fila]);
  useEffect(() => { gravar(K_CACHE, itens); }, [itens]);

  // ── sincronização: envia a fila (FIFO) e depois lê o servidor (ETag/304) ──
  const sincronizar = useCallback(async () => {
    if (enviando.current) return;
    enviando.current = true;
    try {
      const remap = remapRef.current;
      while (filaRef.current.length) {
        const op = filaRef.current[0];
        const id = resolverId(op.id, remap);
        try {
          if (op.op === 'add') {
            const r = await adicionar({ nome: op.nome, quantidade: op.quantidade, ean: op.ean });
            remap[op.tmp] = r.id; gravar(K_REMAP, remap);
            // o item no ecrã passa já a ter o id real → as próximas mudanças nele não ficam presas
            setItens((xs) => xs.map((x) => (String(x.id) === String(op.tmp) ? { ...x, id: r.id, pendente: false } : x)));
          }
          // FIFO: o add deste tmp já correu antes; se o id continua tmp é porque o add foi
          // rejeitado → esta operação não tem alvo, descarta-se (não pode prender a fila).
          else if (ehTmp(id)) { /* descarta */ }
          else if (op.op === 'inc') await atualizar(id, { inc: op.inc });
          else if (op.op === 'qtd') await atualizar(id, { quantidade: op.quantidade });
          else if (op.op === 'medida') await atualizar(id, { qtd_medida: op.qtd_medida, unidade: op.unidade });
          else if (op.op === 'marcar') await atualizar(id, { marcado: op.marcado });
          else if (op.op === 'nome') await atualizar(id, { nome: op.nome });
          else if (op.op === 'remover') await remover(id);
          else if (op.op === 'concluir') await concluir();
        } catch (e) {
          if (e?.message === '401' || e?.message === '403') { onSair(); return; }
          if (/\s4\d\d$/.test(e?.message || '')) { /* pedido inválido → descarta e segue */ }
          else { setOnline(false); return; } // rede/5xx → tenta mais tarde
        }
        const resto = filaRef.current.slice(1).map((x) => ({ ...x, id: resolverId(x.id, remap) }));
        filaRef.current = resto; setFila(resto);
      }
      if (filaRef.current.length) return;
      if (Object.keys(remap).length) { remapRef.current = {}; gravar(K_REMAP, {}); } // fila vazia → já não há tmp por resolver
      const r = await obterLista(etag.current);
      setOnline(true);
      if (r.naoMudou) return;
      // só guarda o ETag se aplicar a lista: senão o próximo pedido dava 304 e uma mudança
      // da outra pessoa ficava escondida até haver outra alteração no servidor
      if (!filaRef.current.length) { etag.current = r.etag; setItens(r.itens || []); } // não pisar mudanças locais por enviar
    } catch (e) {
      if (e?.message === '401' || e?.message === '403') onSair(); else setOnline(false);
    } finally { enviando.current = false; }
  }, [onSair]);

  useEffect(() => {
    sincronizar();
    const tick = () => { if (document.visibilityState === 'visible') sincronizar(); };
    const h = setInterval(tick, POLL_MS);
    const volta = () => { setOnline(true); sincronizar(); };
    window.addEventListener('online', volta); document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(h); window.removeEventListener('online', volta); document.removeEventListener('visibilitychange', tick); };
  }, [sincronizar]);

  // sugestões: cadência ("está na altura") + habituais (uma vez por abertura)
  useEffect(() => {
    sugestoesCadencia().then(setCad).catch(() => {});
    habituais().then((h) => setHab(h || [])).catch(() => {});
  }, []);

  // ── mutações (otimistas) ──
  const fazer = useCallback((op) => {
    if (op.id != null) op = { ...op, id: resolverId(op.id, remapRef.current) };
    setItens((xs) => aplicar(xs, op, quem));
    const nova = enfileirar(filaRef.current, op);
    filaRef.current = nova; setFila(nova);
    setTimeout(sincronizar, 0);
  }, [quem, sincronizar]);

  const juntar = useCallback((nome, quantidade = 1, ean = null) => {
    const n = String(nome || '').trim();
    if (n.length < 2) return;
    fazer({ op: 'add', tmp: `tmp${Date.now()}${Math.random().toString(36).slice(2, 6)}`, nome: n, quantidade, ean });
  }, [fazer]);

  function submeter(e) {
    e?.preventDefault();
    juntar(texto, 1, eanPendente);
    setTexto(''); setAc([]); setEanPendente(null);
  }
  const marcar = (it, marcado) => fazer({ op: 'marcar', id: it.id, marcado });
  const mais = (it) => (it.unidade
    ? fazer({ op: 'medida', id: it.id, qtd_medida: novaMedida(it.qtd_medida, 1), unidade: it.unidade })
    : fazer({ op: 'inc', id: it.id, inc: 1 }));
  function menos(it) {
    const noMinimo = it.unidade ? (Number(it.qtd_medida) || 0) <= 0.05 : (it.quantidade || 1) <= 1;
    if (!noMinimo) {
      if (it.unidade) fazer({ op: 'medida', id: it.id, qtd_medida: novaMedida(it.qtd_medida, -1), unidade: it.unidade });
      else fazer({ op: 'inc', id: it.id, inc: -1 });
      return;
    }
    // "−" no mínimo = tirar da lista (com Desfazer)
    fazer({ op: 'remover', id: it.id });
    if (!ehTmp(it.id)) {
      avisar(t('lista.removido', { nome: nomeTalao(it.nome) }), async () => {
        try { await restaurar([{ id: it.id, estado: it.estado }]); etag.current = null; sincronizar(); } catch { /* sem rede */ }
      });
    }
  }
  function tirarRiscados() {
    setMenu(false);
    fazer({ op: 'concluir' }); // ficam como COMPRADOS no histórico (não 'removidos')
  }
  async function esvaziar() {
    setMenu(false);
    try {
      const { limpos } = await limpar();
      setItens([]); etag.current = null;
      avisar(t('lista.esvaziada'), async () => { try { await restaurar(limpos); etag.current = null; sincronizar(); } catch { /* sem rede */ } });
    } catch { setOnline(false); }
  }

  // ── autocomplete (genéricos da casa primeiro — vem do servidor) ──
  useEffect(() => {
    const q = texto.trim();
    if (q.length < 2 || !online) { setAc([]); return undefined; }
    const h = setTimeout(() => {
      autocompleteProduto(q, 'lista').then((r) => setAc((r?.sugestoes || []).slice(0, 6))).catch(() => setAc([]));
    }, 200);
    return () => clearTimeout(h);
  }, [texto, online]);

  // ── voz: ditar vários itens ──
  async function alternarVoz() {
    if (voz === 'ouvir') { gravador.current?.stop(); return; }
    if (voz) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream); const pedacos = [];
      mr.ondataavailable = (e) => { if (e.data?.size) pedacos.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setVoz('pensar');
        try {
          const { produtos } = await vozParaLista(new Blob(pedacos, { type: mr.mimeType || 'audio/webm' }));
          if (!produtos?.length) { avisar(t('lista.vozNada')); return; }
          await enviarPendentesEDepois(() => adicionarLote(produtos));
          avisar(t('lista.vozAdicionou', { nomes: produtos.map((p) => p.nome).join(', ') }));
        } catch { avisar(t('lista.vozFalhou')); }
        finally { setVoz(''); }
      };
      gravador.current = mr; mr.start(); setVoz('ouvir');
    } catch { avisar(t('lista.vozErro')); setVoz(''); }
  }
  // o lote devolve a lista completa: só a aplicamos se não houver mudanças locais por enviar
  async function enviarPendentesEDepois(fn) {
    await sincronizar();
    const r = await fn();
    etag.current = null;
    if (!filaRef.current.length && r?.itens) setItens(r.itens);
    else sincronizar();
  }

  // ── código de barras ──
  const aoCodigo = useCallback(async (ean) => {
    setScan(false);
    avisar(t('lista.scanAProcurar'));
    let nome = null;
    try { nome = (await consultarProdutoEan(ean, { pt: true }))?.nome || null; } catch { /* sem rede ou desconhecido */ }
    if (nome) { juntar(nome, 1, ean); setAviso(null); return; }
    setEanPendente(ean);
    avisar(t('lista.scanDesconhecido'));
  }, [avisar, juntar]);

  // ── derivados ──
  const ativos = itens.filter((x) => x.estado !== 'carrinho');
  const carrinho = itens.filter((x) => x.estado === 'carrinho');
  const grupos = useMemo(() => agruparSec(ativos), [ativos]);
  const talvez = useMemo(() => {
    const k = (n) => nomeTalao(String(n || '')).toLowerCase();
    const naLista = new Set(itens.map((x) => k(x.nome)));
    const out = []; const vistos = new Set();
    for (const s of cad) { const kk = k(s.nome); if (!naLista.has(kk) && !vistos.has(kk)) { vistos.add(kk); out.push({ nome: s.nome, quantidade: s.quantidade || 1, cad: true }); } }
    let n = 0;
    for (const h of hab) { if (n >= 6) break; const kk = k(h.produto); if (!naLista.has(kk) && !vistos.has(kk)) { vistos.add(kk); out.push({ nome: h.produto, quantidade: 1 }); n += 1; } }
    return out.slice(0, 10);
  }, [cad, hab, itens]);

  const mostrarSugestoes = !texto && talvez.length > 0 && (foco || !itens.length);
  const escolher = (nome, quantidade = 1, ean = null) => {
    juntar(nome, quantidade, ean); setTexto(''); setAc([]); setEanPendente(null);
  };
  return (
    <div className="ls">
      <header className="ls-topo">
        <h1>{t('lista.titulo')}</h1>
        {ativos.length > 0 && <span className="ls-conta">{ativos.length}</span>}
        <button className="ls-icone ls-icone-plano" aria-label={t('lista.menu')} onClick={() => setMenu((m) => !m)}><Ico d={ICO.mais} /></button>
        {menu && (
          <>
            <div className="ls-menu-fundo" onClick={() => setMenu(false)} />
            <div className="ls-menu" role="menu">
              <button onClick={tirarRiscados} disabled={!carrinho.length}>{t('lista.tirarRiscados')}</button>
              <button onClick={esvaziar} disabled={!itens.length}>{t('lista.esvaziar')}</button>
              <button onClick={onSair}>{t('lista.sair')}</button>
            </div>
          </>
        )}
      </header>

      {(!online || fila.length > 0) && (
        <div className="ls-estado">{!online ? t('lista.offline') : t('lista.pendentes', { n: fila.length })}</div>
      )}

      <main className="ls-corpo">
        {!itens.length && (
          <div className="ls-vazia">
            <span className="ls-vazia-ico"><Ico d={ICO.lista} size={30} /></span>
            <p>{t('lista.vazia')}</p>
            <small>{t('lista.vaziaDica')}</small>
          </div>
        )}
        {grupos.map((g) => (
          <section key={g.s} className="ls-seccao">
            <h2>{g.s}</h2>
            <ul>{g.itens.map((it) => <Item key={it.id} it={it} onMarcar={marcar} onMais={mais} onMenos={menos} />)}</ul>
          </section>
        ))}
        {carrinho.length > 0 && (
          <section className="ls-seccao ls-carrinho">
            <h2>{t('lista.carrinho', { n: carrinho.length })}</h2>
            <ul>{carrinho.map((it) => <Item key={it.id} it={it} onMarcar={marcar} onMais={mais} onMenos={menos} />)}</ul>
          </section>
        )}
      </main>

      <div className="ls-base">
        {aviso && (
          <div className="ls-aviso" key={aviso.k}>
            <span>{aviso.txt}</span>
            {aviso.desfazer && <button onClick={() => { const f = aviso.desfazer; setAviso(null); f(); }}>{t('lista.desfazer')}</button>}
          </div>
        )}
        {ac.length > 0 && (
          <ul className="ls-ac">
            {ac.map((s) => (
              <li key={`${s.nome}|${s.ean || ''}`}>
                <button onMouseDown={(e) => e.preventDefault()} onClick={() => escolher(s.nome, 1, s.ean || null)}>
                  <span className={s.generico ? 'gen' : ''}>{s.nome}</span>
                  {(s.marca || s.tamanho) && <small>{[s.marca && limparMarca(s.marca), fmtTamanho(s.tamanho)].filter(Boolean).join(' · ')}</small>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {mostrarSugestoes && (
          <div className="ls-chips" aria-label={t('lista.talvez')}>
            {talvez.map((s) => (
              <button key={s.nome} className={s.cad ? 'cad' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => juntar(s.nome, s.quantidade)}>
                <Ico d={ICO.plus} size={14} /> {nomeTalao(s.nome)}{s.quantidade > 1 ? ` ×${s.quantidade}` : ''}
              </button>
            ))}
          </div>
        )}
        {voz && <div className="ls-voz">{voz === 'ouvir' ? t('lista.vozAOuvir') : t('lista.vozAPensar')}</div>}
        <form className="ls-entrada" onSubmit={submeter}>
          <span className="ls-entrada-ico"><Ico d={ICO.plus} /></span>
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={t('lista.placeholder')}
            onFocus={() => setFoco(true)} onBlur={() => setFoco(false)}
            enterKeyHint="done" autoComplete="off" aria-label={t('lista.placeholder')} />
          {texto.trim()
            ? <button className="ls-icone ls-icone-cheio" aria-label={t('lista.adicionar')}><Ico d={ICO.seta} /></button>
            : (
              <>
                <button type="button" className={`ls-icone ${voz ? 'ativo' : ''}`} onClick={alternarVoz} aria-label={t('lista.voz')} disabled={voz === 'pensar'}><Ico d={ICO.mic} /></button>
                <button type="button" className="ls-icone" onClick={() => setScan(true)} aria-label={t('lista.scan')}><Ico d={ICO.barras} /></button>
              </>
            )}
        </form>
      </div>
      {scan && <Scanner onCodigo={aoCodigo} onFechar={() => setScan(false)} />}
    </div>
  );
}

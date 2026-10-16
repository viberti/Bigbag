// App "Lista" (/lista) — SÓ a lista de compras, com a ajuda dos dados do BigBag.
// Mesmo servidor e mesmo login do BigBag; lista PRÓPRIA (header X-Lista: simples, migr. 099).
// O que vem do BigBag: autocomplete com os genéricos que a casa compra, secções do mercado,
// último preço pago, peso vs unidades, "talvez precise de" (cadência + habituais), voz e
// código de barras. Otimista + fila offline (estado.js): no mercado a rede falha.
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  verificarSessao, login, obterLista, adicionar, adicionarLote, atualizar, remover, limpar, restaurar, concluir,
  setToken, sair, sugestoes as sugestoesCadencia, habituais, listarPerfis, membroGuardado, guardarMembro, autocompleteProduto, consultarProdutoEan, vozParaLista,
} from './api.js';
import { enfileirar, aplicar, novaMedida } from './estado.js';
import { resolverId } from '../listaOutbox.js';
import { agruparSec, setMoeda, fmtTamanho, precoLista, qtdTxt } from '../listaFormato.js';
import { limparMarca, nomeTalao } from '../produtoDisplay.js';
import { lerCodigoBarras } from '../leitorCodigo.js';
import { t, detetarLocale } from '../i18n.js';
import './lista.css';

detetarLocale('pt-BR');

// LINK DE ACESSO DA CASA (#casa=<token>, gerado por scripts/convite_lista.mjs): abre-se UMA vez neste
// telemóvel; o token fica guardado e o endereço é limpo (o fragmento nunca vai ao servidor).
(function lerConvite() {
  const m = /[#&]casa=([^&]+)/.exec(window.location.hash || '');
  if (!m) return;
  setToken(decodeURIComponent(m[1]));
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}());

// COR POR MEMBRO (discreta): barra fina à esquerda = quem acrescentou; círculo/risco = quem riscou.
// Ordem estável por id do perfil. Paleta própria da Lista (não a do BigBag).
const CORES_MEMBRO = ['#0ea5e9', '#f43f5e', '#10b981', '#f59e0b', '#8b5cf6', '#14b8a6'];
const semAc = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
// o meu membro (para a cor otimista): mesmo critério do servidor (membroDoUtilizador em routes/lista.js)
function meuMembro(sessao, perfis) {
  const local = semAc(String(sessao?.email || sessao?.id || '').split('@')[0]);
  const cands = [sessao?.nome, sessao?.id].map(semAc).filter(Boolean);
  return perfis.find((p) => cands.includes(semAc(p.nome)))?.nome
    || perfis.find((p) => semAc(p.nome).length >= 3 && local.startsWith(semAc(p.nome)))?.nome
    || (perfis.find((p) => p.ativo) || perfis[0])?.nome || null;
}

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
  lixo: 'M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  menos: 'M5 12h14',
};
const Ico = ({ d, size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

/* ── Sem acesso: pede o link da casa (o login fica só como alternativa discreta) ── */
function SemAcesso({ onEntrar }) {
  const [comConta, setComConta] = useState(false);
  if (comConta) return <Login onEntrar={onEntrar} />;
  return (
    <div className="ls ls-login">
      <img src="/lista-icons/lista-192.png" alt="" width="72" height="72" />
      <h1>{t('lista.loginTitulo')}</h1>
      <p>{t('lista.semAcesso')}</p>
      <button className="ls-link" onClick={() => setComConta(true)}>{t('lista.entrarComConta')}</button>
    </div>
  );
}

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

/* ── "Quem está usando?" (estilo Netflix) ─────────────────────────────────── */
function EscolherMembro({ perfis, corDe, onEscolher }) {
  return (
    <div className="ls ls-quem">
      <h1>{t('lista.quem')}</h1>
      <div className="ls-quem-grelha">
        {perfis.map((p) => (
          <button key={p.id} className="ls-quem-perfil" onClick={() => onEscolher(p.nome)}>
            <span className="ls-quem-avatar" style={{ background: corDe(p.nome) }}>{String(p.nome).trim().charAt(0).toUpperCase()}</span>
            <span className="ls-quem-nome">{p.nome}</span>
          </button>
        ))}
      </div>
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
// DESLIZAR PARA APAGAR (dono 2026-10-16): arrastar o item para a ESQUERDA revela o fundo vermelho;
// passado o limite (25% da largura, mín. 80 px) o item sai (com Desfazer). Eventos de ponteiro +
// `touch-action: pan-y`: o deslize vertical continua a ser scroll; só o horizontal é nosso.
function useDeslizarApagar(onApagar) {
  const [dx, setDx] = useState(0);
  const [aArrastar, setAArrastar] = useState(false);
  const g = useRef({ x0: 0, y0: 0, ativo: false, horiz: false, larg: 300, arrastou: false });
  const onPointerDown = (e) => {
    if (e.target.closest('.ls-stepper')) return; // os botões −/+ não iniciam o gesto
    g.current = { x0: e.clientX, y0: e.clientY, ativo: true, horiz: false, larg: e.currentTarget.offsetWidth || 300, arrastou: false };
  };
  const onPointerMove = (e) => {
    const r = g.current; if (!r.ativo) return;
    const ddx = e.clientX - r.x0, ddy = e.clientY - r.y0;
    if (!r.horiz) {
      if (Math.abs(ddy) > 10 && Math.abs(ddy) > Math.abs(ddx)) { r.ativo = false; return; } // é scroll
      if (Math.abs(ddx) > 10 && Math.abs(ddx) > Math.abs(ddy)) { r.horiz = true; setAArrastar(true); e.currentTarget.setPointerCapture?.(e.pointerId); }
    }
    if (r.horiz) { r.arrastou = true; setDx(Math.min(0, ddx)); }
  };
  const fim = () => {
    const r = g.current; if (!r.ativo) return; r.ativo = false; setAArrastar(false);
    if (r.horiz && -dxRef.current > Math.max(80, r.larg * 0.25)) { setDx(-r.larg); setTimeout(onApagar, 160); }
    else setDx(0);
  };
  const dxRef = useRef(0); dxRef.current = dx;
  // depois de um arrasto, o "click" que o browser dispara não pode riscar o item
  const engolirClique = (e) => { if (g.current.arrastou) { e.preventDefault(); e.stopPropagation(); g.current.arrastou = false; } };
  return { dx, aArrastar, handlers: { onPointerDown, onPointerMove, onPointerUp: fim, onPointerCancel: fim, onClickCapture: engolirClique } };
}

function Item({ it, onMarcar, onMais, onMenos, onApagar, corDe }) {
  const noCarrinho = it.estado === 'carrinho';
  const { dx, aArrastar, handlers } = useDeslizarApagar(() => onApagar(it));
  const sub = noCarrinho ? null : [it.marca && limparMarca(it.marca), fmtTamanho(it.tamanho), precoLista(it)].filter(Boolean).join(' · ');
  return (
    <li className={`ls-item ${noCarrinho ? 'feito' : ''} ${it.pendente ? 'pendente' : ''} ${dx ? 'a-deslizar' : ''}`}
      style={{ '--cor-quem': corDe(it.adicionado_por), '--cor-risco': corDe(it.marcado_por) }} {...handlers}>
      <span className="ls-apagar-fundo" aria-hidden="true"><Ico d={ICO.lixo} size={20} /></span>
      <span className="ls-item-conteudo" style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: aArrastar ? 'none' : 'transform .18s' }}>
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
      </span>
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
  if (!sessao) return <SemAcesso onEntrar={setSessao} />;
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
  // painel de sugestões aberto pelo "+" SEM teclado (dono 2026-10-16: o teclado tapava o ecrã)
  const [painel, setPainel] = useState(false);
  const entradaRef = useRef(null);
  const etag = useRef(null);
  const filaRef = useRef(fila); filaRef.current = fila;
  const enviando = useRef(false);
  const remapRef = useRef(ler(K_REMAP, {}));
  const gravador = useRef(null);
  const [perfis, setPerfis] = useState([]);
  useEffect(() => { listarPerfis().then((ps) => setPerfis(ps || [])).catch(() => {}); }, []);
  const corMembro = useMemo(() => {
    const m = new Map();
    [...perfis].sort((a, b) => a.id - b.id).forEach((p, i) => m.set(semAc(p.nome), CORES_MEMBRO[i % CORES_MEMBRO.length]));
    return m;
  }, [perfis]);
  const corDe = useCallback((nome) => corMembro.get(semAc(nome)) || undefined, [corMembro]); // sem membro → CSS cai no acento
  // pessoa escolhida neste telemóvel ("Quem está usando?"); sem escolha → pergunta ao abrir
  const [membro, setMembro] = useState(() => membroGuardado());
  const escolherMembro = (nome) => { guardarMembro(nome); setMembro(nome); etag.current = null; };
  const quem = membro || meuMembro(sessao, perfis) || sessao?.nome || sessao?.email || null;

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
          if (e?.message === '401') { onSair(); return; }
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
      if (e?.message === '401') onSair(); else setOnline(false);
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
    removerItem(it); // "−" no mínimo = tirar da lista
  }
  // tirar da lista com Desfazer — usado pelo "−" no mínimo e pelo deslizar para apagar
  function removerItem(it) {
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
    // MAIS COMPRADOS À FRENTE (dono 2026-10-16): os habituais vêm do servidor já ordenados por vezes
    // (talões + listas). Os que "estão na altura" (cadência) ficam MARCADOS no seu lugar, com a qtd
    // habitual; se algum não estiver nos habituais, entra no fim.
    const porCad = new Map(cad.map((c) => [k(c.nome), c]));
    const out = []; const vistos = new Set();
    const juntar1 = (nome, extra = {}) => {
      const kk = k(nome); if (!kk || naLista.has(kk) || vistos.has(kk)) return;
      vistos.add(kk); const c = porCad.get(kk);
      out.push({ nome, quantidade: c?.quantidade || 1, cad: !!c, ...extra });
    };
    for (const h of hab) juntar1(h.produto);
    for (const c of cad) juntar1(c.nome);
    return out.slice(0, 30);
  }, [cad, hab, itens]);

  if (perfis.length > 1 && !(membro && perfis.some((p) => semAc(p.nome) === semAc(membro)))) {
    return <EscolherMembro perfis={[...perfis].sort((x, y) => x.id - y.id)} corDe={corDe} onEscolher={escolherMembro} />;
  }
  const mostrarSugestoes = !texto && talvez.length > 0 && (painel || foco || !itens.length);
  const alternarPainel = () => { entradaRef.current?.blur(); setPainel((v) => !v); };
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
              {perfis.length > 1 && <button onClick={() => { setMenu(false); escolherMembro(null); }}>{t('lista.trocarPessoa')}</button>}
              {sessao?.via !== 'lista' && <button onClick={onSair}>{t('lista.sair')}</button>} {/* com o link da casa não há 'sair' */}
              {perfis.length > 1 && (
                <div className="ls-legenda">
                  {[...perfis].sort((x, y) => x.id - y.id).map((p) => <span key={p.id}><i style={{ background: corDe(p.nome) }} />{p.nome}</span>)}
                </div>
              )}
            </div>
          </>
        )}
      </header>

      {(!online || fila.length > 0) && (
        <div className="ls-estado">{!online ? t('lista.offline') : t('lista.pendentes', { n: fila.length })}</div>
      )}

      <main className="ls-corpo" onPointerDown={() => painel && setPainel(false)}>
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
            <ul>{g.itens.map((it) => <Item key={it.id} it={it} onMarcar={marcar} onMais={mais} onMenos={menos} onApagar={removerItem} corDe={corDe} />)}</ul>
          </section>
        ))}
        {carrinho.length > 0 && (
          <section className="ls-seccao ls-carrinho">
            <h2>{t('lista.carrinho', { n: carrinho.length })}</h2>
            <ul>{carrinho.map((it) => <Item key={it.id} it={it} onMarcar={marcar} onMais={mais} onMenos={menos} onApagar={removerItem} corDe={corDe} />)}</ul>
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
          <button type="button" className={`ls-icone ls-mais ${painel ? 'aberto' : ''}`} onClick={alternarPainel}
            aria-expanded={painel} aria-label={t('lista.talvez')}><Ico d={ICO.plus} /></button>
          <input ref={entradaRef} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={t('lista.placeholder')}
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

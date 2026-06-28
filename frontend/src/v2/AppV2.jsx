// ──────────────────────────────────────────────────────────────────────────
// BigBag v2 — app com o design "cartoon" do handoff, ligado aos dados reais.
// MESMAS funções da v1 (reusa ../api.js), DESIGN novo (./cartoon.css, ./icons.js,
// ./brand.js). Router próprio (tela + pilha de voltar). A v1 (App.jsx) fica intacta.
// NOTA (fase protótipo): copy PT-BR embutido como no handoff; passar por i18n depois.
// ──────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { norm as normCat, singularizar, grupoDeNome, seccaoLista } from '../../../backend/src/normaliza/categoria.js';
import {
  verificarSessao, setAuth, clearAuth, enviarFatura,
  obterLista, atualizarListaItem, listarNotas, listarJobsNota, repetirLeitura, detalhesNota, resumoGastos, gastosCategoria, listarDespensa, removerDespensa,
  listarHistoricoProduto, registarHistoricoProduto, infoProduto, analiseProduto,
  avaliacaoPersonalizada, alternativasProduto, compararProdutos, consultarProdutoNome, consultarProdutoEan,
  listarPerfis, ativarPerfil, carregarPerfil, salvarSaude, matchFoto, vozParaProduto, buscarProduto, identificarProduto,
  adicionarListaItem, adicionarListaLote, vozParaLista, removerListaItem, autocompleteProduto,
  adotarPorNome, definirPais, sugestoesLista, refeicoesLista, carregarHabituais, variantesLista,
  sugerirReceitas, avaliarReceita, receitasGostei,
  importarReceitaUrl, listarReceitasImportadas, apagarReceitaImportada,
  buscarMedicamento, infoMedicamento, precosAoVivo, explicacaoMedicamento,
  catalogoMedicamento, sugestaoMonitor, criarMonitor,
} from '../api.js';
import { lerCodigoBarras } from '../leitorCodigo.js';
import { fichaLocal, sincronizarFichasBulk, registarHitLocal } from '../baseLocal.js';
import { limparMarca, nomeTalao, formatoProduto, agregarItensTalao } from '../produtoDisplay.js';
import { ICON } from './icons.js';
import { BIGBAG_MARK } from './brand.js';
import { oidcLogin, oidcLogout, oidcUser } from '../auth/oidc.js';
import './cartoon.css';

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

/* ── helpers ─────────────────────────────────────────────────────────────── */
const Ico = ({ name, size = 24, stroke, color, fill }) =>
  <span style={{ display: 'inline-grid' }} dangerouslySetInnerHTML={{ __html: ICON(name, { size, stroke, color, fill }) }} />;
const Mk = ({ size = 30, chip }) =>
  <span style={{ display: 'inline-grid' }} dangerouslySetInnerHTML={{ __html: BIGBAG_MARK({ size, chip }) }} />;
// Moeda do utilizador (camada locale): definida no load da sessão (/api/me). `eur`
// mantém o nome por compatibilidade mas formata na moeda corrente (PT €, BR R$).
let MOEDA = 'EUR';
const setMoeda = (m) => { if (m) MOEDA = m; };
const fmtPreco = (v, moeda = MOEDA) => {
  if (v == null || Number.isNaN(Number(v))) return '—';
  // ponto de milhar + vírgula decimal (R$ 2.234,99 / 2.234,99 €) — pt-BR e pt-PT partilham a convenção
  const s = Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moeda === 'BRL' ? `R$ ${s}` : `${s} €`;
};
const eur = (v) => fmtPreco(v);
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function dataCurta(s) {
  if (!s) return '';
  const d = new Date(s); if (Number.isNaN(d.getTime())) return String(s).slice(0, 10);
  const a = new Date(d); a.setHours(0, 0, 0, 0); const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dias = Math.round((hoje - a) / 86400000);
  if (dias === 0) return 'Hoje'; if (dias === 1) return 'Ontem';
  return `${d.getDate()} ${MES[d.getMonth()]}`;
}
const inicial = (s) => (String(s || '?').trim()[0] || '?').toUpperCase();
const lojaCor = (nome) => { const n = String(nome || '').toLowerCase();
  if (n.includes('continente')) return ['#e2231a', 'CO']; if (n.includes('pingo')) return ['#0a8a3f', 'PD'];
  if (n.includes('lidl')) return ['#0050aa', 'LI']; if (n.includes('aldi')) return ['#1f3a93', 'AL'];
  if (n.includes('minipre')) return ['#e94e1b', 'MP']; if (n.includes('auchan')) return ['#e2231a', 'AU'];
  return ['#67b2c9', (nome || '?').slice(0, 2).toUpperCase()]; };
// grupo (lente de loja) → rótulo de secção cartoon
const SEC_LABEL = { frutas: 'Frutas e vegetais', carne: 'Talho e charcutaria', peixe: 'Peixe e marisco',
  lacticinios: 'Laticínios e ovos', padaria: 'Padaria', congelados: 'Congelados', bebidas: 'Bebidas',
  doces: 'Doces e snacks', mercearia: 'Mercearia', higiene: 'Higiene e limpeza', outros: 'Outros' };
const secDe = (it) => SEC_LABEL[it.grupo] || 'Outros';
const SEC_ORDER = ['Frutas e vegetais', 'Talho e charcutaria', 'Peixe e marisco', 'Padaria', 'Laticínios e ovos', 'Congelados', 'Mercearia', 'Bebidas', 'Doces e snacks', 'Higiene e limpeza', 'Outros'];
const ordSec = (s) => { const i = SEC_ORDER.indexOf(s); return i < 0 ? 99 : i; };
// DESPENSA: classificação MAIS FINA que a lista. A lista quer corredores grossos (guiar no mercado);
// a despensa é o inventário de casa → detalha. seccaoLista divide a mercearia em CONDIMENTOS (azeites/
// molhos/sal/temperos) e CAFÉ-CHÁ, e separa a CHARCUTARIA — secções próprias com rótulo e ordem.
const SEC_LABEL_DET = {
  frutas: 'Frutas e vegetais', carne: 'Talho', charcutaria: 'Charcutaria', peixe: 'Peixe e marisco',
  laticinios: 'Laticínios e ovos', padaria: 'Padaria', congelados: 'Congelados',
  massas: 'Massas', arroz: 'Arroz', farinhas: 'Farinhas e amidos', cereais: 'Cereais e aveia',
  leguminosas: 'Leguminosas', conservas: 'Conservas e enlatados', frutos_secos: 'Frutos secos e desidratados',
  azeites_oleos: 'Azeites e óleos', molhos: 'Molhos', temperos: 'Sal, temperos e especiarias',
  cafe_cha: 'Café, chá e infusões', doces: 'Doces e snacks', bebidas: 'Bebidas', higiene: 'Higiene e limpeza',
  mercearia: 'Mercearia', condimentos: 'Molhos, azeites e temperos', outros: 'Outros', // fallback (não-LLM)
};
const SEC_ORDER_DET = ['frutas', 'carne', 'charcutaria', 'peixe', 'laticinios', 'padaria', 'congelados',
  'massas', 'arroz', 'farinhas', 'cereais', 'leguminosas', 'conservas', 'frutos_secos', 'mercearia',
  'azeites_oleos', 'molhos', 'temperos', 'condimentos', 'cafe_cha', 'doces', 'bebidas', 'higiene', 'outros'];
const secDetId = (it) => it.seccao || seccaoLista(it.grupo || grupoDeNome(it.nome), it.nome); // it.seccao = secção canónica (LLM)
function agruparDespensa(itens) {
  const ord = [...itens].sort((a, b) => ((SEC_ORDER_DET.indexOf(secDetId(a)) + 1) || 99) - ((SEC_ORDER_DET.indexOf(secDetId(b)) + 1) || 99));
  const grupos = []; let last = null;
  ord.forEach((it) => { const id = secDetId(it); if (!last || last.id !== id) { last = { id, s: SEC_LABEL_DET[id] || 'Outros', itens: [] }; grupos.push(last); } last.itens.push(it); });
  return grupos;
}
// agrupa itens por secção, ordenando por SEC_ORDER (cada cabeçalho aparece 1×)
function agruparSec(itens) {
  const ord = [...itens].sort((a, b) => ordSec(secDe(a)) - ordSec(secDe(b)));
  const grupos = []; let last = null;
  ord.forEach((it) => { const s = secDe(it); if (!last || last.s !== s) { last = { s, itens: [] }; grupos.push(last); } last.itens.push(it); });
  return grupos;
}

const MOTIF = `<svg class="bg-motif" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice"><defs>
  <g id="lf"><path d="M0 0C-10 6-13 18-8 27 1 18 10 9 9 -3 5 -2 1 -1 0 0Z" fill="#d6e6bf"/></g>
  <g id="dr"><path d="M0 -8c5 7 7 10 7 13a7 7 0 1 1-14 0c0-3 2-6 7-13Z" fill="#cfe3e0"/></g></defs>
  <use href="#lf" x="34" y="150"/><use href="#dr" x="356" y="170"/><use href="#lf" x="366" y="360" transform="rotate(40 366 360)"/>
  <use href="#dr" x="24" y="380"/><use href="#lf" x="30" y="600" transform="rotate(-30 30 600)"/><use href="#dr" x="360" y="560"/><use href="#lf" x="352" y="730"/></svg>`;
const Motif = () => <span dangerouslySetInnerHTML={{ __html: MOTIF }} />;

function Ctop({ title, sub, back, amber, av, action, onBack, onAv }) {
  return (
    <div className="ctop">
      {back ? <button className="bk" onClick={onBack} aria-label="Voltar"><Ico name="back" size={24} stroke={2.2} /></button>
        : <span className={`mk ${amber ? 'amber' : ''}`}><Mk size={30} /></span>}
      <div className="hi"><b dangerouslySetInnerHTML={{ __html: title }} />{sub && <span dangerouslySetInnerHTML={{ __html: sub }} />}</div>
      {action}
      {av && <span className="av" onClick={onAv}>{av}</span>}
    </div>
  );
}
function Nav({ cur, go, cmpCheio, onLimite, onScan, scanTitle }) {
  const tabs = [['home', 'Início', 'home'], ['list', 'Lista', 'lista'], ['history', 'Histórico', 'historico'], ['user', 'Perfil', 'perfil']];
  const Tab = ([ic, lb, id]) => (
    <button key={id} className={`nb ${cur === id ? 'on' : ''}`} onClick={() => go(id)}>
      <span className="ni"><Ico name={ic} size={23} stroke={2} /></span>{lb}
    </button>
  );
  const aoScan = () => {
    if (onScan) { onScan(); return; } // override por tela (ex.: Minhas compras → ler talão)
    if (cur === 'comparar') { if (cmpCheio) { onLimite?.(); return; } go('scanner', { paraComparar: true }); return; }
    go('scanner', { k: Date.now() }); // k muda a cada toque → o Scanner volta ao modo CÓDIGO mesmo já estando aberto
  };
  return (
    <div className="cnav">
      {tabs.slice(0, 2).map(Tab)}
      <button className="nb-scan" title={scanTitle || (cur === 'comparar' ? 'Escanear para comparar' : 'Consultar produto')} onClick={aoScan}><Ico name="scan" size={28} stroke={2.4} color="#5a4410" /></button>
      {tabs.slice(2).map(Tab)}
    </div>
  );
}

/* ── auth ────────────────────────────────────────────────────────────────── */
export default function AppV2() {
  const [sessao, setSessao] = useState(undefined);
  useEffect(() => {
    verificarSessao().then((s) => { setMoeda(s?.user?.moeda); setSessao(s); }).catch((e) => setSessao(String(e?.message) === '403' ? { semAcesso: true } : null));
  }, []);
  // sair: limpa o test-auth e, se houver sessão OIDC, encerra-a no Zitadel (SSO).
  const sair = async () => { clearAuth(); if (await oidcUser()) oidcLogout(); else { setSessao(null); window.location.replace('/'); } };
  if (sessao === undefined) return <div className="v2"><div className="v2-load">…</div></div>;
  if (sessao?.semAcesso) return <SemAcesso onSair={sair} />;
  if (!sessao) return <LoginV2 onEntrar={setSessao} />;
  // nome legível: o `nome` das claims OIDC (given_name do Google); senão o local-part do email
  // capitalizado (nunca o email inteiro com @domínio).
  const nome = sessao.user?.nome || (sessao.user?.id || '').split('@')[0].replace(/^./, (c) => c.toUpperCase());
  return <Shell nome={nome} onSair={sair} pais={sessao.user?.pais || 'PT'} />;
}

// Superfície PÚBLICA "BigBag Remédios" (rota /remedios) — utilidade pública, SEM
// login: qualquer pessoa consulta o preço de um remédio nas farmácias do Brasil.
// Reusa a tela Remedios (standalone); os endpoints /api/medicamento/* são públicos.
export function RemediosApp() {
  useEffect(() => { setMoeda('BRL'); }, []); // BR → preços em R$
  return <div className="v2 v2-rx"><Motif /><Remedios standalone /></div>;
}

// Autenticado no IdP mas o email não está na allowlist do BigBag (camada 2).
function SemAcesso({ onSair }) {
  return (
    <div className="v2"><Motif />
      <div className="v2-login">
        <Mk size={64} /><h1>BigBag</h1>
        <p style={{ color: 'var(--ink-2)', font: '500 14px/1.5 var(--font)', textAlign: 'center', margin: '4px 10px 14px' }}>
          A tua conta entrou, mas <b>ainda não tem acesso ao BigBag</b>. Fala com o administrador para te adicionarem.
        </p>
        <button className="cbtn cbtn-leaf" style={{ width: '100%' }} onClick={onSair}>Sair / trocar de conta</button>
      </div>
    </div>
  );
}

function LoginV2({ onEntrar }) {
  const [user, setUser] = useState(''); const [pass, setPass] = useState('');
  const [erro, setErro] = useState(''); const [aEntrar, setAEntrar] = useState(false);
  const [teste, setTeste] = useState(false);
  async function submeter(e) {
    e.preventDefault(); setErro(''); setAEntrar(true); setAuth(user.trim(), pass);
    try { onEntrar(await verificarSessao()); } catch { clearAuth(); setErro('Usuário ou senha inválidos.'); } finally { setAEntrar(false); }
  }
  return (
    <div className="v2"><Motif />
      <div className="v2-login">
        <Mk size={64} /><h1>BigBag</h1><div className="ver">v{APP_VERSION}</div>
        <button className="cbtn cbtn-leaf" style={{ width: '100%' }} onClick={() => oidcLogin()}>Entrar</button>
        <button onClick={() => setTeste((v) => !v)} style={{ background: 0, border: 0, color: 'var(--ink-3)', font: '600 12px var(--font)', marginTop: 12, cursor: 'pointer' }}>acesso de teste</button>
        {teste && (
          <form onSubmit={submeter} style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', marginTop: 4 }}>
            <input placeholder="Usuário" value={user} onChange={(e) => setUser(e.target.value)} autoCapitalize="none" />
            <input placeholder="Senha" type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
            {erro && <div className="v2-err">{erro}</div>}
            <button className="cbtn cbtn-leaf" disabled={aEntrar || !user || !pass}>{aEntrar ? '…' : 'Entrar (teste)'}</button>
          </form>
        )}
      </div>
    </div>
  );
}

/* ── shell + router ──────────────────────────────────────────────────────── */
// Talão partilhado (Share Target/Android): o SW guardou o ficheiro nesta cache
// antes de reencaminhar para /?compartilhado=1. Lê-o uma vez e apaga-o. (Mesma
// mecânica da v1 — replicada aqui porque a v1 está congelada e a v2 é o default.)
async function lerTalaoPartilhado() {
  try {
    if (!('caches' in window)) return null;
    const cache = await caches.open('bigbag-partilha');
    const res = await cache.match('/__talao_partilhado');
    if (!res) return null;
    const blob = await res.blob();
    const nome = decodeURIComponent(res.headers.get('X-Nome') || 'talao');
    await cache.delete('/__talao_partilhado');
    return new File([blob], nome, { type: blob.type || 'image/jpeg' });
  } catch { return null; }
}
// Menu do avatar (topo do Início): seletor de país (PT/BR) + sair do app. Mudar o país
// persiste (/api/me/pais) e RECARREGA a app — re-busca tudo na nova moeda/locale.
const PAISES = [['PT', '🇵🇹', 'Portugal', '€'], ['BR', '🇧🇷', 'Brasil', 'R$']];
function MenuConta({ user, pais, onFechar, onSair }) {
  const [aMudar, setAMudar] = useState(null);
  const mudar = async (p) => {
    if (p === pais || aMudar) return; setAMudar(p);
    try { await definirPais(p); window.location.reload(); } catch { setAMudar(null); }
  };
  return (
    <div className="conta-bg" onClick={onFechar}>
      <div className="conta" onClick={(e) => e.stopPropagation()}>
        <div className="conta-h"><span className="conta-av">{inicial(user)}</span><b>{user}</b></div>
        <div className="conta-cap">País</div>
        <div className="conta-paises">
          {PAISES.map(([p, fl, nm, mo]) => (
            <button key={p} className={`conta-pais ${p === pais ? 'on' : ''}`} disabled={!!aMudar} onClick={() => mudar(p)}>
              <span className="conta-fl">{fl}</span><span className="conta-pn">{nm}<span className="conta-mo"> · {mo}</span></span>
              {aMudar === p ? <span className="conta-sp">…</span> : p === pais ? <Ico name="check" size={17} color="var(--leaf-d)" /> : null}
            </button>
          ))}
        </div>
        <div style={{ textAlign: 'center', font: '600 12px var(--font)', color: 'var(--ink-3)', margin: '6px 0 10px' }}>BigBag · versão {APP_VERSION}</div>
        <button className="conta-sair" onClick={onSair}><Ico name="logout" size={17} /> Sair do app</button>
      </div>
    </div>
  );
}
const TABS = new Set(['home', 'lista', 'historico', 'perfil']);
function Shell({ nome, onSair, pais }) {
  const [view, setView] = useState({ id: 'home', p: {} });
  const stack = useRef([]);
  // CESTO DE COMPARAÇÃO (vive no Shell → persiste no vai-e-volta do scan). Limpa-se ao
  // entrar numa ABA principal → a tela Comparar "começa limpa" a cada entrada deliberada,
  // e enche-se com SCANS (≠ Histórico, que mostra o já-consultado).
  const [cmp, setCmp] = useState([]); // [{ ean, nome }]
  const [conta, setConta] = useState(false); // menu do avatar (país + sair)
  const addCmp = useCallback((it) => setCmp((c) => (it?.ean && !c.some((x) => String(x.ean) === String(it.ean)) && c.length < 4) ? [...c, { ean: String(it.ean), nome: it.nome || null }] : c), []);
  const removeCmp = useCallback((ean) => setCmp((c) => c.filter((x) => String(x.ean) !== String(ean))), []);
  const clearCmp = useCallback(() => setCmp([]), []);
  const [aviso, setAviso] = useState(''); // toast curto (ex.: limite do comparador)
  // a tela "Minhas compras" regista aqui a sua ação de LER TALÃO → a régua dispara-a pelo scan central.
  const scanNotas = useRef(null);
  useEffect(() => { if (!aviso) return undefined; const t = setTimeout(() => setAviso(''), 3800); return () => clearTimeout(t); }, [aviso]);
  // BASE LOCAL: pré-carrega as fichas (identificação+nutrição de ~63k EANs PT+Mercadona-ES)
  // para o scan responder instantâneo/offline. Fire-and-forget, auto-limitada a 1x/hora.
  useEffect(() => { sincronizarFichasBulk(); }, []);
  const go = useCallback((id, p = {}, opts = {}) => {
    if (TABS.has(id)) setCmp([]); // aba principal → a comparação recomeça limpa
    setView((cur) => {
      if (TABS.has(id)) stack.current = [];
      else if (!opts.replace && cur.id !== id) stack.current.push(cur); // replace: não empilha (substitui a tela atual)
      return { id, p };
    });
  }, []);
  const back = useCallback(() => {
    setView(() => stack.current.pop() || { id: 'home', p: {} });
  }, []);
  // Share Target: se viemos de /?compartilhado=1, lê o ficheiro guardado pelo SW
  // e abre as Compras a enviá-lo (a v1 fazia isto; sem isto a partilha some).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (!sp.has('compartilhado')) return;
    const tipo = sp.get('compartilhado'); const link = sp.get('link');
    window.history.replaceState(null, '', '/');
    if (tipo === 'receita' && link) { _linkPartilhado = link; go('receitas'); return; } // link de receita partilhado
    (async () => { const file = await lerTalaoPartilhado(); if (file) go('notas', { partilhado: file }); })();
  }, [go]);
  // a Comparar mostra a nav (para consultar mais itens pelo botão central) sem ser um TAB
  // que limpa a pilha — entra empilhada, o back volta de onde veio; nenhum tab fica aceso.
  // a ficha (informação do produto) também leva a barra inferior — `cur` não casa nenhuma aba
  // (nada destacado), o scan central vira "consultar produto". cnav é flex (não tapa o conteúdo).
  // a régua aparece nos TABS, na comparar, na ficha E na CONSULTA por scan (modo default — não
  // nos fluxos de tarefa do scanner: identificar linha/adicionar à lista/comparar, que voltam).
  const consultaScan = view.id === 'scanner' && !view.p?.itemId && !view.p?.paraLista && !view.p?.paraComparar;
  // a régua aparece também nas "Minhas compras" (notas) — aí o scan central LÊ O TALÃO (≠ consultar produto).
  const navCur = TABS.has(view.id) ? view.id : (view.id === 'comparar' ? 'comparar' : (view.id === 'ficha' ? 'ficha' : (view.id === 'notas' ? 'notas' : (consultaScan ? 'scanner' : null))));
  const common = { go, back, user: nome, onSair, abrirConta: () => setConta(true), cmp, addCmp, removeCmp, clearCmp, scanNotas }; // `user` (não `nome`) p/ não colidir com o `nome` de produto nas params de tela
  const Screen = {
    home: Home, lista: Lista, historico: Historico, perfil: Perfil,
    notas: Notas, gastos: Gastos, gastoscat: GastosCat, ficha: Ficha, comparar: Comparar,
    texto: Texto, despensa: Despensa, recibo: Recibo, receitas: Receitas, perfilsaude: PerfilSaude,
    scanner: Scanner, voz: Voz,
  }[view.id] || Home;
  return (
    <div className="v2"><Motif />
      <Screen {...common} {...view.p} />
      {navCur && <Nav cur={navCur} go={go} cmpCheio={cmp.length >= 4}
        onScan={navCur === 'notas' ? () => scanNotas.current?.() : navCur === 'lista' ? () => go('scanner', { paraLista: true }) : null}
        scanTitle={navCur === 'notas' ? 'Ler talão' : navCur === 'lista' ? 'Ler código p/ a lista' : null}
        onLimite={() => setAviso('Já tem 4 produtos — o máximo para comparar aqui. Para comparar mais, use o Histórico.')} />}
      {conta && <MenuConta user={nome} pais={pais} onFechar={() => setConta(false)} onSair={onSair} />}
      {aviso && <div className="toast" role="status">{aviso}</div>}
    </div>
  );
}

/* ── INÍCIO ──────────────────────────────────────────────────────────────── */
function Home({ go, user, abrirConta }) {
  const [nLista, setNLista] = useState(null);
  const [notas, setNotas] = useState(null);
  useEffect(() => {
    obterLista().then((d) => setNLista((d.itens || []).filter((i) => i.estado !== 'carrinho').length)).catch(() => setNLista(null));
    listarNotas().then((n) => setNotas(n.slice(0, 2))).catch(() => setNotas([]));
  }, []);
  return (
    <>
      <Ctop title={`Olá, ${user}`} sub="vamos às compras?" av={inicial(user)} onAv={abrirConta} />
      <div className="scrollarea">
        <div className="herolist" onClick={() => go('lista')}>
          <span className="mkbig"><Mk size={110} /></span>
          <div className="k">A minha lista</div>
          <div className="v">{nLista == null ? '…' : `${nLista} ${nLista === 1 ? 'produto' : 'produtos'}`}</div>
          <div className="s">na sua lista de compras</div>
          <button className="go">Ver a lista →</button>
        </div>
        <div className="quick">
          {[['recipe', 'Receitas', () => { primeReceitas(); go('receitas'); }, 'var(--coral)'],
            ['compare', 'Comparar', () => go('comparar'), undefined],
            ['talao', 'Despensa', () => go('despensa'), 'var(--amber-d)'],
            ['chart', 'Gastos', () => go('gastos'), '#3b86c4']].map(([ic, lb, on, col]) => (
            <button key={lb} className="round-act" onClick={on}>
              <span className="circ" style={col ? { color: col } : undefined}><Ico name={ic} size={24} stroke={2} /></span><b>{lb}</b>
            </button>
          ))}
        </div>
        {/* entrada CLARA para registar um talão (foto OU PDF) — reusa o fluxo de processamento das Compras */}
        <label className="talao-cta">
          <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) go('notas', { partilhado: f }); }} />
          <span className="talao-cta-ic"><Ico name="receipt" size={26} stroke={2} color="#7a5b12" /></span>
          <div className="talao-cta-tx"><b>Ler novo talão</b><span>fotografe a fatura da compra</span></div>
          <span className="talao-cta-go"><Ico name="camera" size={20} color="var(--amber-d)" /></span>
        </label>
        <div className="clabel-row"><span className="clabel">Comprado há pouco</span><button className="seeall" onClick={() => go('notas')}>Ver tudo →</button></div>
        {notas == null ? <p className="empty">…</p> : notas.length === 0 ? <p className="empty">Sem compras ainda.</p>
          : notas.map((n) => { const [c, ini] = lojaCor(n.loja || n.mercado); return (
            <div className="frow" key={n.id} onClick={() => go('recibo', { id: n.id })}>
              <span className="fdot" style={{ background: c }}>{ini}</span>
              <div className="fb"><div className="fn">{n.loja || n.mercado || 'Compra'}</div><div className="fs">{dataCurta(n.data)}{n.n_itens ? ` · ${n.n_itens} itens` : ''}</div></div>
              <span className="fp">{eur(n.total)}</span>
            </div>); })}
      </div>
    </>
  );
}

/* ── PERFIL DE SAÚDE (editor de características) ──────────────────────────── */
// Os 6 grupos do editor ↔ campos do `resumo` (as ATIVAS são as que a avaliação lê).
// `nut` mapeia em `metas` (array novo), distinto do `nutrientes` (objeto) que o LLM extrai.
const GRUPOS_SAUDE = [
  { key: 'obj', campo: 'objetivos', t: 'Objetivos', gi: 'spark', c: 'var(--leaf)', s: 'var(--leaf-soft)', d: 'var(--leaf-d)' },
  { key: 'cond', campo: 'condicoes', t: 'Condições de saúde', gi: 'heart', c: '#d98a3c', s: 'var(--amber-soft)', d: 'var(--amber-d)' },
  { key: 'diet', campo: 'restricoes', t: 'Dieta & restrições', gi: 'leaf', c: 'var(--leaf)', s: 'var(--leaf-soft)', d: 'var(--leaf-d)' },
  { key: 'pref', campo: 'preferir', t: 'Preferir / incluir', gi: 'check', c: 'var(--leaf)', s: 'var(--leaf-soft)', d: 'var(--leaf-d)' },
  { key: 'evit', campo: 'evitar', t: 'Evitar', gi: 'close', c: 'var(--coral)', s: 'var(--coral-soft)', d: '#b4512f' },
  { key: 'nut', campo: 'metas', t: 'Metas de nutrientes', gi: 'spark', c: '#5b8fb0', s: '#dcebf2', d: '#3f6f90' },
  { key: 'sup', campo: 'suplementos', t: 'Suplementos', gi: 'plate', c: '#8a5fb0', s: '#ece3f5', d: '#6a449a' },
  { key: 'med', campo: 'medicacao', t: 'Medicação', gi: 'bell', c: '#3f9a8f', s: '#d9efe9', d: '#2f7268' },
  { key: 'ativ', campo: 'atividade_fisica', t: 'Atividade física', gi: 'spark', c: '#c2557a', s: '#f6e1ea', d: '#9c3f60' },
];
// Catálogo de sugestões por grupo (genérico, reutilizável) — alimenta a aba "Adicionar".
// Curado e neutro; o utilizador escolhe. Strings simples (= os arrays do resumo).
const CATALOGO_SAUDE = {
  obj: ['Perder gordura', 'Ganhar massa muscular', 'Reduzir colesterol (LDL)', 'Estabilizar a glicemia', 'Mais energia', 'Melhorar o sono', 'Reduzir inflamação', 'Mais saciedade', 'Saúde óssea', 'Saúde do coração'],
  cond: ['Hipertensão', 'Colesterol alto', 'Pré-diabetes', 'Diabetes', 'Resistência à insulina', 'Menopausa', 'Osteopenia', 'Refluxo', 'Saúde intestinal', 'Ácido úrico / gota'],
  diet: ['Mediterrânea', 'Baixo índice glicémico', 'Défice calórico', 'Low-carb', 'Sem glúten', 'Sem lactose', 'Vegetariana', 'Vegana', 'Jejum intermitente', 'Menos sal', 'Menos álcool'],
  pref: ['Peixe gordo', 'Proteína magra', 'Proteína vegetal', 'Legumes', 'Fruta de baixo IG', 'Leguminosas', 'Aveia / integrais', 'Azeite', 'Frutos secos', 'Iogurte sem açúcar'],
  evit: ['Açúcar adicionado', 'Ultraprocessados', 'Fritos', 'Enchidos', 'Refrigerantes', 'Pão branco / refinados', 'Gordura saturada em excesso', 'Carne vermelha em excesso', 'Adoçantes artificiais', 'Margarina'],
  nut: ['+ Proteína', '+ Fibra', '− Açúcares', '− Sódio', '− Gordura saturada', '+ Ómega-3', '+ Cálcio', '+ Vitamina D', '+ Magnésio', '+ Potássio', '+ Ferro'],
  sup: ['Ómega-3', 'Vitamina D', 'Vitamina B12', 'Magnésio', 'Cálcio', 'Ferro', 'Zinco', 'Multivitamínico', 'Probióticos', 'Psyllium / fibra', 'Whey / proteína', 'Creatina', 'Colagénio', 'Coenzima Q10'],
  med: ['Metformina', 'Ozempic / Mounjaro', 'Estatina', 'Anti-hipertensor', 'Levotiroxina', 'Insulina', 'Anticoagulante', 'Antidepressivo', 'Contracetivo', 'Anti-inflamatório'],
  ativ: ['Musculação', 'Corrida', 'Caminhada', 'Pilates', 'Yoga', 'Natação', 'Ciclismo', 'CrossFit', 'Treino 3-4x/semana', 'Sedentário'],
};

/* ── LISTA ───────────────────────────────────────────────────────────────── */
// Cor por MEMBRO (perfil): cada membro recebe uma cor estável da paleta (por ordem
// de id, suporta N membros). Sue→verde, Gustavo→azul nos 2 primeiros, como o spec.
const MEMBRO_CORES = ['#3f7a3f', '#5a6fb0', '#e0734f', '#c8851f', '#8a5fb0', '#3f9a8f'];
// Os 3 botões da barra ADICIONAM à lista (não consultam): voz (ditado→lote),
// escrever (nome direto, qualquer produto — não exige ficha nutricional), e
// código (scan→adiciona). Antes voz/texto caíam na CONSULTA e falhavam p/ não-alimentos.
// Subtítulo de preço de um item da lista. CORRIGIDO (2026-06-15): a v2 lia
// it.preco_estimado/it.preco (campos que o backend NUNCA define) → mostrava sempre
// "sem preço". O backend dá preco_mercado/melhor_preco (FACTO, €/base) e preco_ref
// (referência de catálogo). Mesma cadeia da v1.
// Rótulo legível de um peso/volume: qtd_medida vem sempre na unidade-base (kg/L); o display
// escolhe g/kg (ou ml/L) pela grandeza: <1 kg → "200 g", senão "1,2 kg".
function fmtMedida(qtd, unidade) {
  const n = Number(qtd) || 0;
  const v = (x) => String(x).replace('.', ',');
  if (unidade === 'kg') return n < 1 ? `${Math.round(n * 1000)} g` : `${v(Math.round(n * 1000) / 1000)} kg`;
  if (unidade === 'L') return n < 1 ? `${Math.round(n * 1000)} ml` : `${v(Math.round(n * 1000) / 1000)} L`;
  return `${v(n)} ${unidade || ''}`.trim();
}
// Formata um TAMANHO em texto para exibição, AGNÓSTICO à unidade de entrada (canónico "1000 g"/
// "250 ml", legado "0,25 kg"/"25 cl", ou já amigo "1 kg"): normaliza a peso(g)/volume(ml) e aplica
// ≥1000 g → kg, ≥1000 ml → L (dono). Idempotente.
function fmtTamanho(s) {
  if (!s) return s;
  const m = String(s).match(/^(\d+(?:[.,]\d+)?)\s*(kg|mg|gr|g|lt|l|dl|cl|ml|cc|un)$/i);
  if (!m) return s;
  const val = parseFloat(m[1].replace(',', '.')); const u = m[2].toLowerCase();
  const n = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000)).replace('.', ',');
  let g = null, ml = null;
  if (u === 'kg') g = val * 1000; else if (u === 'g' || u === 'gr') g = val; else if (u === 'mg') g = val / 1000;
  else if (u === 'l' || u === 'lt') ml = val * 1000; else if (u === 'dl') ml = val * 100; else if (u === 'cl') ml = val * 10; else if (u === 'ml' || u === 'cc') ml = val;
  else return `${Math.round(val)} un`;
  if (g != null) return g >= 1000 ? `${n(g / 1000)} kg` : `${n(g)} g`;
  return ml >= 1000 ? `${n(ml / 1000)} L` : `${n(ml)} ml`;
}

// Ovos contam-se por DÚZIA (convenção; produto popular — enriquecimento especial permitido). 1 pack = 1 dúzia.
// Exclui o que não é ovo-de-galinha à dúzia (chocolate/líquido/pó/codorniz/páscoa).
function ehOvoDuzia(nome) {
  const n = String(nome || '').toLowerCase();
  return /\bovos?\b/.test(n) && !/l[íi]quido|chocolate|p[áa]scoa|kinder|surpresa|\bp[óo]\b|codorn/.test(n);
}

function precoLista(it) {
  // OVOS → preço por DÚZIA (o pack é a dúzia): mostra o preço pago/de mercado por pack, rotulado /dúzia.
  if (ehOvoDuzia(it.nome)) { const p = it.preco_pago ?? it.melhor_preco ?? it.preco_mercado; return p != null ? `${eur(p)}/dúzia` : 'sem preço'; }
  // €/base (€/kg) SÓ para itens vendidos a PESO (it.unidade = modo peso). Tudo o resto — EAN, embalado, OU
  // um kg-genérico em PACOTE FIXO (rúcula "EMB.100GR") — mostra o PREÇO DO PACOTE pago (facto do talão),
  // nunca €/kg. O €/kg de um pacote de 100 g ("9,9/kg") era enganador; o utilizador compra o pacote.
  if (!it.unidade && it.preco_pago != null) return eur(it.preco_pago);
  const p = it.preco_mercado ?? it.melhor_preco;
  if (p != null) return `${eur(p)}${it.unidade_base ? `/${it.unidade_base}` : ''}`;
  if (it.preco_ref != null) return `~${eur(it.preco_ref)}`;
  return 'sem preço';
}

// Gesto SWIPE-PARA-APAGAR (arrasta p/ a direita > 90px → remove). PARTILHADO pela linha activa e pela
// do carrinho. Devolve dx (translação), g (ref do gesto, p/ o onClick saber se está a arrastar) e os
// handlers de toque para espalhar no card.
function useSwipeDelete(onRemover) {
  const [dx, setDx] = useState(0);
  const g = useRef({ x0: 0, y0: 0, horiz: false, mov: false, dx: 0 });
  const onTouchStart = (e) => { const t = e.touches[0]; g.current = { x0: t.clientX, y0: t.clientY, horiz: false, mov: true, dx: 0 }; };
  const onTouchMove = (e) => {
    const r = g.current; if (!r.mov) return;
    const t = e.touches[0]; const dX = t.clientX - r.x0; const dY = t.clientY - r.y0;
    if (!r.horiz && Math.abs(dX) > Math.abs(dY) + 6) r.horiz = true;
    if (r.horiz) { r.dx = Math.max(0, dX); setDx(r.dx); }
  };
  const onTouchEnd = () => { const r = g.current; r.mov = false; if (r.horiz && r.dx > 90) onRemover(); setDx(0); };
  return { dx, g, touch: { onTouchStart, onTouchMove, onTouchEnd } };
}

// Linha ACTIVA da lista (swipe-apagar + apanhar + qty + chips).
function ItemLista({ it, cor, onApanhar, onRemover, onDelta, onDeltaMedida, qtd, riscaCor, onLevar, onFormas, destaque, innerRef }) {
  const levar = it.qtd_habitual > 1 && (it.quantidade || 1) === 1 && !it.unidade; // qtd habitual (contagem; escondido a peso)
  const formas = it.variantes_n > 1; // variante habitual (sugestão falível) → atrás de seletor "N formas"
  const { dx, g, touch } = useSwipeDelete(() => onRemover(it));
  return (
    <div className="swrow" ref={innerRef}>
      <div className="swrow-bg"><Ico name="close" size={18} /></div>
      <div className={`item ${riscaCor ? 'risca' : ''} ${destaque ? 'novo' : ''}`} style={{ borderRight: `6px solid ${cor}`, transform: `translateX(${dx}px)`, transition: dx ? 'none' : 'transform .18s', '--risca-cor': riscaCor || 'transparent' }}
        {...touch}
        title={it.adicionado_por ? `adicionado por ${it.adicionado_por}` : undefined}>
        <div className="ib" onClick={() => { if (g.current.horiz || riscaCor) return; onApanhar(it, true); }}>
          <div className="iname">{nomeTalao(it.nome)}</div>
          <div className="isub">{[it.marca && limparMarca(it.marca), fmtTamanho(it.tamanho), precoLista(it)].filter(Boolean).join(' · ')}</div>
          {(levar || formas) && (
            <div className="ichips">
              {levar && <button className="ichip lv" onClick={(e) => { e.stopPropagation(); onLevar(it); }}><Ico name="plus" size={11} stroke={2.8} color="var(--leaf-d)" />levar {it.qtd_habitual}</button>}
              {formas && <button className="ichip fm" onClick={(e) => { e.stopPropagation(); onFormas(it); }}><Ico name="usual" size={11} stroke={2.2} color="var(--ink-2)" />{it.variantes_n} formas</button>}
            </div>
          )}
        </div>
        {riscaCor
          ? <span className="risca-tick"><Ico name="check" size={19} stroke={3} color="#fff" /></span>
          : it.unidade // item A PESO → stepper de peso (passo em kg/g); senão contagem inteira
            ? <div className="qty peso"><button onClick={() => onDeltaMedida(it, -1)}>−</button><span className="qn">{qtd(it)}</span><button onClick={() => onDeltaMedida(it, 1)}>+</button></div>
            : <div className="qty"><button onClick={() => onDelta(it, -1)}>−</button><span className="qn">{qtd(it)}</span><button onClick={() => onDelta(it, 1)}>+</button></div>}
      </div>
    </div>
  );
}

// Linha do CARRINHO (já apanhado): riscada, tocar des-marca (volta a ativo), ARRASTAR p/ a direita
// apaga (mesmo swipe da linha activa) — para tirar da lista algo que afinal não se vai levar.
function ItemCarrinho({ it, cor, riscoCor, onApanhar, onRemover, qtd }) {
  const { dx, g, touch } = useSwipeDelete(() => onRemover(it));
  return (
    <div className="swrow">
      <div className="swrow-bg"><Ico name="close" size={18} /></div>
      <div className="item done" style={{ borderRight: `6px solid ${cor}`, transform: `translateX(${dx}px)`, transition: dx ? 'none' : 'transform .18s' }}
        {...touch} onClick={() => { if (g.current.horiz) return; onApanhar(it, false); }}>
        <div className="ib">
          <div className="iname" style={{ textDecorationColor: riscoCor }}>{nomeTalao(it.nome)}</div>
          <span className="pickcart">{qtd(it)} · no carrinho de {it.marcado_por || '—'}</span>
        </div>
      </div>
    </div>
  );
}

function Lista({ go, back, destaque }) {
  const [itens, setItens] = useState(null);
  const [gravando, setGravando] = useState(false);
  const [proc, setProc] = useState(false);          // a processar a voz
  const [aviso, setAviso] = useState('');           // feedback "Adicionei: …"
  const [escrever, setEscrever] = useState(false);
  const [txt, setTxt] = useState('');
  const [sug, setSug] = useState([]);               // sugestões de autocomplete (genéricos primeiro)
  const sugTimer = useRef(null);
  const mrRef = useRef(null); const streamRef = useRef(null);
  // DESCOBERTA (restaurado da v1): sugestões "talvez esteja a acabar" (cadência, zero LLM),
  // receitas possíveis com a lista (LLM cacheado) e o catálogo de HABITUAIS (histórico da casa).
  const [sugCad, setSugCad] = useState([]);         // [{nome, quantidade, urgencia, ...}]
  const [refeicoes, setRefeicoes] = useState([]);   // [{nome, usa[], falta[]}]
  const [habituais, setHabituais] = useState([]);   // top compras da casa (idas DESC) — fundem-se na recomendação
  const [habAberto, setHabAberto] = useState(false);
  const [acabarFechado, setAcabarFechado] = useState(false); // X fecha o card "talvez a acabar"
  const [picando, setPicando] = useState({}); // {id: nomeDeQuemApanha} — risca-no-lugar em curso
  const [variantesItem, setVariantesItem] = useState(null); // item cujo seletor de variantes está aberto
  // DESTAQUE do item recém-incluído: o scan passa o EAN pela navegação (destaque prop); os adds na
  // tela marcam por nome. Ao carregar, achamos o item, fazemos scroll e damos um realce que esmaece.
  const [destaqueAlvo, setDestaqueAlvo] = useState(destaque ? { ean: String(destaque) } : null);
  const [destaqueId, setDestaqueId] = useState(null);
  const destRef = useRef(null);
  const carregar = useCallback(() => { obterLista().then((d) => setItens(d.itens || [])).catch(() => setItens([])); }, []);
  useEffect(() => { carregar(); }, [carregar]);
  // descoberta carrega ao abrir a tela (as receitas chegam quando chegarem — não bloqueia).
  const carregarDescoberta = useCallback(() => {
    sugestoesLista().then((s) => setSugCad(s || [])).catch(() => setSugCad([]));
    refeicoesLista().then((r) => setRefeicoes(r || [])).catch(() => setRefeicoes([]));
    carregarHabituais().then((h) => setHabituais(h || [])).catch(() => setHabituais([]));
  }, []);
  useEffect(() => { carregarDescoberta(); }, [carregarDescoberta]);
  useEffect(() => { // item recém-incluído chegou à lista → acha-o (por EAN ou nome), scroll + realce
    if (!destaqueAlvo || !itens?.length) return undefined;
    const alvo = itens.find((i) => (destaqueAlvo.ean && String(i.ean) === destaqueAlvo.ean)
      || (destaqueAlvo.nome && nomeTalao(i.nome).toLowerCase() === destaqueAlvo.nome));
    if (!alvo) return undefined;
    setDestaqueAlvo(null); setDestaqueId(alvo.id);
    requestAnimationFrame(() => destRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    const t = setTimeout(() => setDestaqueId(null), 2600);
    return () => clearTimeout(t);
  }, [itens, destaqueAlvo]);
  useEffect(() => () => { // limpeza: pára gravação/microfone ao sair
    try { if (mrRef.current?.state === 'recording') mrRef.current.stop(); } catch { /* noop */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);
  const ativos = (itens || []).filter((i) => i.estado !== 'carrinho');
  const total = ativos.reduce((a, b) => {
    if (b.unidade) { // item A PESO: €/base × peso (kg) — SÓ quando o preço é €/base (unidade_base presente)
      const base = Number(b.preco_mercado ?? b.melhor_preco);
      return Number.isFinite(base) && b.unidade_base ? a + base * (Number(b.qtd_medida) || 0) : a; // sem €/base → não inventa
    }
    // não-peso → PREÇO DO PACOTE pago (preco_pago) × quantidade; €/base só p/ peso (coerente c/ precoLista)
    return a + (Number(b.preco_pago ?? b.preco_mercado ?? b.melhor_preco ?? b.preco_ref) || 0) * (b.quantidade || 1);
  }, 0);
  async function delta(it, d) {
    setItens((xs) => xs.map((x) => (x.id === it.id ? { ...x, quantidade: Math.max(1, (x.quantidade || 1) + d) } : x)));
    try { await atualizarListaItem(it.id, { inc: d }); } catch { carregar(); }
  }
  async function deltaMedida(it, dir) { // stepper de PESO: passo de 500 g, alinhado à grelha de meio-quilo (mín. 500 g)
    const STEP = 0.5;
    const atual = Number(it.qtd_medida) || STEP;
    // sobe/desce para o próximo múltiplo de 500 g (limpa habituais "tortos": 1,377 → 1,5 ou 1,0)
    const nv = dir > 0
      ? (Math.floor(atual / STEP + 1e-9) + 1) * STEP
      : Math.max(STEP, (Math.ceil(atual / STEP - 1e-9) - 1) * STEP);
    const v = Math.round(nv * 1000) / 1000;
    setItens((xs) => xs.map((x) => (x.id === it.id ? { ...x, qtd_medida: v, medida_derivada: false } : x)));
    try { await atualizarListaItem(it.id, { qtd_medida: v, unidade: it.unidade || 'kg' }); } catch { carregar(); }
  }
  async function levar(it) { // chip "levar N": põe a quantidade habitual da casa num toque
    const q = Math.max(1, Number(it.qtd_habitual) || 1);
    setItens((xs) => xs.map((x) => (x.id === it.id ? { ...x, quantidade: q } : x)));
    try { await atualizarListaItem(it.id, { quantidade: q }); } catch { carregar(); }
  }
  async function escolherVariante(it, v) { // seletor "N formas": concretiza o item na variante escolhida
    setVariantesItem(null);
    setItens((xs) => xs.map((x) => (x.id === it.id ? { ...x, nome: v.nome } : x)));
    try { await atualizarListaItem(it.id, { nome: v.nome }); } catch { /* outbox */ } carregar();
  }
  async function remover(it) { // swipe-para-apagar (otimista; reverte se falhar)
    setItens((xs) => xs.filter((x) => x.id !== it.id));
    try { await removerListaItem(it.id); } catch { carregar(); }
  }
  // VOZ → LISTA: grava, transcreve para itens (vozParaLista) e adiciona — SEM "Adicionei…" e
  // SEM espera: assim que a transcrição volta, os itens aparecem JÁ (otimista, secção pelo nome
  // no cliente) e reconciliam em fundo com a lista RESOLVIDA que o /lote devolve (uma só ida ao
  // servidor a seguir — antes fazia adicionarListaLote + carregar, dois resolverItensLista).
  async function alternarVoz() {
    if (gravando) { mrRef.current?.stop(); return; }
    setAviso('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream); const pedacos = [];
      mr.ondataavailable = (e) => { if (e.data.size) pedacos.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop()); setGravando(false); setProc(true);
        try {
          const { produtos } = await vozParaLista(new Blob(pedacos, { type: mr.mimeType || 'audio/webm' }));
          setProc(false);
          if (!produtos?.length) { setAviso('Não percebi. Toque no micro e tente de novo.'); return; }
          // OTIMISTA: mostra os itens ditados já (sem preço/marca ainda; secção pelo nome).
          const base = -Date.now();
          setItens((xs) => [
            ...produtos.map((p, i) => ({ id: base - i, nome: p.nome, quantidade: p.quantidade || 1, estado: 'ativo', adicionado_por: ativoNome, grupo: grupoDeNome(p.nome), _otimista: true })),
            ...(xs || []),
          ]);
          try { const r = await adicionarListaLote(produtos); if (r?.itens) setItens(r.itens); else carregar(); }
          catch { carregar(); } // falhou a gravar → repõe o estado real do servidor
        } catch { setProc(false); setAviso('Falha ao ouvir. Tente de novo.'); }
      };
      mrRef.current = mr; mr.start(); setGravando(true);
    } catch { setAviso('Sem acesso ao microfone — verifique a permissão.'); }
  }
  // TEXTO → LISTA: adiciona o nome tal e qual (qualquer produto, food ou não).
  function onTxt(v) { // digitar → autocomplete (debounce 150ms)
    setTxt(v); setAviso('');
    clearTimeout(sugTimer.current);
    const q = v.trim();
    if (q.length < 2) { setSug([]); return; }
    sugTimer.current = setTimeout(() => {
      autocompleteProduto(q, 'lista').then((d) => setSug(d.sugestoes || [])).catch(() => setSug([]));
    }, 150);
  }
  async function escolherSug(s) { // tocar numa sugestão (genérico ou específico)
    setTxt(''); setSug([]); setAviso('');
    try { await adicionarListaItem({ nome: s.nome, ...(s.ean ? { ean: s.ean } : {}) }); setDestaqueAlvo(s.ean ? { ean: String(s.ean) } : { nome: nomeTalao(s.nome).toLowerCase() }); carregar(); } catch { setAviso('Falha ao adicionar.'); }
  }
  async function enviarTexto(e) {
    e?.preventDefault(); const nome = txt.trim(); if (!nome) return;
    setTxt(''); setSug([]); setAviso('');
    try { await adicionarListaItem({ nome }); setDestaqueAlvo({ nome: nomeTalao(nome).toLowerCase() }); carregar(); } catch { setAviso('Falha ao adicionar.'); }
  }
  // DESCOBERTA → adicionar: uma sugestão de cadência, todas de uma vez, ou um nome solto
  // (item em falta de uma receita / produto habitual).
  async function addRecomendado(r) { // chip do card de recomendação → aparece JÁ (OTIMISTA; o chip some sozinho)
    const nome = r.nome, q = r.quantidade || 1;
    // insere local já — o card "Será que você precisa" recalcula e tira o chip; sem esperar o round-trip.
    setItens((xs) => [...(xs || []), { id: -Date.now(), nome, quantidade: q, estado: 'ativo', adicionado_por: ativoNome, grupo: grupoDeNome(nome), _otimista: true }]);
    setDestaqueAlvo({ nome: nomeTalao(nome).toLowerCase() });
    // /lote DEVOLVE a lista RESOLVIDA (com o PREÇO-FACTO casado pelo histórico) num só round-trip →
    // o item entra COM preço, sem depender de um GET separado (que deixava a recomendação sem preço).
    try { const res = await adicionarListaLote([{ nome, quantidade: q }]); if (res?.itens) setItens(res.itens); else carregar(); }
    catch { setAviso('Falha ao adicionar.'); carregar(); }
  }
  async function addNome(nome) {
    try { await adicionarListaItem({ nome }); setDestaqueAlvo({ nome: nomeTalao(nome).toLowerCase() }); carregar(); } catch { setAviso('Falha ao adicionar.'); }
  }
  async function addTodosHabituais(nomes) { // estado vazio → "juntar todos" os habituais de uma vez
    if (!nomes?.length) return;
    try { const r = await adicionarListaLote(nomes.map((n) => ({ nome: n }))); if (r?.itens) setItens(r.itens); else carregar(); } catch { carregar(); }
  }
  // MEMBROS (perfis) → cor estável por membro; o ativo é "quem apanha".
  const [perfis, setPerfis] = useState([]);
  useEffect(() => { listarPerfis().then((ps) => setPerfis(ps || [])).catch(() => setPerfis([])); }, []);
  const corMembro = useMemo(() => {
    const m = new Map();
    [...perfis].sort((a, b) => a.id - b.id).forEach((pf, i) => m.set(String(pf.nome).toLowerCase(), MEMBRO_CORES[i % MEMBRO_CORES.length]));
    return m;
  }, [perfis]);
  const corDe = (nome) => corMembro.get(String(nome || '').toLowerCase()) || '#c8d3bd'; // neutro p/ desconhecido
  const ativoNome = (perfis.find((pf) => pf.ativo) || perfis[0])?.nome || null;
  // APANHAR no mercado: o gesto-rei. RISCA NO LUGAR (risco animado na cor de quem apanha + tick a
  // saltar) e SÓ DEPOIS (~360ms) migra p/ "No carrinho". A chamada ao servidor é DIFERIDA p/ o fim
  // da animação → o item fica 'ativo' durante o risco e um poll a meio não o faz "saltar" (sem corrida).
  async function apanhar(it, marcado) {
    if (marcado) {
      setPicando((p) => ({ ...p, [it.id]: ativoNome }));
      setTimeout(() => {
        setItens((xs) => xs.map((x) => (x.id === it.id ? { ...x, estado: 'carrinho', marcado_por: ativoNome } : x)));
        setPicando((p) => { const n = { ...p }; delete n[it.id]; return n; });
        atualizarListaItem(it.id, { marcado: true }).catch(() => carregar());
      }, 360);
    } else { // des-marcar (tocar no item do carrinho) → volta JÁ a ativo
      setItens((xs) => xs.map((x) => (x.id === it.id ? { ...x, estado: 'ativo', marcado_por: null } : x)));
      atualizarListaItem(it.id, { marcado: false }).catch(() => carregar());
    }
  }
  const carrinho = (itens || []).filter((i) => i.estado === 'carrinho');
  const qtdTxt = (it) => {
    if (it.unidade) return fmtMedida(it.qtd_medida, it.unidade);
    const q = it.quantidade || 1;
    if (ehOvoDuzia(it.nome)) return `${q} dúzia${q > 1 ? 's' : ''}`; // ovos contam-se por dúzia
    return `${q} un`;
  };
  const grupos = agruparSec(ativos);
  // "Será que você precisa de…": a CADÊNCIA (running low) primeiro + as TOP 6 habituais da casa,
  // sem repetir o que já está na lista nem entre si. Recalcula ao mudar a lista → o chip do item
  // que se junta desaparece sozinho.
  const recomendados = useMemo(() => {
    const chave = (n) => nomeTalao(String(n || '')).toLowerCase();
    const naLista = new Set((itens || []).map((i) => chave(i.nome)));
    const out = []; const vistos = new Set();
    for (const s of sugCad) { const k = chave(s.nome); if (!naLista.has(k) && !vistos.has(k)) { vistos.add(k); out.push({ nome: s.nome, quantidade: s.quantidade }); } }
    let nHab = 0;
    for (const h of habituais) { if (nHab >= 6) break; const k = chave(h.produto); if (!naLista.has(k) && !vistos.has(k)) { vistos.add(k); out.push({ nome: h.produto }); nHab += 1; } }
    return out;
  }, [sugCad, habituais, itens]);
  return (
    <>
      <Ctop title="A minha lista" sub="compartilhada<br>com a família" back onBack={back} />
      {total > 0 && <div className="pricetag"><span className="pt-hole" /><div className="pt-v"><b>{eur(total)}</b><small>estimado</small></div></div>}
      <div className="scrollarea">
        {/* "Talvez esteja a acabar" (cadência) só quando a lista TEM itens — na lista vazia o herói
            é o arranque pelos Habituais (abaixo), para não competirem pelo mesmo espaço. */}
        {(ativos.length > 0 || carrinho.length > 0) && (
        <div className="descob">
          {recomendados.length > 0 && !acabarFechado && (
            <div className="disc-card">
              <div className="disc-h"><span><Ico name="spark" size={14} color="var(--amber-d)" /> Será que você precisa de…</span>
                <button className="disc-x" title="Fechar" onClick={() => setAcabarFechado(true)}><Ico name="close" size={15} /></button></div>
              <div className="disc-chips">
                {recomendados.map((r) => (
                  <button className="disc-chip" key={r.nome} onClick={() => addRecomendado(r)}>
                    <Ico name="plus" size={12} stroke={2.8} color="var(--leaf-d)" />{nomeTalao(r.nome)}{r.quantidade > 1 ? ` ×${r.quantidade}` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        )}
        {itens == null ? <p className="empty">…</p> : ativos.length === 0 && carrinho.length === 0 ? <EstadoVazioHabituais onAdd={addNome} onTodos={addTodosHabituais} />
          : (<>
            {grupos.map((g) => (
              <React.Fragment key={g.s}>
                <div className="sec">{g.s}</div>
                {/* borda direita = cor de QUEM ADICIONOU. Tocar no nome APANHA;
                    ARRASTAR para a direita apaga (swipe-to-delete). */}
                {g.itens.map((it) => (
                  <ItemLista key={it.id} it={it} cor={corDe(it.adicionado_por)} qtd={qtdTxt}
                    riscaCor={picando[it.id] ? corDe(picando[it.id]) : null}
                    destaque={it.id === destaqueId} innerRef={it.id === destaqueId ? destRef : null}
                    onApanhar={apanhar} onRemover={remover} onDelta={delta} onDeltaMedida={deltaMedida}
                    onLevar={levar} onFormas={setVariantesItem} />
                ))}
              </React.Fragment>
            ))}
            {carrinho.length > 0 && (<>
              <div className="sec boughtsec"><Ico name="check" size={13} stroke={2.6} /> No carrinho · {carrinho.length}</div>
              {carrinho.map((it) => (
                <ItemCarrinho key={it.id} it={it} cor={corDe(it.adicionado_por)} riscoCor={corDe(it.marcado_por)}
                  qtd={qtdTxt} onApanhar={apanhar} onRemover={remover} />
              ))}
            </>)}
          </>)}
        {/* "Dá para cozinhar" vive no FIM da lista — não rouba espaço aos itens no topo */}
        {refeicoes.length > 0 && (
          <div className="disc-card recfim">
            <div className="disc-h"><span><Ico name="recipe" size={14} color="var(--coral)" /> Dá para cozinhar</span></div>
            {refeicoes.map((r) => (
              <div className="disc-rec" key={r.nome}>
                <div className="dr-nome">{r.nome}</div>
                {r.usa?.length > 0 && <div className="dr-usa">usa {r.usa.map(nomeTalao).join(', ')}</div>}
                {r.falta?.length > 0 && (
                  <div className="dr-falta">falta {r.falta.map((f) => (
                    <button className="dr-add" key={f} onClick={() => addNome(f)}><Ico name="plus" size={11} stroke={2.8} color="var(--leaf-d)" />{nomeTalao(f)}</button>
                  ))}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="actfoot">
        {escrever && (
          <div className="addwrap">
            {sug.length > 0 && (
              <div className="acdrop">
                {sug.map((s, i) => (
                  <button type="button" className={`acitem ${s.generico ? 'gen' : ''}`} key={`${s.nome}-${s.ean || i}`} onClick={() => escolherSug(s)}>
                    <span className="acnome">{nomeTalao(s.nome)}</span>
                    {(s.marca || s.tamanho) && <span className="acsub">{[s.marca && limparMarca(s.marca), fmtTamanho(s.tamanho)].filter(Boolean).join(' · ')}</span>}
                    {s.tem_nutricao && <span className="acnut" title="Tem informação nutricional" />}
                  </button>
                ))}
              </div>
            )}
            <form className="addmore open" onSubmit={enviarTexto}>
              <input className="addfield" autoFocus placeholder="Escrever produto…" value={txt} onChange={(e) => onTxt(e.target.value)} style={{ color: 'var(--ink)' }} />
              <button className="addopt" type="submit" disabled={!txt.trim()}><Ico name="plus" size={17} stroke={2} /> Adicionar</button>
            </form>
          </div>
        )}
        {aviso && <div className="addlegend" style={{ justifyContent: 'center', color: 'var(--ink-2)' }}>{aviso}</div>}
        <div className="addbar">
          {/* o scan da lista vem do botão central da régua (Nav → paraLista) — sem ícone próprio aqui */}
          <button className="addfab hab" title="Habituais — produtos que costuma comprar" onClick={() => setHabAberto(true)}><Ico name="list" size={23} stroke={2} color="#3f7a3f" /></button>
          <button className={`addfab mic ${gravando ? 'rec' : ''}`} title="Ditar para a lista" onClick={alternarVoz} disabled={proc}>
            <Ico name="mic" size={24} stroke={2} color="#f4fff0" />
          </button>
          <button className={`addfab plus ${escrever ? 'on' : ''}`} title="Escrever" onClick={() => setEscrever((v) => !v)}><Ico name="plus" size={24} stroke={2.4} color="#3f7a3f" /></button>
        </div>
      </div>
      {habAberto && <HabituaisSheet onFechar={() => setHabAberto(false)} onAdd={addNome} />}
      {variantesItem && <VariantesSheet it={variantesItem} onFechar={() => setVariantesItem(null)} onEscolher={(v) => escolherVariante(variantesItem, v)} />}
    </>
  );
}

// SHEET de VARIANTES ("N formas"): as variedades que a casa COMPROU deste produto (ex.: "Iogurte"
// → os iogurtes que costumam levar), com foto/idas/preço. Tocar concretiza o item na variante. A
// variante habitual é uma SUGESTÃO falível → vive aqui (escolha humana), nunca como facto na linha.
function VariantesSheet({ it, onFechar, onEscolher }) {
  const [vars, setVars] = useState(null);
  useEffect(() => { variantesLista(it.nome).then((v) => setVars(v || [])).catch(() => setVars([])); }, [it.nome]);
  return (
    <div className="sheet-bg" onClick={onFechar}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h"><b>Qual {nomeTalao(it.nome)}?</b><button className="sheet-x" onClick={onFechar}><Ico name="close" size={18} /></button></div>
        <div className="sheet-sub">As que a casa costuma comprar. Toque para escolher esta da lista.</div>
        <div className="sheet-body">
          {vars == null ? <p className="empty">…</p> : vars.length === 0 ? <p className="empty">Sem variantes no histórico.</p>
            : vars.map((v) => (
              <button className="var-row" key={v.sku_id} onClick={() => onEscolher(v)}>
                {v.imagem ? <img className="var-img" src={v.imagem} alt="" loading="lazy" /> : <span className="var-img ph"><Ico name="usual" size={18} color="var(--ink-3)" /></span>}
                <div className="hr-b">
                  <div className="hr-n">{nomeTalao(v.nome)}</div>
                  <div className="hr-s">{v.idas}× comprado{v.loja ? ` · ${v.loja}` : ''}{v.preco != null ? ` · ${eur(v.preco)}${v.unidade ? `/${v.unidade}` : ''}` : ''}</div>
                </div>
                <Ico name="chevron" size={16} stroke={2.4} color="var(--ink-3)" />
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

// ESTADO VAZIO: em vez de "Lista vazia", arranca pelos HABITUAIS da casa como chips "+" (1 toque
// junta; ao juntar o 1.º, a lista deixa de estar vazia e o item aparece JÁ em destaque). Sem histórico
// → mensagem de arranque (voz/scan/escrever). Reusa /api/habituais (cache stale-while-revalidate).
function EstadoVazioHabituais({ onAdd, onTodos }) {
  const [prods, setProds] = useState(null);
  useEffect(() => { carregarHabituais().then((p) => setProds((p || []).slice(0, 8))).catch(() => setProds([])); }, []);
  if (prods == null) return <p className="empty">…</p>;
  if (!prods.length) return <p className="empty">A sua lista está vazia.<br />Toque no microfone, escaneie um código ou escreva para começar.</p>;
  return (
    <div className="vazio-hab">
      <div className="vh-t"><b>Comece pelos seus habituais</b><small>1 toque para juntar — os produtos que costuma comprar</small></div>
      <div className="disc-chips">
        {prods.map((p) => (
          <button className="disc-chip" key={p.produto} onClick={() => onAdd(p.produto)}>
            <Ico name="plus" size={12} stroke={2.8} color="var(--leaf-d)" />{nomeTalao(p.produto)}
          </button>
        ))}
      </div>
      {prods.length > 1 && <button className="vh-todos" onClick={() => onTodos(prods.map((p) => p.produto))}><Ico name="plus" size={14} stroke={2.6} color="var(--leaf-d)" /> juntar todos</button>}
    </div>
  );
}

// SHEET de HABITUAIS (restaurado da v1): produtos que a casa costuma comprar (histórico,
// ≥2 idas em 60 dias). Toca-se em + para adicionar à lista; carrega lazy ao abrir.
function HabituaisSheet({ onFechar, onAdd }) {
  const [prods, setProds] = useState(null);
  const [feitos, setFeitos] = useState(() => new Set());
  useEffect(() => { carregarHabituais().then((p) => setProds(p || [])).catch(() => setProds([])); }, []);
  const add = (p) => { setFeitos((s) => new Set(s).add(p.produto)); onAdd(p.produto); };
  return (
    <div className="sheet-bg" onClick={onFechar}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h"><b>Habituais</b><button className="sheet-x" onClick={onFechar}><Ico name="close" size={18} /></button></div>
        <div className="sheet-sub">Os produtos que costuma comprar. Toque em + para juntar à lista.</div>
        <div className="sheet-body">
          {prods == null ? <p className="empty">…</p> : prods.length === 0 ? <p className="empty">Ainda sem histórico de compras.</p>
            : prods.map((p) => {
              const ok = feitos.has(p.produto);
              return (
                <div className="hab-row" key={p.produto}>
                  <div className="hr-b">
                    <div className="hr-n">{nomeTalao(p.produto)}</div>
                    <div className="hr-s">{p.idas}× comprado{p.ultimo_preco != null ? ` · ${eur(p.ultimo_preco)}` : ''}</div>
                  </div>
                  <button className={`hr-add ${ok ? 'done' : ''}`} onClick={() => !ok && add(p)} disabled={ok}>
                    <Ico name={ok ? 'check' : 'plus'} size={16} stroke={2.6} color={ok ? '#fff' : 'var(--leaf-d)'} />
                  </button>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

/* ── HISTÓRICO (+ comparar) ──────────────────────────────────────────────── */
function Historico({ go, back, addCmp, clearCmp }) {
  const [dados, setDados] = useState(null);
  const [cmp, setCmp] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  useEffect(() => { listarHistoricoProduto(10).then(setDados).catch(() => setDados({ erro: true })); }, []);
  const produtos = dados && !dados.erro ? dados.produtos : [];
  const toggle = (ean) => setSel((s) => { const n = new Set(s); n.has(ean) ? n.delete(ean) : (n.size < 6 && n.add(ean)); return n; });
  const escolhidos = produtos.filter((p) => p.ean && sel.has(p.ean));
  const temEan = produtos.some((p) => p.ean);
  const action = temEan && (
    <button className={`hist-cmp ${cmp ? 'on' : ''}`} title="Comparar" onClick={() => { setCmp((v) => !v); setSel(new Set()); }}>
      <Ico name="compare" size={20} stroke={2} />
    </button>
  );
  return (
    <>
      <Ctop title="Histórico" sub={cmp ? `${sel.size} selecionado(s)` : 'produtos consultados'} back onBack={back} action={action} />
      <div className="scrollarea">
        {dados == null ? <p className="empty">…</p> : dados.erro ? <p className="empty">Não foi possível carregar.</p>
          : produtos.length === 0 ? <p className="empty">Você ainda não consultou nenhum produto.</p>
          : produtos.map((p, i) => {
            const marcado = p.ean && sel.has(p.ean);
            const onTap = cmp ? (p.ean ? () => toggle(p.ean) : undefined) : () => go('ficha', { ean: p.ean, sku_id: p.sku_id, nome: p.nome });
            return (
              <div className={`item hist ${marcado ? 'sel' : ''}`} key={`${p.ean || p.nome}-${i}`} onClick={onTap} style={cmp && !p.ean ? { opacity: .45 } : undefined}>
                {cmp && p.ean && <span className={`histcheck ${marcado ? 'on' : ''}`}>{marcado && <Ico name="check" size={14} stroke={3} color="#fff" />}</span>}
                <div className="ib">
                  <div className="iname">{nomeTalao(p.nome)}{p.marca && <em className="ri-marca">{limparMarca(p.marca)}</em>}</div>
                  <div className="isub">{cmp && !p.ean ? 'sem código de barras' : (p.n_consultas > 1 ? `consultado ${p.n_consultas}×` : 'consultado')}</div>
                </div>
              </div>
            );
          })}
      </div>
      {cmp && sel.size >= 2 && (
        <div className="actfoot">
          <button className="cbtn cbtn-leaf" style={{ width: '100%' }} onClick={() => { clearCmp(); escolhidos.forEach((p) => addCmp({ ean: p.ean, nome: p.nome })); go('comparar'); }}>
            Comparar {sel.size} produtos
          </button>
        </div>
      )}
    </>
  );
}

// Card de um produto no comparador — ARRASTAR para a direita remove (mesmo swipe da lista).
function ItemCmp({ item, onRemover }) {
  const [dx, setDx] = useState(0);
  const g = useRef({ x0: 0, y0: 0, horiz: false, mov: false, dx: 0 });
  const start = (e) => { const t = e.touches[0]; g.current = { x0: t.clientX, y0: t.clientY, horiz: false, mov: true, dx: 0 }; };
  const move = (e) => {
    const r = g.current; if (!r.mov) return;
    const t = e.touches[0]; const dX = t.clientX - r.x0; const dY = t.clientY - r.y0;
    if (!r.horiz && Math.abs(dX) > Math.abs(dY) + 6) r.horiz = true;
    if (r.horiz) { r.dx = Math.max(0, dX); setDx(r.dx); }
  };
  const end = () => { const r = g.current; r.mov = false; if (r.horiz && r.dx > 90) onRemover(item.ean); setDx(0); };
  return (
    <div className="swrow">
      <div className="swrow-bg"><Ico name="close" size={18} /></div>
      <div className="item" style={{ transform: `translateX(${dx}px)`, transition: dx ? 'none' : 'transform .18s' }}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}>
        <div className="ib"><div className="iname">{item.nome ? nomeTalao(item.nome) : item.ean}</div></div>
      </div>
    </div>
  );
}

/* ── COMPARAR ────────────────────────────────────────────────────────────── */
// Cesto PRÓPRIO (vive no Shell): começa LIMPO e enche-se com SCANS (botão central da nav,
// que entra em modo "para comparar"). ≠ Histórico (que mostra o que já se consultou). O
// botão "Comparar" começa DESABILITADO e habilita ao 2.º produto.
function Comparar({ back, cmp = [], removeCmp, clearCmp }) {
  const [res, setRes] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const podeComparar = cmp.length >= 2;
  const comparar = async () => {
    if (!podeComparar || carregando) return;
    setCarregando(true);
    try { setRes(await compararProdutos(cmp.map((x) => x.ean))); } catch { setRes({ erro: true }); }
    setCarregando(false);
  };
  const nomeDe = (ean) => res?.produtos?.find((p) => String(p.ean) === String(ean))?.nome || cmp.find((x) => String(x.ean) === String(ean))?.nome || ean;
  const medal = (p) => (p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : `${p}º`);
  return (
    <>
      <Ctop title="Comparar Produtos" back onBack={back} />
      <div className="scrollarea">
        {res ? (
          res.erro ? <p className="empty">Falha ao comparar.</p> : (
            <>
              <div style={{ font: '800 18px var(--disp)', color: 'var(--ink)', margin: '2px 0 12px' }}>{res.perfil ? `Melhor para ${res.perfil}` : 'Resultado'}</div>
              {(res.ranking || []).map((r) => (
                <div className="item" key={r.ean}>
                  <div className="ib"><div className="iname"><span style={{ fontSize: '1.5em', verticalAlign: 'middle' }}>{medal(r.posicao)}</span> {nomeDe(String(r.ean))}</div><div className="isub">{r.motivo || r.veredicto}</div></div>
                  <span className={`hpill ${r.veredicto === 'evitar' || r.veredicto === 'atencao' ? 'swap' : 'good'}`}>{r.veredicto}</span>
                </div>
              ))}
              {res.resumo && <div className="parecer"><p style={{ margin: 0 }}>{res.resumo}</p></div>}
            </>
          )
        ) : cmp.length === 0 ? (
          <div className="cmp-empty">
            <div className="cmp-bubble">Leia o código de barras dos produtos que deseja comparar</div>
            <svg className="cmp-arrow" viewBox="0 0 104 220" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M60 6 C 104 60, 84 155, 50 204" stroke="var(--leaf-d)" strokeWidth="6" strokeLinecap="round" />
              <path d="M50 204 L 35 185 M50 204 L 65 185" stroke="var(--leaf-d)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        ) : cmp.map((item, i) => (
          <ItemCmp key={`${item.ean}-${i}`} item={item} onRemover={(ean) => { removeCmp(ean); setRes(null); }} />
        ))}
      </div>
      {!res && cmp.length > 0 && (
        <div className="actfoot">
          <button className="cbtn cbtn-leaf" style={{ width: '100%' }} disabled={!podeComparar || carregando} onClick={comparar}>
            {carregando ? 'Comparando…' : podeComparar ? `Comparar ${cmp.length} produtos` : 'Comparar'}
          </button>
        </div>
      )}
    </>
  );
}

/* ── FICHA (consulta de produto) ─────────────────────────────────────────── */
const NS_COR = { A: '#54b35a', B: '#86c43b', C: '#edc63f', D: '#ef9f43', E: '#e0734f' };
// classifica nível 0..3 por limiares FSA (por 100g) → [lvl, palavra]
function nivel(tipo, v) {
  if (v == null) return null;
  const T = {
    acucares: [[0.5, 'sem', 0], [5, 'baixo', 1], [22.5, 'moderado', 2], [Infinity, 'alto', 3]],
    gordura: [[0.5, 'sem', 0], [3, 'baixo', 1], [17.5, 'moderado', 2], [Infinity, 'alto', 3]],
    saturados: [[0.1, 'sem', 0], [1.5, 'baixo', 1], [5, 'moderado', 2], [Infinity, 'alto', 3]],
    sal: [[0.1, 'muito baixo', 0], [0.3, 'baixo', 1], [1.5, 'moderado', 2], [Infinity, 'alto', 3]],
    fibra: [[3, 'baixo', 1], [6, 'fonte', 2], [Infinity, 'alto', 2]],
    proteina: [[12, 'baixo', 1], [20, 'fonte', 2], [Infinity, 'alto', 2]],
  }[tipo];
  for (const [lim, w, lvl] of T) if (v <= lim) return [lvl, w];
  return [3, 'alto'];
}
// nutrição: SÓ inteiros (dono 2026-06-25) — mata artefatos de vírgula flutuante (6,69999980926514 → 7).
const fmtNut = (v) => {
  if (v == null || Number.isNaN(Number(v))) return null;
  return String(Math.round(Number(v)));
};
function Regua({ label, val, tipo }) {
  const cols = ['#7ec46a', '#cdb83e', '#e6a23c', '#e0734f'];
  const n = nivel(tipo, val);
  const lvl = n ? n[0] : -1;
  const txt = fmtNut(val);
  return (
    <div className="rgrow">
      <span className="rg-l">{label}</span>
      <span className="rg-v">{txt == null ? '—' : `${txt} g`}</span>
      <span className="rg-bar">{[0, 1, 2, 3].map((i) => <span key={i} className="rg-seg" style={{ background: i === lvl ? cols[lvl] : 'var(--cream-2)' }} />)}</span>
      <span className="rg-w" style={{ color: n ? cols[lvl] : 'var(--ink-3)' }}>{n ? n[1] : ''}</span>
    </div>
  );
}
// pílulas de nutrição das alternativas: prot (↑ melhor), gord. sat e açúc (↓ melhor).
// Cor pelos MESMOS limiares FSA do nivel() — comparar saúde de relance, sem inventar.
function Pills({ prot, sat, acu }) {
  const fmt = (x) => fmtNut(x);
  const baixoMelhor = (tipo, v) => { const n = nivel(tipo, v); return n ? (n[0] <= 1 ? 'good' : n[0] === 2 ? 'warn' : 'bad') : 'mid'; };
  const protCls = (v) => { const n = nivel('proteina', v); return n && n[0] >= 2 ? 'good' : 'mid'; };
  const pills = [];
  if (prot != null) pills.push([`prot ${fmt(prot)}`, protCls(prot)]);
  if (sat != null) pills.push([`gord. sat ${fmt(sat)}`, baixoMelhor('saturados', sat)]);
  if (acu != null) pills.push([`açúc ${fmt(acu)}`, baixoMelhor('acucares', acu)]);
  if (!pills.length) return null;
  return <div className="alt-pills">{pills.map(([t, c], i) => <span key={i} className={`ap ${c}`}>{t}</span>)}</div>;
}
// Molda uma ficha da BASE LOCAL (registo plano em IndexedDB) na forma do /info, para a Ficha
// renderizar instantâneo/offline: nome/marca + nutrição (base), sem imagem/sugestão (vêm do servidor).
function infoDaBaseLocal(fl) {
  return {
    _local: true, existe: true, nome: fl.nome || null, marca: fl.marca || null,
    base: { nutricao_100g: fl.nutricao_100g || null, quantidade: fl.quantidade || null, marca: fl.marca || null, nome: fl.nome || null },
  };
}
function Ficha({ go, back, ean, sku_id, nome }) {
  const [info, setInfo] = useState(null);
  const [analise, setAnalise] = useState(null);
  const [aval, setAval] = useState(null);
  const [alt, setAlt] = useState(null);
  const [open, setOpen] = useState({});
  const [adotando, setAdotando] = useState(false);
  const [avalLoading, setAvalLoading] = useState(true); // parecer personalizado a carregar
  const registado = useRef(false);
  const avalSeq = useRef(0); // guarda de corrida: descarta respostas de parecer fora de ordem
  const servidorOk = useRef(false); // o /info teve SUCESSO? (um ERRO não conta: offline, a base local deve aparecer)
  useEffect(() => {
    registado.current = false; // novo produto → permite registar 1×
    servidorOk.current = false;
    setAdotando(false);
    // limpa o estado do produto ANTERIOR (senão o parecer/análise antigos persistiam ao navegar
    // entre EANs) e invalida quaisquer pedidos de parecer ainda em voo (guarda de corrida).
    setInfo(null); setAval(null); setAnalise(null); setAlt(null); setAvalLoading(true); avalSeq.current += 1;
    const q = { itemId: undefined, ean, skuId: sku_id };
    // LOCAL-FIRST: mostra a ficha da BASE LOCAL (instantâneo/offline). Aplica-se enquanto o /info
    // não teve SUCESSO e o ecrã está vazio OU em erro — assim, OFFLINE (o /info falha), a base
    // local aparece à mesma e não fica tapada pelo {erro}. Não sobrepõe uma resposta boa do servidor.
    if (ean) fichaLocal(ean).then((fl) => { if (fl && !servidorOk.current) setInfo((prev) => (!prev || prev.erro) ? infoDaBaseLocal(fl) : prev); }).catch(() => {});
    // Ao chegar o servidor, PRESERVA o NOME/MARCA já mostrados da base local — é o MESMO produto;
    // o servidor enriquece nutrição/imagem/parecer, não troca a identidade. Sem isto o nome
    // "piscava" (base local → servidor) e parecia que tinha aberto outro produto.
    infoProduto(q).then((r) => { servidorOk.current = true; setInfo((prev) => (prev?._local && r && !r.erro) ? { ...r, nome: prev.nome || r.nome, marca: prev.marca || r.marca } : r); })
      .catch(() => { setInfo((prev) => (prev && prev._local) ? prev : { erro: true }); }); // erro NÃO marca servidorOk nem tapa a base local
    analiseProduto(q).then((r) => setAnalise(r.analise || null)).catch(() => setAnalise(null));
    alternativasProduto(q).then((r) => setAlt(r?.alternativas?.length ? r : null)).catch(() => setAlt(null));
    // o parecer personalizado corre num efeito SEPARADO ligado à nutrição (ver abaixo): a
    // nutrição pode chegar DEPOIS (VLM/adoção) e o parecer tem de re-correr, senão dizia
    // "sem ficha nutricional" para sempre.
  }, [ean, sku_id]);
  // histórico: regista com o NOME REAL do produto (depois de resolver), nunca o
  // do prop (que pode ser o do utilizador herdado, ou vazio no scan só-EAN).
  useEffect(() => {
    if (registado.current || !info || info.erro) return;
    const nm = info.nome || info.vlm?.nome || info.off?.nome || info.base?.nome || nome;
    if (!nm) return;
    registado.current = true;
    registarHistoricoProduto({ ean, skuId: sku_id, nome: nm, marca: info.vlm?.marca || info.off?.marca || info.base?.marca });
  }, [info, ean, sku_id, nome]);
  // 1.ª fonte com ao menos UM valor real (o vlm às vezes vem com todos os campos
  // null — objeto truthy mas vazio — e não pode ganhar do off/catálogo que têm dados)
  const nut = (() => {
    const s = info && !info.erro ? info : {};
    const temValor = (o) => o && Object.values(o).some((v) => v != null && v !== '');
    return [s.nutricao_100g, s.base?.nutricao_100g, s.off?.nutricao_100g, s.generico?.nutricao_100g, s.vlm?.nutricao_100g].find(temValor) || {};
  })();
  const num = (...ks) => { for (const k of ks) { const v = nut[k]; if (v != null && !Number.isNaN(Number(v))) return Number(v); } return null; };
  const nomeProd = nomeTalao(info?.nome || info?.vlm?.nome || info?.off?.nome || info?.base?.nome || nome || 'Produto');
  const nsCalc = info?.nutriscore_calc || null; // Nutri-Score que CALCULAMOS (mostramos os PONTOS, não a letra)
  // o parecer personalizado (avaliarParaPerfil) devolve { veredicto, resumo, a_favor, contra } —
  // o TEXTO está em `resumo` (não `texto`/`parecer`, que não existem); o selo deriva do veredicto.
  const verd = aval?.avaliacao?.veredicto || '';
  const attn = /aten[çc]|evitar/i.test(verd);
  const verdSelo = { evitar: 'Evitar', atencao: 'Atenção', adequado: 'Adequado' }[verd] || null;
  const parecerTxt = aval?.avaliacao?.resumo || analise?.parecer || '';
  // ALIMENTO vs NÃO-ALIMENTO: tem nutrição/Nutri-Score → ficha de alimento (Para Sue,
  // réguas, alternativas). Senão (filtros de café, detergente… ou alimento sem ficha
  // relevante: água/vinho/especiarias) → ficha simples (marca/categoria/tamanho).
  const temNut = Object.values(nut).some((v) => v != null && v !== '');
  // PARECER personalizado (chamada LLM ~2s, cacheada por perfil+produto). Dispara JÁ no mount, em
  // PARALELO com o /info (a avaliação lê a nutrição no SERVIDOR, não depende do `info` do frontend)
  // → o parecer carrega ao mesmo tempo que a ficha, não ~2s depois. Guarda de sequência (só a
  // resposta mais recente conta) mata a corrida ao navegar entre EANs. Re-disparado à mão na adoção.
  const dispararParecer = useCallback(() => {
    const meu = (avalSeq.current += 1);
    setAvalLoading(true);
    avaliacaoPersonalizada({ itemId: undefined, ean, skuId: sku_id })
      .then((r) => { if (meu === avalSeq.current) { setAval(r?.perfil ? r : null); setAvalLoading(false); } })
      .catch(() => { if (meu === avalSeq.current) { setAval(null); setAvalLoading(false); } });
  }, [ean, sku_id]);
  useEffect(() => { dispararParecer(); }, [dispararParecer]); // dispara no mount, em PARALELO com o /info
  const ehAlimento = temNut || !!nsCalc;
  const marcaViaEan = info?.marca_via === 'ean_empresa'; // marca veio do prefixo do EAN (voto), não de uma fonte
  const marcaP = info?.marca || info?.off?.marca || info?.vlm?.marca || info?.base?.marca || null;
  const tamanhoP = fmtTamanho(info?.tamanho || info?.off?.quantidade || info?.vlm?.quantidade || info?.base?.quantidade || null);
  // NOTA: não mostramos "categoria" no layout não-alimento — o classificador (grupoDeNome)
  // é orientado a alimentos e erra em não-alimentos ("Leite de Proteção Solar"→Laticínios).
  // Uma categoria fiável p/ não-alimentos precisa do campo product_type (ver backlog).
  // Sugestão por-nome: o mesmo produto foi achado sob outro EAN no OFF. Confirmar adota.
  const sug = info?.sugestao_nome || null;
  const eanAdotar = info?.ean || ean;
  const adotar = async () => {
    if (!sug || !eanAdotar || adotando) return;
    setAdotando(true);
    try {
      await adotarPorNome({ ean: eanAdotar, ean_ref: sug.ean_ref });
      const q = { itemId: undefined, ean, skuId: sku_id };
      const fresh = await infoProduto(q); setInfo(fresh);
      analiseProduto(q).then((r) => setAnalise(r.analise || null)).catch(() => {});
      dispararParecer(); // a nutrição ADOTADA mudou → re-avalia (guarda de sequência mantém a ordem)
      alternativasProduto(q).then((r) => setAlt(r?.alternativas?.length ? r : null)).catch(() => {});
    } catch { setAdotando(false); } // falhou → mantém a sugestão p/ tentar outra vez
  };
  const action = <button className="hist-cmp" title="Adicionar à lista" onClick={() => go('lista')}><span style={{ color: 'var(--leaf-d)' }}><Ico name="plus" size={20} stroke={2.4} /></span></button>;
  return (
    <>
      <Ctop title="Informação do produto" back onBack={back} action={action} />
      <div className="scrollarea">
        <div className="f-hero">
          <div className="f-thumb">{info?.imagem_catalogo ? <img src={info.imagem_catalogo} alt="" /> : <span style={{ display: 'grid', placeItems: 'center', height: '100%' }}><Ico name="photoprod" size={28} color="#7a93b0" /></span>}</div>
          <div className="f-name">{nomeProd}{info?.familia_label && <span className="f-fam">{info.familia_label}</span>}
            {info?.preco_catalogo && (
              <span className="f-preco">
                <b>{fmtPreco(info.preco_catalogo.preco, info.preco_catalogo.moeda)}</b>
                {info.preco_catalogo.preco_por_base != null && <span className="f-ppb"> · {fmtPreco(info.preco_catalogo.preco_por_base, info.preco_catalogo.moeda)}/{info.preco_catalogo.unidade_base || 'un'}</span>}
                <span className="f-pref"> · referência</span>
              </span>
            )}
          </div>
          {nsCalc && <span className="ns-calc" title="Nutri-Score que calculamos (algoritmo 2023) — pontos: menos é mais saudável" style={{ background: NS_COR[nsCalc.grau] || '#9ec93f' }}>{nsCalc.pontos > 0 ? '+' : ''}{nsCalc.pontos}</span>}
        </div>

        {sug && !temNut && (
          <div className="sug-nome">
            <div className="sug-h"><Ico name="search" size={15} color="#b06a00" /> Este código não tem ficha — achámos o mesmo produto</div>
            <div className="sug-b">
              {/* a foto do candidato SÓ se mostra quando a imagem foi confirmada (CLIP) — senão
                  era um palpite que podia nem ser parecido (Páprica ⇏ Milho). */}
              {sug.confirmada_imagem && sug.imagem_url && <img src={sug.imagem_url} alt="" />}
              <div className="sug-t">
                <div className="sug-n">{nomeTalao(sug.nome)}{sug.marca ? ` · ${limparMarca(sug.marca)}` : ''}</div>
                <div className="sug-d">{[fmtTamanho(sug.tamanho), sug.nutricao_100g ? 'com tabela nutricional' : null, (sug.confirmada_imagem && sug.imagem_url) ? 'foto confirmada' : null].filter(Boolean).join(' · ')}</div>
              </div>
            </div>
            <button className="sug-btn" disabled={adotando} onClick={adotar}>{adotando ? 'A aplicar…' : (sug.confirmada_imagem ? 'Usar a nutrição e a foto deste' : 'Usar a nutrição deste')}</button>
            <div className="sug-x">É o mesmo produto (talvez noutro tamanho). A nutrição é por 100 g — não muda com a embalagem.</div>
          </div>
        )}

        {ehAlimento ? (<>
          {avalLoading ? (
            <div className="parecer"><div className="ph">Avaliando<i className="an-dots" /></div></div>
          ) : parecerTxt ? (
            <div className={`parecer ${attn ? 'attn' : ''}`}>
              <div className="ph">{aval?.perfil ? `Para ${aval.perfil}` : 'Parecer'}{verdSelo && <span className={`selo ${attn ? 'attn' : ''}`}>{verdSelo}</span>}</div>
              <p>{parecerTxt}</p>
            </div>
          ) : null}
          <div className="reguas">
            <Regua label="Açúcares" tipo="acucares" val={num('acucares', 'acucar')} />
            <Regua label="Gordura" tipo="gordura" val={num('gordura', 'lipidos')} />
            <Regua label="Saturados" tipo="saturados" val={num('gordura_saturada', 'saturados')} />
            <Regua label="Sal" tipo="sal" val={num('sal')} />
            <Regua label="Fibra" tipo="fibra" val={num('fibra')} />
            <Regua label="Proteína" tipo="proteina" val={num('proteina')} />
          </div>
          {alt?.alternativas?.length > 0 && (
            <div className="alt-sec">
              <div className="alt-h">Alternativas similares</div>
              <div className="alt-sub">Produtos parecidos · nutrição por 100 g</div>
              {alt.alternativas.slice(0, 6).map((a, i) => {
                const an = a.nutricao || {};
                const v = (...ks) => { for (const k of ks) { const x = an[k]; if (x != null && !Number.isNaN(Number(x))) return Number(x); } return null; };
                const preco = a.eur_base ?? a.preco_por_base;
                return (
                  <div className="altx" key={a.sku_id ?? a.ean ?? i} onClick={() => go('ficha', { ean: a.ean, sku_id: a.sku_id, nome: a.nome })}>
                    <div className="alt-top"><span className="alt-n">{nomeTalao(a.nome)}{a.nutriscore && <span className="ns-calc sm" style={{ background: NS_COR[a.nutriscore.grau] || '#9ec93f' }}>{a.nutriscore.pontos > 0 ? '+' : ''}{a.nutriscore.pontos}</span>}</span>{preco != null && <span className="alt-p">{eur(preco)}/{a.unidade_base || 'kg'}</span>}</div>
                    <Pills prot={v('proteina')} sat={v('gordura_saturada', 'saturados')} acu={v('acucares', 'acucar')} />
                  </div>
                );
              })}
            </div>
          )}
        </>) : (
          // NÃO-ALIMENTO (ou alimento sem ficha nutricional): só os factos que temos.
          <div className="reguas">
            {[['Marca', marcaViaEan ? <>{marcaP} <span className="f-hint">· pelo código</span></> : marcaP], ['Categoria', info?.catalogo_categoria], ['Tamanho', tamanhoP]].filter(([, v]) => v).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '6px 0' }}>
                <span className="rg-l">{k}</span><span style={{ font: '700 13.5px var(--font)', color: 'var(--ink)', textAlign: 'right' }}>{v}</span>
              </div>
            ))}
            <div style={{ font: '500 11.5px/1.4 var(--font)', color: 'var(--ink-3)', borderTop: '1px solid var(--line)', paddingTop: 9, marginTop: 5 }}>{
              info?.tipo === 'food' ? 'Alimento sem ficha nutricional detalhada.'
                : info?.tipo === 'non_food' ? 'Produto não alimentício — sem ficha nutricional.'
                : 'Sem ficha nutricional.'
            }</div>
          </div>
        )}

        <div className="accbox">
          {(() => { const ing = info?.ingredientes || info?.vlm?.ingredientes || info?.off?.ingredientes; return ing ? (
            <>
              <button className={`acc ${open.ing ? 'open' : ''}`} onClick={() => setOpen((o) => ({ ...o, ing: !o.ing }))}><span>Ingredientes</span><Ico name="chevron" size={16} stroke={2.6} /></button>
              {open.ing && <div className="acc-body"><p>{ing}</p>{(info?.alergenios || info?.vlm?.alergenios || info?.off?.alergenios) && <div className="alerg">⚠ Alergénios: <b>{info?.alergenios || info?.vlm?.alergenios || info?.off?.alergenios}</b></div>}</div>}
            </>
          ) : null; })()}
          {ehAlimento && <>
            <button className={`acc ${open.aval ? 'open' : ''}`} onClick={() => setOpen((o) => ({ ...o, aval: !o.aval }))}><span>Como avaliamos</span><Ico name="chevron" size={16} stroke={2.6} /></button>
            {open.aval && <div className="acc-body"><div className="fontes">Dados nutricionais e Nutri-Score do <b>Open Food Facts</b>; ingredientes lidos do rótulo por IA; limiares do semáforo segundo a FSA (Reino Unido), por 100 g.<br /><i>Informação factual. Não é aconselhamento de saúde.</i></div></div>}
          </>}
        </div>
        {info?.erro && <p className="empty">Não foi possível carregar a ficha.</p>}
      </div>
    </>
  );
}

/* ── CONSULTAR POR NOME — busca AO VIVO no catálogo (produtos completos) ───── */
function Texto({ go, back }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null); // null | {produtos} | {erro}
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setRes(null); setBusy(false); return undefined; }
    setBusy(true);
    const id = setTimeout(() => {
      buscarProduto(t).then(setRes).catch(() => setRes({ erro: true })).finally(() => setBusy(false));
    }, 300); // debounce — busca enquanto escreve
    return () => clearTimeout(id);
  }, [q]);
  const produtos = res?.produtos || [];
  return (
    <>
      <Ctop title="Consultar por nome" sub="escreva o produto" back onBack={back} />
      <div className="scrollarea">
        <div className="txtsearch">
          <span className="ts-ic"><Ico name="search" size={20} stroke={2} /></span>
          <input className="ts-field" placeholder="Ex.: milho, iogurte grego…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        {q.trim().length < 2 ? <p className="empty">Escreva ao menos 2 letras.</p>
          : busy && !produtos.length ? <p className="empty">Procurando…</p>
          : res?.erro ? <p className="empty">Falha na busca.</p>
          : produtos.length === 0 ? <p className="empty">Nada encontrado para “{q}”.</p>
          : (
            <>
              <div className="sec">{produtos.length}{produtos.length >= 40 ? '+' : ''} resultado{produtos.length === 1 ? '' : 's'}</div>
              {produtos.map((p, i) => (
                <div className="frow" key={`${p.ean}-${i}`} onClick={() => go('ficha', { ean: p.ean, nome: p.nome })}>
                  <span className="fdot" style={{ background: '#e8eef3', overflow: 'hidden', padding: 0 }}>
                    {p.imagem ? <img src={p.imagem} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : inicial(p.nome)}
                  </span>
                  <div className="fb"><div className="fn">{nomeTalao(p.nome)}</div><div className="fs">{[p.marca && limparMarca(p.marca), fmtTamanho(p.tamanho)].filter(Boolean).join(' · ')}</div></div>
                  <span style={{ color: 'var(--ink-3)' }}>›</span>
                </div>
              ))}
            </>
          )}
      </div>
    </>
  );
}

/* ── DESPENSA ────────────────────────────────────────────────────────────── */
// cache local da despensa → render INSTANTÂNEO no regresso (o GET é lento ~2,5s); revalida em fundo.
const DESPENSA_CACHE = 'despensa_cache_v1';
const despCacheGet = () => { try { const s = localStorage.getItem(DESPENSA_CACHE); return s ? JSON.parse(s) : null; } catch { return null; } };
const despCacheSet = (d) => { try { localStorage.setItem(DESPENSA_CACHE, JSON.stringify(d || [])); } catch { /* noop */ } };

// Item da despensa — ARRASTAR para a direita remove (mesmo swipe da lista).
function ItemDespensa({ it, onAbrir, onRemover }) {
  const { dx, g, touch } = useSwipeDelete(() => onRemover(it));
  return (
    <div className="swrow">
      <div className="swrow-bg"><Ico name="close" size={18} /></div>
      <div className="item" style={{ transform: `translateX(${dx}px)`, transition: dx ? 'none' : 'transform .18s' }} {...touch}
        onClick={() => { if (g.current.horiz) return; onAbrir(it); }}>
        <div className="ib"><div className="iname">{nomeTalao(it.nome)}</div><div className="isub">{fmtTamanho(it.tamanho) || (it.marca && limparMarca(it.marca)) || ''}</div></div>
      </div>
    </div>
  );
}

function Despensa({ go, back }) {
  const [itens, setItens] = useState(despCacheGet); // instantâneo do cache (null só na 1.ª vez)
  useEffect(() => {
    listarDespensa().then((d) => { setItens(d || []); despCacheSet(d || []); }).catch(() => setItens((c) => c || []));
  }, []);
  const remover = useCallback(async (it) => { // swipe-apagar otimista; reverte recarregando se falhar
    setItens((cur) => { const next = (cur || []).filter((x) => x.ean !== it.ean); despCacheSet(next); return next; });
    try { await removerDespensa(it.ean); }
    catch { listarDespensa().then((d) => { setItens(d || []); despCacheSet(d || []); }).catch(() => {}); }
  }, []);
  const grupos = agruparDespensa(itens || []); // despensa = classificação MAIS FINA que a lista
  return (
    <>
      <Ctop title="Tenho em casa" sub={itens ? `${itens.length} itens` : ''} back onBack={back} amber />
      <div className="scrollarea">
        {itens == null ? <div className="desp-sk">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="sk-row" />)}</div>
          : itens.length === 0 ? <p className="empty">Despensa vazia. Escaneie um produto.</p>
          : grupos.map((g) => (
            <React.Fragment key={g.s}>
              <div className="sec amber">{g.s}</div>
              {g.itens.map((it) => <ItemDespensa key={it.ean} it={it} onAbrir={(x) => go('ficha', { ean: x.ean, nome: x.nome })} onRemover={remover} />)}
            </React.Fragment>
          ))}
      </div>
      <div className="actfoot"><div className="addbar">
        <button className="addfab scan amber" title="Escanear produto" onClick={() => go('scanner')}><Ico name="scan" size={24} stroke={2} color="#9a6a16" /></button>
      </div></div>
    </>
  );
}

/* ── MINHAS COMPRAS (notas) — hero do mês + filtro de loja + meses + FAB ──── */
const MESF = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
function Notas({ go, back, partilhado, scanNotas }) {
  const [notas, setNotas] = useState(null);
  // PRESERVAR a última escolha do filtro de mercado entre aberturas (localStorage).
  const [filtro, setFiltroRaw] = useState(() => { try { return localStorage.getItem('compras_filtro') || 'todas'; } catch { return 'todas'; } });
  const setFiltro = useCallback((v) => { setFiltroRaw(v); try { localStorage.setItem('compras_filtro', v); } catch { /* noop */ } }, []);
  const [jobs, setJobs] = useState([]);             // leituras em curso/falhadas (cartões)
  const fileRef = useRef(null);
  const partilhadoEnviado = useRef(false);
  const terminadosVistos = useRef(0);
  const carregar = useCallback(() => { listarNotas().then(setNotas).catch(() => setNotas([])); }, []);
  const carregarJobs = useCallback(() => listarJobsNota().then(setJobs).catch(() => {}), []);
  useEffect(() => { carregar(); carregarJobs(); }, [carregar, carregarJobs]);
  // Enquanto houver leitura 'em_analise', faz polling dos jobs (o resultado vem ter com o utilizador).
  useEffect(() => {
    if (!jobs.some((j) => j.estado === 'em_analise')) return undefined;
    const t = setInterval(carregarJobs, 3500);
    return () => clearInterval(t);
  }, [jobs, carregarJobs]);
  // Quando uma leitura TERMINA (pronto/precisa_revisao), recarrega as notas → o talão lido aparece sozinho.
  useEffect(() => {
    const fim = jobs.filter((j) => j.estado === 'pronto' || j.estado === 'precisa_revisao').length;
    if (fim > terminadosVistos.current) { terminadosVistos.current = fim; carregar(); }
  }, [jobs, carregar]);
  const enviar = useCallback(async (f) => {
    if (!f) return;
    // RESPOSTA IMEDIATA: cartão otimista "Em análise" na hora; o VLM corre em fundo no servidor.
    const tmpId = `tmp-${Date.now()}`;
    setJobs((js) => [{ id: tmpId, estado: 'em_analise', loja_nome: null }, ...js]);
    try { await enviarFatura(f, 'v2'); } catch { /* a varredura do servidor recupera o ficheiro guardado */ }
    carregarJobs(); // troca o cartão temporário pelo job real do servidor
  }, [carregarJobs]);
  async function lerTalao(e) { const f = e.target.files?.[0]; e.target.value = ''; await enviar(f); }
  const repetir = useCallback(async (id) => {
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, estado: 'em_analise' } : j)));
    try { await repetirLeitura(id); } catch { /* noop */ }
    carregarJobs();
  }, [carregarJobs]);
  // a régua de navegação dispara o "ler talão" pelo scan central (abre a câmara nativa).
  useEffect(() => {
    if (!scanNotas) return undefined;
    scanNotas.current = () => fileRef.current?.click();
    return () => { scanNotas.current = null; };
  }, [scanNotas]);
  // talão chegado por partilha (Share Target): envia 1× ao montar
  useEffect(() => { if (partilhado && !partilhadoEnviado.current) { partilhadoEnviado.current = true; enviar(partilhado); } }, [partilhado, enviar]);
  const lista = notas || [];
  const nomeLoja = (n) => n.loja || n.mercado || 'Outro';
  // se a loja guardada já não tem compras, volta a "todas" (evita lista vazia)
  useEffect(() => { if (filtro !== 'todas' && notas && !notas.some((n) => nomeLoja(n) === filtro)) setFiltro('todas'); }, [notas]); // eslint-disable-line react-hooks/exhaustive-deps
  const mesDe = (n) => { const d = new Date(n.data); return Number.isNaN(d.getTime()) ? { k: -1, l: '—' } : { k: d.getFullYear() * 12 + d.getMonth(), l: MESF[d.getMonth()] }; };
  // chips por loja, ordenados por nº de compras
  const cont = {}; lista.forEach((n) => { const k = nomeLoja(n); cont[k] = (cont[k] || 0) + 1; });
  const chips = [['todas', 'Todas', null, lista.length], ...Object.entries(cont).sort((a, b) => b[1] - a[1]).map(([nm, c]) => [nm, nm, lojaCor(nm)[0], c])];
  const filt = filtro === 'todas' ? lista : lista.filter((n) => nomeLoja(n) === filtro);
  // agrupa por mês (desc), com total por mês
  const grupos = [];
  [...filt].sort((a, b) => mesDe(b).k - mesDe(a).k).forEach((n) => {
    const m = mesDe(n); let g = grupos.find((x) => x.k === m.k);
    if (!g) { g = { k: m.k, l: m.l, total: 0, itens: [] }; grupos.push(g); }
    g.total += Number(n.total) || 0; g.itens.push(n);
  });
  const heroTot = grupos[0]?.total || 0, prevTot = grupos[1]?.total || 0;
  const pct = prevTot ? Math.round((1 - heroTot / prevTot) * 100) : 0;
  const heroLine = grupos.length > 1 ? (pct >= 0 ? `${pct}% menos que em ${grupos[1].l}` : `${-pct}% mais que em ${grupos[1].l}`) : '';
  return (
    <>
      <Ctop title="Minhas compras" sub={filtro === 'todas' ? 'todos os mercados' : filtro} back onBack={back} />
      <div className="scrollarea">
        <div className="herolist" onClick={() => go('gastos')}>
          <div className="k">Gasto em {grupos[0]?.l || 'este mês'}</div>
          <div className="v">{eur(heroTot)}</div>
          {heroLine && <div className="s">{heroLine}</div>}
          <span className="hero-link">ver análise <Ico name="chart" size={13} color="#f4fff0" /> →</span>
        </div>
        {chips.length > 1 && (
          <div className="storefilter">
            {chips.map(([id, nm, cor, ct]) => (
              <span key={id} className={`sf ${filtro === id ? 'on' : ''}`} onClick={() => setFiltro(id)}>
                {cor && <i style={{ background: cor }} />}{nm}{ct != null && <span className="ct"> {ct}</span>}
              </span>
            ))}
          </div>
        )}
        {/* leituras em curso/falhadas: o utilizador não fica preso — o cartão vira talão lido sozinho */}
        {jobs.filter((j) => j.estado === 'em_analise' || j.estado === 'falhou').map((j) => (
          <div className={`jobcard ${j.estado}`} key={j.id}>
            {j.estado === 'em_analise' ? (
              <>
                <span className="jc-spin" />
                <div className="jc-b"><div className="jc-t">Em análise{j.loja_nome ? ` · ${j.loja_nome}` : ''}</div><div className="jc-s">aviso quando ficar pronto</div></div>
              </>
            ) : (
              <>
                <span className="jc-fail"><Ico name="close" size={17} stroke={2.6} /></span>
                <div className="jc-b"><div className="jc-t">Não consegui ler</div><div className="jc-s">tente outra foto ou repita</div></div>
                <button className="jc-retry" onClick={() => repetir(j.id)}>Repetir</button>
              </>
            )}
          </div>
        ))}
        {notas == null ? <p className="empty">…</p> : filt.length === 0 && !jobs.length ? <p className="empty">Sem talões ainda.</p>
          : grupos.map((g) => (
            <React.Fragment key={g.k}>
              <div className="monthsep-retro"><span className="ms-month">{g.l}</span><span className="ms-rule" /><span className="ms-badge"><b>{eur(g.total)}</b></span></div>
              {g.itens.map((n) => { const [c, ini] = lojaCor(nomeLoja(n)); return (
                <div className="frow" key={n.id} onClick={() => go('recibo', { id: n.id })}>
                  <span className="fdot" style={{ background: c }}>{ini}</span>
                  <div className="fb"><div className="fn">{nomeLoja(n)}</div><div className="fs">{dataCurta(n.data)}{n.n_itens ? ` · ${n.n_itens} itens` : ''}</div></div>
                  <span className="fp">{eur(n.total)}</span>
                </div>); })}
            </React.Fragment>
          ))}
      </div>
      {/* o scan central da régua aciona este input (câmara nativa) — ver Notas/scanNotas */}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={lerTalao} />
    </>
  );
}

/* ── ANÁLISE DE GASTOS (+ "Em que gastou" por tipo de item) ──────────────── */
const mesCurto = (m) => { const s = MES[(Number(m) || 1) - 1] || ''; return s.charAt(0).toUpperCase() + s.slice(1); };
// grupo (lente de loja) → categoria de exibição + cor (carne+peixe fundem em "Talho e peixe")
const CAT_INFO = {
  frutas: ['Frutas e vegetais', '#5a9f57'], lacticinios: ['Laticínios e ovos', '#67b2c9'], mercearia: ['Mercearia', '#e6a23c'],
  carne: ['Talho e peixe', '#e0734f'], peixe: ['Talho e peixe', '#e0734f'], padaria: ['Padaria', '#d8a657'],
  congelados: ['Congelados', '#7fb0c9'], bebidas: ['Bebidas', '#8ab0e0'], doces: ['Doces e snacks', '#cf8db0'],
  higiene: ['Higiene e limpeza', '#9b8cc4'], outros: ['Outros', '#9b8cc4'],
};
function Gastos({ go, back }) {
  const [g, setG] = useState(null);
  useEffect(() => { resumoGastos().then(setG).catch(() => setG({ erro: true })); }, []);
  const serie = g?.serie || [];
  const max = Math.max(1, ...serie.map((s) => s.total || 0));
  const lojas = g?.por_loja || [];
  const lmax = Math.max(1, ...lojas.map((s) => s.total || 0));
  // "Em que gastou": remapeia grupos → categorias de exibição (funde, soma, ordena);
  // guarda os grupos-fonte de cada categoria para o drill-down dos produtos.
  const cats = (() => {
    const m = {};
    (g?.por_categoria || []).forEach((c) => { const [lbl, cor] = CAT_INFO[c.grupo] || ['Outros', '#9b8cc4'];
      if (!m[lbl]) m[lbl] = { label: lbl, cor, total: 0, grupos: [] }; m[lbl].total += Number(c.total) || 0; m[lbl].grupos.push(c.grupo); });
    return Object.values(m).filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
  })();
  const cmax = Math.max(1, ...cats.map((c) => c.total));
  return (
    <>
      <Ctop title="Análise de gastos" sub={g?.atual?.mes ? mesCurto(g.atual.mes) : ''} back onBack={back} />
      <div className="scrollarea">
        {g == null ? <p className="empty">…</p> : g.erro ? <p className="empty">Não foi possível carregar.</p> : (
          <>
            <div className="ghero"><div className="gh-l"><div className="k">Gasto em {g.atual?.mes ? mesCurto(g.atual.mes) : 'este mês'}</div><div className="v">{eur(g.atual?.total)}</div></div>
              <div className="gh-r">{g.variacao != null && <span className="gchip">{g.variacao <= 0 ? '▼' : '▲'} {Math.abs(Math.round(g.variacao))}% vs anterior</span>}<span className="gmed">média<br /><b>{eur(g.media)}</b>/mês</span></div></div>
            {serie.length > 0 && <>
              <div className="sec">Últimos meses</div>
              <div className="gbars">{serie.slice(-4).map((s, i, a) => (
                <div className="gcol" key={i}><span className="gv">{Math.round(s.total || 0)}</span>
                  <div className={`gbar ${i === a.length - 1 ? 'on' : ''}`} style={{ height: `${Math.max(8, Math.round((s.total || 0) / max * 92))}%` }} /><b>{mesCurto(s.mes)}</b></div>
              ))}</div>
            </>}
            {cats.length > 0 && <>
              <div className="sec">Em que gastou</div>
              {cats.map((c) => (
                <div className="gstore gcat" key={c.label} onClick={() => go('gastoscat', { label: c.label, grupos: c.grupos, total: c.total, cor: c.cor })}>
                  <span className="gname">{c.label} <span style={{ color: 'var(--ink-3)' }}>›</span></span><span className="gamt">{eur(c.total)}</span>
                  <div className="gtrack"><div className="gfill" style={{ width: `${Math.round(c.total / cmax * 100)}%`, background: c.cor }} /></div></div>
              ))}
            </>}
            {lojas.length > 0 && <>
              <div className="sec">Onde gastou</div>
              {lojas.map((s, i) => (
                <div className="gstore" key={i}><span className="gname">{s.loja || s.mercado}</span><span className="gamt">{eur(s.total)}</span>
                  <div className="gtrack"><div className="gfill" style={{ width: `${Math.round((s.total || 0) / lmax * 100)}%`, background: lojaCor(s.loja || s.mercado)[0] }} /></div></div>
              ))}
            </>}
          </>
        )}
      </div>
    </>
  );
}

/* ── GASTOS · CATEGORIA → TIPOS → PRODUTOS (2 níveis, iguais agregados) ───── */
// tipo = palavra-cabeça do nome, singularizada ("Queijo Minas"→queijo, "Ovos"→ovo)
function tipoDe(nome) {
  const w = normCat(nome).replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/)[0] || '';
  return singularizar(w) || w || 'outros';
}
function agruparTipo(prods) {
  const m = {};
  prods.forEach((p) => { const k = tipoDe(p.nome);
    if (!m[k]) m[k] = { tipo: k, total: 0, prods: [], orig: String(p.nome || k).trim().split(/\s+/)[0] || k };
    m[k].total += Number(p.total) || 0; m[k].prods.push(p); });
  return Object.values(m).map((t) => { // rótulo = PALAVRA ORIGINAL (mantém acentos)
    // NÃO gerar plural algoritmicamente (regra do dono 2026-06-15): "Arroz"→"Arrozs",
    // "Pão"→"Pãos" são terríveis. Mostra a palavra como está; a contagem dá o número.
    // (Plurais corretos, se quisermos, via dicionário LLM cacheado — não por regra.)
    return { ...t, label: t.orig.charAt(0).toUpperCase() + t.orig.slice(1) };
  }).sort((a, b) => b.total - a.total);
}
function GastosCat({ go, back, label, grupos, total, cor }) {
  const [prods, setProds] = useState(null);
  const [tipo, setTipo] = useState(null); // null = ver TIPOS · string = ver produtos do tipo
  useEffect(() => { gastosCategoria(grupos || []).then((d) => setProds(d.produtos || [])).catch(() => setProds([])); }, [grupos]);
  const tipos = useMemo(() => agruparTipo(prods || []), [prods]);
  const atual = tipos.find((t) => t.tipo === tipo);
  const lista = atual ? atual.prods : null;
  const Linha = (p, i) => (
    <div className="frow" key={p.sku_id || p.nome || i} onClick={() => go('ficha', { ean: p.ean, sku_id: p.sku_id, nome: p.nome })}>
      <span className="fdot" style={{ background: cor || '#9b8cc4' }}>{inicial(p.nome)}</span>
      <div className="fb"><div className="fn">{nomeTalao(p.nome)}</div><div className="fs">{p.n > 1 ? `${p.n}× compras` : '1 compra'}{p.marca ? ` · ${limparMarca(p.marca)}` : ''}</div></div>
      <span className="fp">{eur(p.total)}</span>
    </div>
  );
  return (
    <>
      <Ctop title={atual ? atual.label : (label || 'Categoria')} sub={`${eur(atual ? atual.total : total)} no mês`} back onBack={() => (tipo ? setTipo(null) : back())} />
      <div className="scrollarea">
        {prods == null ? <p className="empty">…</p>
          : lista ? lista.map(Linha)
          : tipos.length === 0 ? <p className="empty">Sem produtos neste mês.</p>
          : tipos.map((t) => (
            t.prods.length === 1 ? Linha(t.prods[0], t.tipo)
              : <div className="frow" key={t.tipo} onClick={() => setTipo(t.tipo)}>
                  <span className="fdot" style={{ background: cor || '#9b8cc4' }}>{inicial(t.label)}</span>
                  <div className="fb"><div className="fn">{t.label}</div><div className="fs">{t.prods.length} produtos</div></div>
                  <span className="fp">{eur(t.total)} ›</span>
                </div>
          ))}
      </div>
    </>
  );
}

/* ── TALÃO (detalhe) ─────────────────────────────────────────────────────── */
function Recibo({ go, back, id }) {
  const [d, setD] = useState(null);
  useEffect(() => { detalhesNota(id).then(setD).catch(() => setD({ erro: true })); }, [id]);
  const nota = d?.nota; const itens = agregarItensTalao(d?.itens || []);
  const [c, ini] = lojaCor(nota?.loja || nota?.mercado);
  return (
    <>
      <Ctop title="Talão" back onBack={back} />
      <div className="scrollarea">
        {d == null ? <p className="empty">…</p> : d.erro ? <p className="empty">Não foi possível carregar.</p> : (
          <>
            <div className="rec-band"><span className="fdot" style={{ background: c, width: 46, height: 46, borderRadius: 13, font: '800 16px var(--disp)' }}>{ini}</span>
              <div><div style={{ font: '800 16px var(--disp)', color: 'var(--ink)' }}>{nota?.loja || nota?.mercado || 'Compra'}</div><div style={{ font: '600 12.5px var(--font)', color: 'var(--ink-2)' }}>{dataCurta(nota?.data)} · {itens.length} {itens.length === 1 ? 'item' : 'itens'}</div></div>
              <span className="rec-tot">{eur(nota?.total)}</span></div>
            {itens.map((p, i) => {
              const qtd = Number(p.quantidade) || 1; const linha = Number(p.preco) || 0; const unit = qtd ? linha / qtd : linha;
              const marca = limparMarca(p.marca); const fmt = formatoProduto(p);
              const sub = [fmt, qtd !== 1 ? `${qtd} × ${eur(unit)}` : null].filter(Boolean).join(' · ');
              // identificado = tem EAN (mesmo sem nutrição) OU é fresco OU já tem ficha;
              // só pede câmara quem NÃO tem EAN e não é fresco (ex.: "PEITO FAMILIAR").
              const temFicha = !!p.ean || !!p.tem_dados || p.tipo_alimento === 'fresco';
              const identificar = () => go('scanner', { somente: ['codigo', 'produto'], itemId: p.id, nomeItem: nomeTalao(p.produto) }); // identifica a linha do talão (liga o EAN)
              return (
                <div className="rec-item" key={i} onClick={() => (temFicha ? go('ficha', { ean: p.ean, sku_id: p.sku_id, nome: nomeTalao(p.produto) }) : identificar())}>
                  <span className="ri-nm">
                    {nomeTalao(p.produto)}{marca && <em className="ri-marca">{marca}</em>}
                    {sub && <small className="ri-sub">{sub}</small>}
                    {(linha === 0 || p.desconto_direto > 0 || p.is_clearance) && (
                      <span className="ri-pills">
                        {linha === 0 ? <span className="pill free">grátis</span>
                          : p.desconto_direto > 0 ? <span className="pill desc">−{eur(p.desconto_direto)}</span>
                            : <span className="pill desc">promoção</span>}
                      </span>
                    )}
                  </span>
                  {!temFicha && <button className="ri-cam" title="Identificar produto" onClick={(e) => { e.stopPropagation(); identificar(); }}><Ico name="camera" size={17} stroke={2} color="#3f7a3f" /></button>}
                  <span className="ri-p">{eur(linha)}</span>
                </div>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}

/* ── PERFIL ──────────────────────────────────────────────────────────────── */
// Tela "Perfil nutricional" (separador) — minimalista (dono, 2026-06-16): SÓ o avatar do membro
// ativo; todo o detalhe (características, notas, importar texto, trocar/criar membro) vive no
// EDITOR. Tocar no cartão abre o editor.
function Perfil({ user, go }) {
  const [perfis, setPerfis] = useState(null);
  useEffect(() => { listarPerfis().then(setPerfis).catch(() => setPerfis([])); }, []);
  const ativo = (perfis || []).find((p) => p.ativo) || (perfis || [])[0];
  const nome = ativo?.nome || user;
  return (
    <>
      <Ctop title="Perfil nutricional" sub="membro ativo" />
      <div className="scrollarea">
        <button className="perfil-hero" onClick={() => go('perfilsaude')}>
          <span className="ph-av">{inicial(nome)}</span>
          <div className="ph-nm">{nome}</div>
          <div className="ph-sb">perfil ativo · usado nos pareceres</div>
          <span className="ph-cta"><Ico name="leaf" size={16} stroke={2.2} color="#fff" /> Editar perfil de saúde</span>
        </button>
        <div className="v2-ver">BigBag · versão {APP_VERSION}</div>
      </div>
    </>
  );
}

/* ── EDITOR DE PERFIL DE SAÚDE ───────────────────────────────────────────── */
// Características em pílulas por grupo, 3 abas (Ativas/Desativadas/Adicionar), vários membros.
// As ATIVAS vão para o resumo (o que a avaliação lê); as inativas ficam guardadas. Catálogo
// genérico alimenta "Adicionar". Toggle/add são estado local; só "Guardar" persiste.
function subDemografia(d) {
  if (!d) return 'perfil de saúde';
  const sexo = d.sexo === 'Feminino' ? 'Mulher' : d.sexo === 'Masculino' ? 'Homem' : null;
  const partes = [sexo, d.idade && `${d.idade} anos`, d.peso && `${d.peso} kg`, d.altura && `${d.altura} cm`].filter(Boolean);
  return partes.length ? partes.join(' · ') : 'perfil de saúde';
}
function PerfilSaude({ back }) {
  const [perfis, setPerfis] = useState(null);
  const [curId, setCurId] = useState(null);
  const [view, setView] = useState('on');       // on | off | add
  const [screen, setScreen] = useState('edit');  // edit | novo
  const [estado, setEstado] = useState({});      // { key: { ativas:[], inativas:[] } }
  const [notas, setNotas] = useState('');        // texto livre (o que não cabe em pílula)
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [nv, setNv] = useState({ nome: '', email: '', idade: '', sexo: '', peso: '', altura: '' });
  const [imp, setImp] = useState(''); const [impOpen, setImpOpen] = useState(false); const [impBusy, setImpBusy] = useState(false);

  const carregar = useCallback(() => listarPerfis().then((ps) => { setPerfis(ps || []); return ps || []; }).catch(() => { setPerfis([]); return []; }), []);
  const corId = useMemo(() => { const m = new Map(); [...(perfis || [])].sort((a, b) => a.id - b.id).forEach((p, i) => m.set(p.id, MEMBRO_CORES[i % MEMBRO_CORES.length])); return m; }, [perfis]);

  function estadoDe(p) {
    const ina = p?.saude_estado?.inativas || {};
    const e = {};
    for (const g of GRUPOS_SAUDE) {
      const at = Array.isArray(p?.resumo?.[g.campo]) ? p.resumo[g.campo].filter((s) => typeof s === 'string' && s.trim()) : [];
      e[g.key] = { ativas: [...new Set(at)], inativas: [...new Set((ina[g.key] || []).filter((s) => typeof s === 'string' && s.trim()))] };
    }
    return e;
  }
  const selecionar = useCallback((p) => {
    setCurId(p.id); setEstado(estadoDe(p)); setNotas(typeof p.resumo?.notas === 'string' ? p.resumo.notas : ''); setScreen('edit'); setView('on'); setMsg('');
    if (!p.ativo) ativarPerfil(p.id).then(() => listarPerfis().then(setPerfis).catch(() => {})).catch(() => {});
  }, []);
  useEffect(() => { carregar().then((ps) => { const a = ps.find((p) => p.ativo) || ps[0]; if (a) selecionar(a); else setScreen('novo'); }); }, [carregar, selecionar]);

  const catalogoDe = (key) => {
    const e = estado[key] || { ativas: [], inativas: [] };
    const usados = new Set([...e.ativas, ...e.inativas].map((s) => s.toLowerCase()));
    return (CATALOGO_SAUDE[key] || []).filter((s) => !usados.has(s.toLowerCase()));
  };
  const counts = useMemo(() => {
    let a = 0, i = 0, cat = 0;
    for (const g of GRUPOS_SAUDE) { a += estado[g.key]?.ativas.length || 0; i += estado[g.key]?.inativas.length || 0; cat += catalogoDe(g.key).length; }
    return { a, i, cat };
  }, [estado]); // eslint-disable-line react-hooks/exhaustive-deps
  const mut = (fn) => setEstado((e) => { const n = {}; for (const k of Object.keys(e)) n[k] = { ativas: [...e[k].ativas], inativas: [...e[k].inativas] }; fn(n); return n; });
  const desativar = (key, s) => mut((n) => { n[key].ativas = n[key].ativas.filter((x) => x !== s); if (!n[key].inativas.includes(s)) n[key].inativas.push(s); });
  const reativar = (key, s) => mut((n) => { n[key].inativas = n[key].inativas.filter((x) => x !== s); if (!n[key].ativas.includes(s)) n[key].ativas.push(s); });
  const adicionar = (key, s) => mut((n) => { if (!n[key].ativas.includes(s)) n[key].ativas.push(s); });

  async function guardar() {
    if (!curId || saving) return; setSaving(true); setMsg('');
    const ativas = {}, inativas = {};
    for (const g of GRUPOS_SAUDE) { ativas[g.key] = estado[g.key]?.ativas || []; inativas[g.key] = estado[g.key]?.inativas || []; }
    try { await salvarSaude(curId, { ativas, inativas, notas }); setMsg('Perfil guardado.'); carregar(); }
    catch { setMsg('Falha ao guardar.'); } finally { setSaving(false); }
  }
  // IMPORTAR DE TEXTO: cola o perfil gerado pelo assistente → o LLM extrai as características em
  // pílulas + demografia + notas, SOBRESCREVENDO o que cá está (ação explícita). Re-popula o editor.
  async function importar() {
    if (!membro || impBusy || !imp.trim()) return; setImpBusy(true); setMsg('');
    try {
      await carregarPerfil({ nome: membro.nome, texto: imp.trim() });
      const ps = await carregar();
      const m = ps.find((p) => p.id === curId) || ps.find((p) => p.nome === membro.nome);
      if (m) selecionar(m);
      setImp(''); setImpOpen(false); setMsg('Perfil importado do texto.');
    } catch { setMsg('Falha ao importar.'); } finally { setImpBusy(false); }
  }
  async function criar() {
    const nome = nv.nome.trim(); if (!nome || saving) return; setSaving(true); setMsg('');
    const demografia = { email: nv.email, idade: nv.idade, sexo: nv.sexo, peso: nv.peso, altura: nv.altura };
    try {
      const r = await carregarPerfil({ nome, demografia });
      const ps = await carregar();
      const novo = ps.find((p) => p.id === r.id) || ps.find((p) => p.nome.toLowerCase() === nome.toLowerCase());
      setNv({ nome: '', email: '', idade: '', sexo: '', peso: '', altura: '' });
      if (novo) selecionar(novo);
    } catch { setMsg('Falha ao criar o membro.'); } finally { setSaving(false); }
  }

  const membro = (perfis || []).find((p) => p.id === curId) || null;

  if (screen === 'novo') {
    const ini = (nv.nome.trim()[0] || '?').toUpperCase();
    return (
      <>
        <Ctop title="Novo membro" back onBack={() => (perfis?.length ? setScreen('edit') : back())} />
        <div className="psw">
          <div className="form">
            <div className="av-pick"><div className="av-big">{ini}</div><div className="av-hint">A inicial vem do nome</div></div>
            <div className="fld"><label>Nome</label><input placeholder="Ex.: Maria Sousa" value={nv.nome} onChange={(e) => setNv({ ...nv, nome: e.target.value })} maxLength={80} /></div>
            <div className="fld"><label>Email</label><input type="email" placeholder="nome@email.com" value={nv.email} onChange={(e) => setNv({ ...nv, email: e.target.value })} /></div>
            <div className="frow2">
              <div className="fld"><label>Idade</label><div className="suffix"><input inputMode="numeric" placeholder="0" value={nv.idade} onChange={(e) => setNv({ ...nv, idade: e.target.value })} /><span className="u">anos</span></div></div>
              <div className="fld"><label>Sexo</label><div className="segsex">{['Feminino', 'Masculino', 'Outro'].map((s) => <button key={s} className={nv.sexo === s ? 'on' : ''} onClick={() => setNv({ ...nv, sexo: s })}>{s === 'Feminino' ? 'F' : s === 'Masculino' ? 'M' : 'Outro'}</button>)}</div></div>
            </div>
            <div className="frow2">
              <div className="fld"><label>Peso</label><div className="suffix"><input inputMode="decimal" placeholder="0" value={nv.peso} onChange={(e) => setNv({ ...nv, peso: e.target.value })} /><span className="u">kg</span></div></div>
              <div className="fld"><label>Altura</label><div className="suffix"><input inputMode="numeric" placeholder="0" value={nv.altura} onChange={(e) => setNv({ ...nv, altura: e.target.value })} /><span className="u">cm</span></div></div>
            </div>
            <p style={{ font: '600 12px/1.5 var(--font)', color: 'var(--ink-2)', margin: '4px 4px 0' }}>A seguir poderá escolher as características de saúde deste perfil.</p>
            {msg && <div style={{ font: '600 12.5px var(--font)', color: 'var(--coral)', margin: '8px 4px 0' }}>{msg}</div>}
          </div>
          <div className="pssave"><button className="cbtn cbtn-leaf" disabled={saving || !nv.nome.trim()} onClick={criar}>{saving ? '…' : 'Criar perfil'}</button></div>
        </div>
      </>
    );
  }

  const cor = corId.get(curId) || 'var(--leaf-d)';
  const area = (() => {
    if (perfis == null) return <p className="empty">…</p>;
    const blocos = GRUPOS_SAUDE.map((g) => {
      const e = estado[g.key] || { ativas: [], inativas: [] };
      const lista = view === 'add' ? catalogoDe(g.key) : view === 'on' ? e.ativas : e.inativas;
      if (!lista.length) return null;
      const cls = view === 'add' ? 'pill add' : view === 'on' ? 'pill on' : 'pill off';
      const onTap = view === 'add' ? adicionar : view === 'on' ? desativar : reativar;
      return (
        <div className="grp" key={g.key}>
          <div className="grp-h"><span className="gi" style={{ background: g.c }}><Ico name={g.gi} size={16} stroke={2.2} color="#fff" /></span><span className="gt">{g.t}</span><span className="gn">{lista.length}</span></div>
          <div className="pills">
            {lista.map((s) => (
              <button className={cls} key={s} style={{ '--gc': g.c, '--gs': g.s, '--gd': g.d }} onClick={() => onTap(g.key, s)}>
                <span className="tx">{s}</span>
                <span className={`mk ${view === 'add' ? 'add-mk' : ''}`}>{view === 'on' ? <Ico name="check" size={13} stroke={3} /> : <Ico name="plus" size={13} stroke={2.6} />}</span>
              </button>
            ))}
          </div>
        </div>
      );
    }).filter(Boolean);
    const vazio = view === 'add' ? ['Sem mais sugestões', 'Já adicionou todas as características sugeridas.']
      : view === 'on' ? ['Sem características ativas', 'Toque em “Adicionar” para incluir, ou escreva nas notas abaixo.']
        : ['Nada desativado', 'Tudo ativo. 👍'];
    const pilulas = blocos.length ? blocos : <div className="emptyv"><b>{vazio[0]}</b>{vazio[1]}</div>;
    if (view !== 'on') return pilulas;
    // TEXTO LIVRE: o que não cabe em pílula (plano de refeições, suplementos, horários…).
    // Entra na avaliação tal como as pílulas (o prompt inclui a linha "- Notas:").
    return (
      <>
        {blocos.length ? blocos : null}
        <div className="notas">
          <label><Ico name="list" size={16} stroke={2.2} color="var(--leaf-d)" /> Notas / observações</label>
          <textarea value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={4000}
            placeholder="O que não cabe em pílula — plano de refeições, horários de treino, valores de exames, observações do nutricionista…" />
          <div className="hint">Texto livre. Entra na avaliação tal como as características acima.</div>
        </div>
        <div className="impbox">
          {!impOpen ? (
            <button className="imp-toggle" onClick={() => setImpOpen(true)}><Ico name="upload" size={15} stroke={2.2} /> Importar de um texto</button>
          ) : (
            <>
              <label><Ico name="upload" size={16} stroke={2.2} color="var(--leaf-d)" /> Importar de um texto</label>
              <textarea value={imp} onChange={(e) => setImp(e.target.value)}
                placeholder="Cole aqui o perfil gerado pelo seu assistente — extraímos as características em pílulas, a demografia e as notas." />
              <div className="hint">Substitui as características pelo que for extraído do texto.</div>
              <div className="imp-acts">
                <button className="imp-cancel" onClick={() => { setImpOpen(false); setImp(''); }}>Cancelar</button>
                <button className="cbtn cbtn-leaf" disabled={impBusy || !imp.trim()} onClick={importar}>{impBusy ? 'Extraindo…' : 'Extrair características'}</button>
              </div>
            </>
          )}
        </div>
      </>
    );
  })();

  return (
    <>
      <Ctop title="Perfil de saúde" back onBack={back} />
      <div className="psw">
        <div className="memrow">
          {(perfis || []).map((p) => (
            <button className={`mem ${p.id === curId ? 'on' : ''}`} key={p.id} onClick={() => selecionar(p)}>
              <span className="mav" style={p.id === curId ? { background: corId.get(p.id), color: '#fff', border: 0 } : undefined}>{inicial(p.nome)}</span>
              <span className="mnm">{p.nome}</span>
            </button>
          ))}
          <button className="mem add-mem" onClick={() => { setNv({ nome: '', email: '', idade: '', sexo: '', peso: '', altura: '' }); setScreen('novo'); }}><span className="mav"><Ico name="plus" size={18} stroke={2.6} /></span><span className="mnm">Novo</span></button>
        </div>
        {membro && (
          <div className="who">
            <span className="av" style={{ background: cor, color: '#fff' }}>{inicial(membro.nome)}</span>
            <div><div className="nm">{membro.nome}</div><div className="sb">{subDemografia(membro.saude_estado?.demografia)}</div></div>
            <div className="cnt"><b>{counts.a}</b><span>ativas</span></div>
          </div>
        )}
        <div className="seg">
          <button className={view === 'on' ? 'on' : ''} onClick={() => setView('on')}>Ativas <span className="b">{counts.a}</span></button>
          <button className={`off-tab ${view === 'off' ? 'on' : ''}`} onClick={() => setView('off')}>Desativadas <span className="b">{counts.i}</span></button>
          <button className={`add-tab ${view === 'add' ? 'on' : ''}`} onClick={() => setView('add')}><Ico name="plus" size={16} stroke={2.8} /> Adicionar <span className="b">{counts.cat}</span></button>
        </div>
        <div className="area">{area}</div>
        <div className="pssave">
          {msg && <div style={{ font: '700 12.5px var(--font)', color: 'var(--leaf-d)', textAlign: 'center', margin: '0 0 8px' }}>{msg}</div>}
          <button className="cbtn cbtn-leaf" disabled={saving || !curId} onClick={guardar}>{saving ? '…' : 'Guardar perfil'}</button>
        </div>
      </div>
    </>
  );
}

/* ── RECEITAS (estático por enquanto) ────────────────────────────────────── */
// FOTO real (stock) que combina com o prato: busca por palavras-chave (LoremFlickr, sem chave).
// `lock` torna a imagem estável por receita. Fallback ao gradiente se a imagem falhar (onError).
const fotoReceita = (rec) => {
  if (rec.foto_url) return rec.foto_url; // Pexels (server-side) quando há chave; senão fallback keyless abaixo
  const q = String(rec.foto || rec.nome || 'food').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/).filter((w) => w.length > 2).slice(0, 4).join(',');
  const seed = Math.abs([...String(rec.nome || 'x')].reduce((a, c) => ((a * 31 + c.charCodeAt(0)) | 0), 7)) % 100000;
  return `https://loremflickr.com/600/360/${encodeURIComponent(q || 'food')},food?lock=${seed}`;
};
// PRÉ-AQUECIMENTO: começa a buscar o 1.º lote antes de o utilizador abrir Receitas (chamado no Shell),
// para que a tela já abra com cartas prontas. A promessa fica guardada e é consumida pelo deck.
let _recPrime = null;
let _linkPartilhado = null; // link de receita partilhado (Android share) → auto-importa ao abrir Receitas
// RESERVA LOCAL no telefone: guarda o baralho restante (não consumido) + sempre as 2 últimas recebidas
// como semente garantida → a tela abre INSTANTÂNEA com estas e atualiza/estende em fundo.
const REC_LS = 'bb_receitas_cache_v1';
function lerRecCache() {
  try {
    const c = JSON.parse(localStorage.getItem(REC_LS) || 'null');
    if (!c || !Array.isArray(c.deck) || !c.deck.length) return null;
    if (c.ts && Date.now() - c.ts > 7 * 864e5) return null; // descarta cache com +7 dias
    return c;
  } catch { return null; }
}
function gravarRecCache(restante, ultimas, vistosSet) {
  try {
    const seen = new Set(); const deck = [];
    for (const r of [...(restante || []), ...(ultimas || [])]) { if (r && r.nome && !seen.has(r.nome)) { seen.add(r.nome); deck.push(r); if (deck.length >= 30) break; } }
    if (deck.length) localStorage.setItem(REC_LS, JSON.stringify({ deck, vistos: [...(vistosSet || [])].slice(-120), ts: Date.now() }));
  } catch { /* sem localStorage (modo privado) — sem reserva, segue normal */ }
}
// pré-aquece o 1.º lote SÓ quando NÃO há reserva local (com reserva, a tela já abre instantânea)
function primeReceitas() { if (_recPrime || lerRecCache()) return; _recPrime = sugerirReceitas().catch(() => null); }
function takePrime() { const p = _recPrime; _recPrime = null; return p; }
// Classificação das GUARDADAS por ingrediente principal (ícone/emoji + carrossel por categoria).
const REC_CATS = [ // padrões SEM acento (txt é normalizado sem diacríticos)
  { id: 'massa', label: 'Massas', emoji: '🍝', re: /massa|macarr|espaguet|esparguet|penne|fusilli|talharim|tagliat|lasanha|nhoque|gnocch|noodl|aletria|paccheri|rigat|ravioli|farfalle|spaghetti/ },
  { id: 'frango', label: 'Frango', emoji: '🍗', re: /frango|galinha|peito de ave|coxa de|sobrecoxa|peru/ },
  { id: 'carne', label: 'Carne', emoji: '🥩', re: /carne|bife|boi|vaca|vitela|porco|costel|moid|almond|hamburg|picanha|alcatra|lombo|lingui|salsich/ },
  { id: 'peixe', label: 'Peixe', emoji: '🐟', re: /peixe|atum|sardinh|cavala|bacalhau|salmao|camarao|marisco|polvo|lula|tilapia|merluza|pescada|file de p/ },
  { id: 'arroz', label: 'Arroz', emoji: '🍚', re: /arroz|risoto|risotto/ },
  { id: 'sopa', label: 'Sopas', emoji: '🍲', re: /sopa|caldo|canja|creme de (?!leite)/ },
  { id: 'salada', label: 'Saladas', emoji: '🥗', re: /salada|legumes|vegetais|verduras|salteado de/ },
  { id: 'ovos', label: 'Ovos', emoji: '🍳', re: /\bovo|omelet|fritada|mexid|quiche|fritata/ },
  { id: 'doce', label: 'Doces', emoji: '🍰', re: /bolo|doce|sobremesa|chocolate|pudim|mousse|torta|biscoito|bolach|panqueca|crepe|brigad|tapioca doce/ },
];
const REC_CAT_OUTROS = { id: 'outros', label: 'Outros', emoji: '🍽️' };
function catReceita(rec) {
  const txt = `${rec.nome || ''} ${(rec.usa || []).join(' ')}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const c of REC_CATS) if (c.re.test(txt)) return c.id;
  return 'outros';
}
// ícones de categoria — set único mono-linha (do handoff), viewBox recortado p/ a arte encher o quadro
const CAT_SVG = {
  massa: '<path d="M4 11.5h16a8 8 0 0 1-16 0z"/><path d="M8.4 10.2c-1-1.6.4-3.1 1.6-2.3"/><path d="M12 10.2c-1-1.9.6-3.5 1.9-2.5"/><path d="M15.2 10.2c-.8-1.4.4-2.7 1.4-2"/>',
  frango: '<path d="M15.7 8.3a4.2 4.2 0 1 0-6 4.4l-3.4 3.4a2.4 2.4 0 1 0 .8 4 2.4 2.4 0 0 0 4-.8l3.4-3.4a4.2 4.2 0 0 0 1.2-7.6z"/>',
  carne: '<path d="M5 10c0-3 3.2-4.6 7-4.6s7 1.6 7 4.6c0 4.2-3.2 8.2-7 8.2S5 14.2 5 10z"/><path d="M8.8 9.6c2 1.3 4.4 1.3 6.4 0"/>',
  peixe: '<path d="M3.5 12c2.6-3.7 8.4-3.7 11 0-2.6 3.7-8.4 3.7-11 0z"/><path d="M14.5 12l5-3.2v6.4z"/><circle cx="7.4" cy="10.7" r=".8" fill="currentColor" stroke="none"/>',
  arroz: '<path d="M5 13.5h10a5 5 0 0 1-10 0z"/><path d="M11.5 12.8l7.5-5.3M12.7 14l7-4.6"/>',
  sopa: '<path d="M4.5 12.5h15a7.5 7.5 0 0 1-15 0z"/><path d="M9 8c-.7-1 .3-2 .9-1.4M12 8c-.7-1 .3-2 .9-1.4M15 8c-.7-1 .3-2 .9-1.4"/>',
  salada: '<path d="M3.6 13.5h16.8a8.4 8.4 0 0 1-16.8 0z"/><path d="M7.8 13c-2-2-1-5.2 1.6-4.8"/><path d="M12 13c-.4-3.4 2-5.4 4.4-4.2"/><path d="M10.6 13c-.3-2.2.8-3.8 2.2-3.6"/>',
  ovos: '<path d="M8.6 6.8c2.7-1.5 6-.2 6.5 2.4.3 1.4-.3 2.1.6 3.3.9 1.3.1 3.2-1.5 3.5-1.2.2-1.8-.6-3.1-.4-1.6.3-2.7 1-4 .2-1.6-.9-1.6-3-1.1-4.3.3-1 .1-1.7-.2-2.6-.4-1.4.5-2.8 2.3-3.5z"/><circle cx="11" cy="11" r="2.4"/>',
  doce: '<path d="M6 11.2h12l-1.1 7.1a1 1 0 0 1-1 .85H8.1a1 1 0 0 1-1-.85z"/><path d="M6 11.2a6 6 0 0 1 12 0z"/><path d="M12 5.2v2"/>',
  outros: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3.8"/>',
};
const CatIco = ({ id }) => (
  <svg viewBox="3.4 3.4 17.5 17.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
    style={{ display: 'block', width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: CAT_SVG[id] || CAT_SVG.outros }} />
);
// swipe VERTICAL para as receitas: ↑ = gostei (👍), ↓ = passar (👎).
function useSwipeVert(onUp, onDown) {
  const [dy, setDy] = useState(0);
  const g = useRef({ x0: 0, y0: 0, vert: false, mov: false, dy: 0 });
  const onTouchStart = (e) => { const t = e.touches[0]; g.current = { x0: t.clientX, y0: t.clientY, vert: false, mov: true, dy: 0 }; };
  const onTouchMove = (e) => {
    const r = g.current; if (!r.mov) return;
    const t = e.touches[0]; const dX = t.clientX - r.x0; const dY = t.clientY - r.y0;
    if (!r.vert && Math.abs(dY) > Math.abs(dX) + 6) r.vert = true;
    if (r.vert) { r.dy = dY; setDy(dY); }
  };
  const onTouchEnd = () => { const r = g.current; r.mov = false; if (r.vert && r.dy < -80) onUp(); else if (r.vert && r.dy > 80) onDown(); setDy(0); };
  return { dy, touch: { onTouchStart, onTouchMove, onTouchEnd } };
}
function ReceitaCard({ rec, onVoto, onVer, acao }) {
  const usa = rec.usa || [], falta = rec.falta || [];
  const total = usa.length + falta.length, have = usa.length;
  const pct = total ? Math.round((have / total) * 100) : 0;
  const catId = catReceita(rec);
  const catLabel = ([...REC_CATS, REC_CAT_OUTROS].find((c) => c.id === catId) || {}).label || 'Receita';
  const mt = falta.length === 0 ? { b: 'Tem tudo!', s: 'pode fazer agora' }
    : falta.length === 1 ? { b: 'Quase lá', s: 'falta 1 ingrediente' }
    : { b: 'Dá pra fazer', s: `falta ${falta.length} ingredientes` };
  return (
    <div className={`rec-card${acao ? ` acted ${acao}` : ''}`}>
      <div className="rphoto">
        <span className="rec-hero-ic"><Ico name="recipe" size={50} stroke={1.6} color="#3f7a3f" /></span>
        <img className="rec-img" src={fotoReceita(rec)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        <div className="rphoto-scrim" />
        <div className="ptop">
          {total > 0 ? (
            <div className="match">
              <span className="ring" style={{ background: `conic-gradient(var(--leaf-d) 0 ${pct}%, #dfe6da ${pct}% 100%)` }}><i>{have}/{total}</i></span>
              <span className="mt"><b>{mt.b}</b><span>{mt.s}</span></span>
            </div>
          ) : <span />}
          <div className="ptags">
            {rec.tempo && <span className="pchip"><Ico name="clock" size={13} stroke={1.9} />{rec.tempo}</span>}
            {rec.dificuldade && <span className="pchip"><Ico name="flame" size={13} stroke={1.9} />{rec.dificuldade}</span>}
          </div>
        </div>
        {acao && <span className={`rec-acao ${acao}`}>{acao === 'up' ? 'Salvo ✓' : 'Passado'}</span>}
      </div>
      <div className="rbody">
        <div className="rcat">{catLabel}{rec.refeicao ? ` · ${rec.refeicao}` : ''}</div>
        <div className="rtitle">{rec.nome}</div>
        {rec.desc && <div className="rdesc">{rec.desc}</div>}
        {total > 0 && (
          <div className="inged">
            <div className="ingl">Ingredientes · <b>você tem {have} de {total}</b></div>
            <div className="chips">
              {usa.slice(0, 8).map((x, k) => <span className="ing have" key={`h${k}`}><Ico name="check" size={12} stroke={3} />{x}</span>)}
              {falta.slice(0, 4).map((x, k) => <span className="ing miss" key={`m${k}`}><Ico name="plus" size={12} stroke={3} />{x}</span>)}
            </div>
          </div>
        )}
      </div>
      <div className="actions">
        <button className={`act pass${acao === 'down' ? ' on' : ''}`} title="Passar" onClick={() => onVoto(rec, -1)}><Ico name="close" size={24} stroke={1.9} /></button>
        <button className="act view" title="Ver receita (em breve)" onClick={() => onVer && onVer(rec)}><Ico name="eye" size={27} stroke={1.8} /></button>
        <button className="act like" title={acao === 'up' ? 'Salvo' : 'Salvar'} onClick={() => onVoto(rec, 1)}><Ico name={acao === 'up' ? 'check' : 'heart'} size={24} stroke={acao === 'up' ? 2.6 : 1.6} fill={acao === 'up' ? 'none' : '#fff'} color="#fff" /></button>
      </div>
    </div>
  );
}
// Linha de receita "Da web" — abre ao tocar; apaga com swipe (sem botão ✕).
function LinhaWeb({ r, onAbrir, onRemover }) {
  const { dx, g, touch } = useSwipeDelete(() => onRemover(r));
  return (
    <div className="swrow">
      <div className="swrow-bg"><Ico name="close" size={18} /></div>
      <div className="rec-saved" role="button" style={{ transform: `translateX(${dx}px)`, transition: dx ? 'none' : 'transform .18s' }} {...touch}
        onClick={() => { if (g.current.horiz) return; onAbrir(r); }}>
        {r.foto ? <img className="rec-saved-img" src={r.foto} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : <span className="rec-saved-img web-noimg"><Ico name="recipe" size={26} stroke={1.7} color="#3f7a3f" /></span>}
        <div className="rec-saved-b"><div className="rec-saved-n">{r.nome || r.site_nome || r.fonte}</div><div className="rec-saved-u">{r.site_nome || r.fonte}{r.ingredientes?.length ? ` · ${r.ingredientes.length} ingredientes` : ''}</div></div>
      </div>
    </div>
  );
}
function Receitas({ back }) {
  const [aba, setAba] = useState('sugestoes');
  const [deck, setDeck] = useState(null);   // lista de sugestões (carrossel horizontal)
  const [acoes, setAcoes] = useState({});   // nome → 'up' (salvo) | 'down' (passado)
  const [poucos, setPoucos] = useState(false);
  const [guardadas, setGuardadas] = useState(null);
  const [catSel, setCatSel] = useState(null); // categoria (ingrediente principal) escolhida nas Guardadas
  const [busca, setBusca] = useState('');      // busca nas Guardadas (nome/ingredientes)
  const [importadas, setImportadas] = useState(null); // receitas da web (aba "Da web")
  const [webSel, setWebSel] = useState(null);
  const [linkInput, setLinkInput] = useState('');
  const [importando, setImportando] = useState(false);
  const [importErro, setImportErro] = useState('');
  const vistos = useRef(new Set());         // nomes já mostrados → não repetir
  const semMais = useRef(false);
  const aCarregar = useRef(false);
  const nGostei = guardadas ? guardadas.length : 0;
  const buscarMais = useCallback(() => {
    if (aCarregar.current || semMais.current) return;
    aCarregar.current = true;
    const primed = vistos.current.size === 0 ? takePrime() : null; // 1.º lote: usa o pré-aquecido se houver
    (primed || sugerirReceitas([...vistos.current].slice(-60))).then((d) => {
      aCarregar.current = false;
      if (!d) { if (primed) buscarMais(); return; } // prime falhou → busca normal já
      if (d.poucos) { setPoucos(true); setDeck((c) => c || []); return; }
      const novas = (d.receitas || []).filter((r) => !vistos.current.has(r.nome));
      novas.forEach((r) => vistos.current.add(r.nome));
      if (!novas.length) semMais.current = true; // LLM esgotou ideias novas
      setDeck((c) => [...(c || []), ...novas]);
    }).catch(() => { aCarregar.current = false; setDeck((c) => c || []); });
  }, []);
  const carregarGostei = useCallback(() => { receitasGostei().then((g) => setGuardadas(g || [])).catch(() => setGuardadas([])); }, []);
  useEffect(() => {
    vistos.current = new Set(); semMais.current = false; setAcoes({}); setPoucos(false);
    const cache = lerRecCache();
    if (cache) { // RESERVA: abre instantânea com o que ficou guardado; não repete o já visto
      cache.deck.forEach((r) => vistos.current.add(r.nome));
      (cache.vistos || []).forEach((n) => vistos.current.add(n));
      setDeck(cache.deck);
    } else setDeck(null);
    buscarMais();      // estende/atualiza em fundo (ou faz a 1.ª busca, se não havia reserva)
    carregarGostei();
  }, [buscarMais, carregarGostei]);
  // RESERVA: persiste as sugestões ainda NÃO tratadas (salvas/passadas saem) → próxima abertura instantânea
  useEffect(() => { if (deck && deck.length) gravarRecCache(deck.filter((r) => !acoes[r.nome]), [], vistos.current); }, [deck, acoes]);
  // PRÉ-BUSCA ao chegar perto do fim do carrossel (folheamento sem fim)
  const onScrollDeck = useCallback((e) => {
    const el = e.currentTarget;
    if (!semMais.current && !poucos && el.scrollLeft + el.clientWidth >= el.scrollWidth - el.clientWidth * 1.2) buscarMais();
  }, [poucos, buscarMais]);
  const votar = useCallback((rec, voto) => {
    avaliarReceita(rec.nome, voto, { desc: rec.desc, usa: rec.usa, foto: rec.foto }).catch(() => {});
    vistos.current.add(rec.nome);
    setAcoes((a) => ({ ...a, [rec.nome]: voto > 0 ? 'up' : 'down' }));
    if (voto > 0) setGuardadas((g) => (g && !g.some((x) => x.nome === rec.nome)) ? [{ nome: rec.nome, desc: rec.desc, usa: rec.usa, foto: rec.foto, foto_url: rec.foto_url }, ...g] : g);
  }, []);
  const remover = useCallback((rec) => { avaliarReceita(rec.nome, -1).catch(() => {}); setGuardadas((g) => (g || []).filter((x) => x.nome !== rec.nome)); }, []);
  const carregarImportadas = useCallback(() => { listarReceitasImportadas().then(setImportadas).catch(() => setImportadas([])); }, []);
  const importar = useCallback(async (url) => {
    const u = String(url || '').trim();
    if (!/^https?:\/\/\S+/i.test(u)) { setImportErro('Cole um link válido (começa por http).'); return; }
    setImportando(true); setImportErro('');
    try { const { receita } = await importarReceitaUrl(u); setImportadas((l) => [receita, ...(l || []).filter((x) => x.id !== receita.id)]); setLinkInput(''); }
    catch { setImportErro('Não consegui importar este link.'); }
    finally { setImportando(false); }
  }, []);
  const apagarImportada = useCallback((r) => { apagarReceitaImportada(r.id).catch(() => {}); setImportadas((l) => (l || []).filter((x) => x.id !== r.id)); setWebSel(null); }, []);
  // link de receita partilhado (Android) → abre na aba "Da web" e importa sozinho
  useEffect(() => { if (!_linkPartilhado) return; const l = _linkPartilhado; _linkPartilhado = null; setAba('web'); (async () => { await importar(l); carregarImportadas(); })(); }, [importar, carregarImportadas]);
  return (
    <>
      <Ctop title="Idéias para fazer" sub="do que você tem em casa" back onBack={back} />
      <div className="rec-seg">
        <button className={aba === 'sugestoes' ? 'on' : ''} onClick={() => setAba('sugestoes')}>Sugestões</button>
        <button className={aba === 'guardadas' ? 'on' : ''} onClick={() => { setAba('guardadas'); setCatSel(null); setBusca(''); carregarGostei(); }}>Guardadas {nGostei ? <span className="b">{nGostei}</span> : null}</button>
        <button className={aba === 'web' ? 'on' : ''} onClick={() => { setAba('web'); setWebSel(null); if (importadas == null) carregarImportadas(); }}>Da web</button>
      </div>
      <div className="scrollarea rec-wrap">
        {aba === 'sugestoes' ? (
          deck && deck.length ? (
            <>
              <div className="rec-deck" onScroll={onScrollDeck}>
                {deck.map((rec) => <ReceitaCard key={rec.nome} rec={rec} acao={acoes[rec.nome]} onVoto={votar} onVer={() => {}} />)}
              </div>
            </>
          ) : deck == null ? <div className="rec-sk"><span className="sk-row" style={{ height: 330, display: 'block' }} /></div>
            : poucos ? <p className="empty">Adicione itens à despensa ou registe uma compra para receber receitas com o que você tem em casa.</p>
              : <div className="rec-sk"><span className="sk-row" style={{ height: 330, display: 'block' }} /></div>
        ) : aba === 'web' ? (
          webSel ? (
            <div className="web-det">
              <button className="rec-cat-back" onClick={() => setWebSel(null)}><Ico name="back" size={15} stroke={2.4} /> <span>Voltar</span></button>
              {webSel.foto && <img className="web-det-img" src={webSel.foto} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
              <h2 className="web-det-n">{webSel.nome || webSel.fonte}</h2>
              <div className="web-det-meta">{[webSel.tempo, webSel.porcoes].filter(Boolean).join(' · ')}{(webSel.tempo || webSel.porcoes) ? ' · ' : ''}<a href={webSel.url} target="_blank" rel="noreferrer">{webSel.site_nome || webSel.fonte}</a></div>
              {webSel.ingredientes?.length > 0 && (<><h3 className="web-det-h">Ingredientes</h3><ul className="web-det-ing">{webSel.ingredientes.map((x, k) => <li key={k}>{x}</li>)}</ul></>)}
              {webSel.preparo ? (<><h3 className="web-det-h">Modo de preparo</h3><div className="web-det-prep">{webSel.preparo.split('\n').filter(Boolean).map((p, k) => <p key={k}>{p}</p>)}</div></>)
                : webSel.bruto ? (<><h3 className="web-det-h">Descrição</h3><div className="web-det-prep">{webSel.bruto.split('\n').filter(Boolean).map((p, k) => <p key={k}>{p}</p>)}</div></>) : null}
              {!webSel.ingredientes?.length && !webSel.preparo && !webSel.bruto && <p className="empty">Não consegui ler os detalhes desta página — abra a fonte original.</p>}
              <div className="web-det-acts"><a className="cbtn cbtn-leaf" href={webSel.url} target="_blank" rel="noreferrer">Abrir original</a><button className="cbtn cbtn-ghost" onClick={() => apagarImportada(webSel)}>Apagar</button></div>
            </div>
          ) : (
            <>
              <div className="web-import">
                <input value={linkInput} onChange={(e) => setLinkInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') importar(linkInput); }} placeholder="Cole o link de uma receita…" inputMode="url" aria-label="Link da receita" />
                <button onClick={() => importar(linkInput)} disabled={importando}>{importando ? '…' : 'Importar'}</button>
              </div>
              {importErro && <p className="web-erro">{importErro}</p>}
              <p className="web-dica">Ou use <b>Compartilhar → BigBag</b> no navegador do celular para salvar sozinho.</p>
              {importadas == null ? <div className="rec-sk"><span className="sk-row" style={{ height: 84, display: 'block' }} /></div>
                : importadas.length === 0 ? <p className="empty">Nenhuma receita da web ainda. Cole um link acima — ou compartilhe uma página de receita para o BigBag.</p>
                : importadas.map((r) => <LinhaWeb key={r.id} r={r} onAbrir={setWebSel} onRemover={apagarImportada} />)}
              {importadas?.length > 0 && <p className="web-dica" style={{ marginTop: 10 }}>Arraste um cartão para o lado para apagar.</p>}
            </>
          )
        ) : (
          guardadas == null ? <div className="rec-sk"><span className="sk-row" style={{ height: 84, display: 'block' }} /></div>
            : guardadas.length === 0 ? <p className="empty">Ainda não guardou receitas. Nas Sugestões, deslize ↑ (ou toque 👍) nas que gostar.</p>
            : (
              <>
                <div className="rec-busca">
                  <Ico name="search" size={17} stroke={2} />
                  <input value={busca} onChange={(e) => { setBusca(e.target.value); setCatSel(null); }} placeholder="Buscar receita guardada…" aria-label="Buscar receita guardada" />
                  {busca && <button className="rec-busca-x" title="Limpar" onClick={() => setBusca('')}><Ico name="close" size={14} stroke={2.6} /></button>}
                </div>
                {busca.trim() ? (() => {
                  const q = busca.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
                  const res = guardadas.filter((r) => `${r.nome || ''} ${(r.usa || []).join(' ')}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q));
                  return res.length ? res.map((rec) => (
                    <div className="rec-saved" key={rec.nome}>
                      <img className="rec-saved-img" src={fotoReceita(rec)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                      <div className="rec-saved-b"><div className="rec-saved-n">{rec.nome}</div>{rec.usa?.length > 0 && <div className="rec-saved-u">{rec.usa.slice(0, 4).join(' · ')}</div>}</div>
                      <button className="rec-saved-x" title="Remover das guardadas" onClick={() => remover(rec)}><Ico name="close" size={16} stroke={2.4} /></button>
                    </div>
                  )) : <p className="empty">Nenhuma receita guardada encontrada.</p>;
                })() : (catSel && guardadas.some((r) => catReceita(r) === catSel)) ? (() => {
                  const cat = [...REC_CATS, REC_CAT_OUTROS].find((c) => c.id === catSel);
                  return (
                    <>
                      <button className="rec-cat-back" onClick={() => setCatSel(null)}><Ico name="back" size={15} stroke={2.4} /> <span>{cat?.emoji} {cat?.label}</span></button>
                      <div className="rec-carousel">
                        {guardadas.filter((r) => catReceita(r) === catSel).map((rec) => (
                          <div className="rec-ccard" key={rec.nome}>
                            <img className="rec-ccard-img" src={fotoReceita(rec)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                            <button className="rec-ccard-x" title="Remover das guardadas" onClick={() => remover(rec)}><Ico name="close" size={15} stroke={2.6} color="#fff" /></button>
                            <div className="rec-ccard-b">
                              <div className="rec-ccard-n">{rec.nome}</div>
                              {rec.usa?.length > 0 && <div className="rec-ccard-u">{rec.usa.slice(0, 6).join(' · ')}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="rec-hint">deslize na horizontal para folhear</div>
                    </>
                  );
                })() : (
                  <>
                    <div className="rec-cats-h"><h3>Categorias</h3></div>
                    <div className="rec-cats">
                      {[...REC_CATS, REC_CAT_OUTROS]
                        .map((c) => ({ ...c, n: guardadas.filter((r) => catReceita(r) === c.id).length }))
                        .filter((c) => c.n > 0)
                        .map((c) => (
                          <button className="rec-cat" key={c.id} onClick={() => setCatSel(c.id)}>
                            <span className="rec-cat-badge">{c.n}</span>
                            <span className="rec-cat-ic"><CatIco id={c.id} /></span>
                            <span className="rec-cat-l">{c.label}</span>
                          </button>
                        ))}
                    </div>
                  </>
                )}
              </>
            )
        )}
      </div>
    </>
  );
}

/* ── CONSULTAR PRODUTO: Código (barras) · Produto (foto ao vivo) ─────────── */
/* ── CONSULTAR REMÉDIO (Brasil) — preço nas farmácias ────────────────────── */
const FARM_NOME = {
  paguemenos: 'Pague Menos', saojoaofarmacias: 'São João', extrafarma: 'Extrafarma', drogariavenancio: 'Venâncio',
  drogal: 'Drogal', drogasmil: 'Drogasmil', drogariaglobo: 'Drogaria Globo', drogariarosario: 'Rosário',
  farmaciaindiana: 'Indiana', catarinense: 'Catarinense', farmais: 'Farmais', farmaconde: 'Farma Conde',
  drogariamoderna: 'Drogaria Moderna', farmagora: 'Farmagora', precopopular: 'Preço Popular',
  drogasil: 'Drogasil', pacheco: 'Pacheco', drogariasaopaulo: 'Drogaria São Paulo',
};
const nomeFarm = (f) => FARM_NOME[f] || (f ? f.charAt(0).toUpperCase() + f.slice(1) : '—');
// rótulo da apresentação (forma + dosagem) e unidade da embalagem (un/ml/g).
const unidEmb = (forma) => (/solu|xarope|susp|gota|elixir|colir|spray|aeros/i.test(forma || '') ? 'ml' : /creme|pomada|gel|pasta|po\b|granulad/i.test(forma || '') ? 'g' : 'un');

function Remedios({ back, standalone }) {
  const [q, setQ] = useState('');
  const [sug, setSug] = useState([]);        // marcas (1 por remédio)
  const [marca, setMarca] = useState(null);  // marca escolhida (cabeçalho)
  const [cat, setCat] = useState(null);      // catálogo hierárquico da marca (/catalogo)
  const [catBusy, setCatBusy] = useState(false);
  const [aberta, setAberta] = useState(null);// ean da apresentação expandida (acordeão)
  const [verSemOferta, setVerSemOferta] = useState(false); // colapsa a cauda SEM_OFERTA
  const [info, setInfo] = useState(null);    // EAN escolhido → ficha rica (scan / "detalhes")
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const [scan, setScan] = useState(false);
  const [usuario, setUsuario] = useState(null); // sessão OIDC (null = não logado) — só p/ acompanhar
  const [folha, setFolha] = useState(null);  // apresentação a acompanhar (abre a folha)
  const [toast, setToast] = useState('');
  const videoRef = useRef(null);
  const tmr = useRef(null);

  // sessão (para o "acompanhar"); ver é livre, isto não bloqueia nada
  useEffect(() => { let on = true; oidcUser().then((u) => { if (on) setUsuario(u && !u.expired ? u : null); }).catch(() => {}); return () => { on = false; }; }, []);
  useEffect(() => { if (!toast) return undefined; const id = setTimeout(() => setToast(''), 2600); return () => clearTimeout(id); }, [toast]);

  function limpar() { setQ(''); setSug([]); setMarca(null); setCat(null); setAberta(null); setVerSemOferta(false); setInfo(null); setErro(''); }
  function onTxt(v) {
    setQ(v); setInfo(null); setMarca(null); setCat(null); setAberta(null); setVerSemOferta(false); setErro('');
    clearTimeout(tmr.current);
    const t = v.trim();
    if (t.length < 3) { setSug([]); return; }
    tmr.current = setTimeout(() => {
      buscarMedicamento(t).then((d) => setSug(d.resultados || [])).catch(() => setSug([]));
    }, 220);
  }
  // escolher uma marca → carrega o CATÁLOGO hierárquico (apresentações c/ rótulo de força curado)
  async function escolherMarca(b) {
    setMarca(b); setInfo(null); setCat(null); setAberta(null); setVerSemOferta(false); setSug([]); setErro(''); setCatBusy(true);
    try {
      const d = await catalogoMedicamento(b.produto);
      if (!d || !d.apresentacoes?.length) setErro('Não encontrei as apresentações desta marca.');
      else setCat(d);
    } catch { setErro('Não consegui carregar agora. Tente de novo.'); }
    finally { setCatBusy(false); }
  }
  // ficha rica (imagem + "para que serve" + preço/frete ao vivo) — usada pelo scan e pelo link "detalhes"
  async function abrir(ean) {
    setScan(false); setSug([]); setBusy(true); setErro('');
    try {
      const d = await infoMedicamento(ean);
      if (!d) setErro('Esse código não está na nossa base de medicamentos (CMED).');
      else { setInfo(d); setQ(d.identidade?.produto || ''); }
    } catch { setErro('Não consegui consultar agora. Tente de novo.'); }
    finally { setBusy(false); }
  }
  // câmara: lê o código de barras → abre a ficha do remédio
  useEffect(() => {
    if (!scan) return undefined;
    let leitor; setErro('');
    (async () => { leitor = await lerCodigoBarras(videoRef.current, (cod) => abrir(cod), () => setErro('Câmera indisponível.')); })();
    return () => leitor?.stop?.();
  }, [scan]); // eslint-disable-line react-hooks/exhaustive-deps

  // pediu p/ acompanhar: logado → folha de baseline; senão → folha de login (ver continua livre)
  function pedirAcompanhar(apz) { setFolha({ apz, modo: usuario ? 'baseline' : 'login' }); }

  return (
    <>
      {standalone
        ? <header className="rx-top"><span className="rx-mk"><Mk size={30} /></span><div className="rx-tt"><span><b>BigBag</b> Remédios</span><span className="rx-sub">compare o preço nas farmácias do Brasil</span></div></header>
        : <Ctop title="Consultar remédio" sub="preço nas farmácias" back onBack={back} />}
      <div className="scrollarea">
        <div className="med-search">
          <span className="med-si"><Ico name="search" size={18} stroke={2.2} /></span>
          <input className="med-inp" value={q} placeholder="Nome do remédio (ex.: dipirona)" onChange={(e) => onTxt(e.target.value)} autoFocus />
          {q && <button className="med-x" onClick={limpar} aria-label="limpar">×</button>}
        </div>
        <button className={`med-scan ${scan ? 'on' : ''}`} onClick={() => { setInfo(null); setMarca(null); setCat(null); setScan((s) => !s); }}>
          <Ico name="scan" size={20} stroke={2.2} /> {scan ? 'Fechar câmera' : 'Ler código de barras'}
        </button>

        {scan && <div className="med-cam"><video ref={videoRef} playsInline muted /><div className="med-cam-h">Aponte para o código de barras</div></div>}

        {/* FICHA RICA — pelo scan ou pelo link "ver com frete e detalhes" */}
        {info ? (
          <>
            <button className="med-back" onClick={() => setInfo(null)}><Ico name="back" size={15} stroke={2.4} /> {cat?.marca || marca?.produto || 'voltar'}</button>
            <FichaRemedio info={info} abrir={abrir} />
          </>
        /* NÍVEL 2 — apresentações da marca (CATÁLOGO: rótulo de força, programa, acompanhar) */
        ) : marca ? (
          <>
            <button className="med-back" onClick={() => { setMarca(null); setCat(null); setAberta(null); }}><Ico name="back" size={15} stroke={2.4} /> voltar à busca</button>
            <div className="med-var-h">
              <div className="med-var-t">{(cat?.marca || marca.produto)}{marca.generico ? <span className="med-gen">genérico</span> : null}</div>
              {(cat?.substancia || marca.substancia) && <div className="med-var-s">{[cat?.substancia || marca.substancia, cat?.tarja].filter(Boolean).join(' · ')}</div>}
            </div>
            {catBusy && <p className="empty">Carregando apresentações…</p>}
            {cat && (() => {
              // COM_OFERTA sempre visíveis; a cauda SEM_OFERTA (força a curar, sem preço) colapsa
              // num expander para não virar uma parede de linhas idênticas. Não esconde — só recolhe.
              const card = (a) => (
                <ApresentacaoCard key={a.ean} apz={a}
                  aberta={aberta === a.ean} onToggle={() => setAberta((x) => (x === a.ean ? null : a.ean))}
                  onAcompanhar={() => pedirAcompanhar(a)} onDetalhes={() => abrir(a.ean)} />
              );
              const comOferta = cat.apresentacoes.filter((a) => a.estado === 'COM_OFERTA');
              const semOferta = cat.apresentacoes.filter((a) => a.estado !== 'COM_OFERTA');
              return (
                <>
                  <div className="med-lbl">Apresentações <span className="med-lbl-s">por força clínica</span></div>
                  <div className="med-apz-list">
                    {comOferta.map(card)}
                    {semOferta.length > 0 && (
                      <>
                        <button className="med-semof-toggle" onClick={() => setVerSemOferta((v) => !v)} aria-expanded={verSemOferta}>
                          {verSemOferta ? '−' : '+'}{semOferta.length} apresentaç{semOferta.length > 1 ? 'ões' : 'ão'} sem oferta agora {verSemOferta ? '▴' : '▾'}
                        </button>
                        {verSemOferta && semOferta.map(card)}
                      </>
                    )}
                  </div>
                  <p className="med-obs">Apresentações ordenadas por força clínica (não por preço). Só informação e preço — <b>não é aconselhamento médico</b>.</p>
                </>
              );
            })()}
          </>
        /* NÍVEL 1 — uma entrada por remédio (marca) */
        ) : !busy && sug.length > 0 ? (
          <div className="med-sug">
            {sug.map((b) => (
              <button key={b.produto} className="med-row" onClick={() => escolherMarca(b)}>
                <div className="med-rt">{b.produto}{b.generico ? <span className="med-gen">genérico</span> : null}</div>
                <div className="med-rs">{[b.substancia, `${b.n_apresentacoes} apresentaç${b.n_apresentacoes > 1 ? 'ões' : 'ão'}`].filter(Boolean).join(' · ')}</div>
                <div className="med-rp"><span className="med-apartir">a partir de</span>{fmtPreco(b.menor_preco, 'BRL')}</div>
              </button>
            ))}
          </div>
        ) : null}

        {busy && <p className="empty">Consultando…</p>}
        {erro && <p className="empty">{erro}</p>}
      </div>

      {folha && <FolhaAcompanhar folha={folha} marca={cat?.marca || marca?.produto}
        onClose={() => setFolha(null)} onToast={setToast}
        onEntrar={() => { try { sessionStorage.setItem('bigbag_post_login', '/remedios'); } catch { /* noop */ } oidcLogin(); }} />}
      {toast && <div className="rx-toast">{toast}</div>}
    </>
  );
}

// Rótulo de estoque/frescor por farmácia: SÓ o booleano `disponivel` (o qtd_estoque traz
// sentinela 99999 do VTEX — nunca exibir como número). `frescor_h` → "há Xh"/"há Nd".
const frescorLabel = (h) => (h == null ? '' : h < 1 ? 'agora' : h < 48 ? `há ${Math.round(h)}h` : `há ${Math.round(h / 24)}d`);
// Agrega os sinais de programa por NOME (não tudo num balde): { nome → nº de farmácias }.
function programasPorNome(farmacias) {
  const m = new Map();
  for (const f of farmacias) if (f.programa?.nome) m.set(f.programa.nome, (m.get(f.programa.nome) || 0) + 1);
  return [...m.entries()].map(([nome, n]) => ({ nome, n }));
}

// Cartão de uma apresentação (acordeão): título = rótulo de força HUMANO; COM_OFERTA expande
// p/ as farmácias + acompanhar; SEM_OFERTA fica rebaixada. "força a curar" → badge âmbar.
function ApresentacaoCard({ apz, aberta, onToggle, onAcompanhar, onDetalhes }) {
  const comOferta = apz.estado === 'COM_OFERTA';
  const aCurar = apz.rotulo_forca === 'força a curar';
  const farmacias = apz.farmacias || [];
  const menor = farmacias.length ? Math.min(...farmacias.map((f) => f.preco)) : null;
  return (
    <div className={`med-apz ${comOferta ? '' : 'med-apz-off'} ${aberta ? 'on' : ''}`}>
      <button className="med-apz-h" onClick={comOferta ? onToggle : undefined} disabled={!comOferta} aria-expanded={aberta}>
        <div className="med-apz-l">
          <div className="med-apz-t">
            {aCurar ? 'Força a confirmar' : apz.rotulo_forca}
            {aCurar && <span className="med-badge-curar">força a confirmar</span>}
          </div>
          <div className="med-apz-s">{apz.qtd_efetiva ? `${apz.qtd_efetiva} ${unidEmb(apz.forma || '')}` : ''}{apz.papel === 'inicio' ? ' · dose de início' : ''}</div>
        </div>
        <div className="med-apz-r">
          {comOferta
            ? <><span className="med-apartir">a partir de</span><span className="med-apz-p">{fmtPreco(menor, 'BRL')}</span><span className="med-apz-cv">{farmacias.length} farmácia{farmacias.length > 1 ? 's' : ''} {aberta ? '▴' : '▾'}</span></>
            : <span className="med-apz-na">sem oferta agora</span>}
        </div>
      </button>
      {comOferta && aberta && (
        <div className="med-apz-body">
          <ListaFarmacias farmacias={farmacias} />
          <div className="med-apz-acts">
            <button className="rx-btn-leaf" onClick={onAcompanhar}><Ico name="bell" size={15} stroke={2.3} /> Acompanhar preço</button>
            <button className="rx-btn-ghost" onClick={onDetalhes}>Ver com frete e detalhes →</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Farmácias de uma apresentação: chip de programa AGREGADO por nome no topo (postura 2,
// qualitativo, SEM número) + ponto 💊 por farmácia; preço normal e `preco_cond` (NÚMERO real
// publicado pela farmácia) são DISTINTOS do chip de programa.
function ListaFarmacias({ farmacias }) {
  const progs = programasPorNome(farmacias);
  const temCond = farmacias.some((f) => f.preco_cond != null && f.preco_cond > 0);
  return (
    <>
      {progs.length > 0 && (
        <div className="med-prog">
          <div className="med-prog-h">💊 {progs.map((p, i) => <span key={p.nome}>{i > 0 ? ' · ' : ''}Programa <b>{p.nome}</b> em {p.n} farmácia{p.n > 1 ? 's' : ''}</span>)}</div>
          <div className="med-prog-d">Desconto do laboratório à parte do preço abaixo — <b>cadastre-se na farmácia</b>; o valor final aparece no balcão. Não é o preço listado aqui.</div>
        </div>
      )}
      {farmacias.map((o) => (
        <div className={`med-of2 ${o.disponivel === false ? 'med-of2-eis' : ''}`} key={o.fonte}>
          <div className="med-of2-l">
            <span className="med-of-f">{o.programa?.nome ? <span className="med-prog-dot" title={`Tem programa ${o.programa.nome}`}>💊</span> : null}{nomeFarm(o.fonte)}</span>
            <span className="med-of2-sub">
              {o.disponivel === false ? <span className="med-of2-na">esgotada</span> : null}
              {o.frescor_h != null ? <span className="med-of2-fr">atualizado {frescorLabel(o.frescor_h)}</span> : null}
            </span>
          </div>
          <div className="med-of2-r">
            <span className="med-of-p">{fmtPreco(o.preco, 'BRL')}</span>
            {o.preco_cond != null && o.preco_cond > 0 && o.preco_cond < o.preco
              ? <span className="med-of2-cond">pode chegar a {fmtPreco(o.preco_cond, 'BRL')}<span className="med-of2-condt">condicional</span></span> : null}
          </div>
        </div>
      ))}
      {temCond && <p className="med-obs2"><b>Pode chegar a R$X</b> = preço com desconto que a própria farmácia publica (condicional, ex.: 1ª compra). Diferente do 💊 programa do laboratório acima, cujo valor só aparece no cadastro/balcão.</p>}
    </>
  );
}

// Folha "acompanhar": não-logado → convite a entrar (ver continua livre); logado → baseline
// DECLARADO com a MEDIANA de mercado pré-preenchida (aceita/corrige) → cria o monitor (dry-run).
function FolhaAcompanhar({ folha, marca, onClose, onEntrar, onToast }) {
  const { apz, modo } = folha;
  const [sug, setSug] = useState(null);   // { mediana, menor, n_ofertas }
  const [val, setVal] = useState('');     // texto do baseline (R$)
  const [mexeu, setMexeu] = useState(false);
  const [carregando, setCarregando] = useState(modo === 'baseline');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  useEffect(() => {
    if (modo !== 'baseline') return undefined;
    let on = true;
    sugestaoMonitor(apz.ean).then((d) => { if (!on) return; setSug(d); const base = d.mediana ?? d.menor; if (base != null) setVal(String(base).replace('.', ',')); })
      .catch(() => { if (on) setErro('Não consegui sugerir um preço agora — pode digitar o seu.'); })
      .finally(() => { if (on) setCarregando(false); });
    return () => { on = false; };
  }, [modo, apz.ean]);
  const parseVal = (s) => { const n = Number(String(s).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };
  async function confirmar() {
    const baseline = parseVal(val);
    if (baseline == null) { setErro('Informe um preço válido.'); return; }
    setSalvando(true); setErro('');
    const sugerida = sug && (sug.mediana ?? sug.menor);
    const origem = !mexeu && sugerida != null && Math.abs(baseline - sugerida) < 0.005 ? 'aceito_sugerido' : 'declarado';
    try { await criarMonitor({ ean: apz.ean, baseline, origem }); onClose(); onToast('Acompanhando este preço ✓'); }
    catch (e) { setErro(String(e?.message).includes('401') || String(e?.message).includes('403') ? 'Sua sessão expirou — entre de novo.' : 'Não consegui salvar agora. Tente de novo.'); setSalvando(false); }
  }
  return (
    <div className="rx-sheet-bg" onClick={onClose}>
      <div className="rx-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="rx-sheet-grip" />
        {modo === 'login' ? (
          <>
            <div className="rx-sheet-t">Entre para acompanhar</div>
            <p className="rx-sheet-p">Ver os preços é livre. Para <b>acompanhar</b> um remédio, entre na sua conta — guardamos qual remédio você acompanha, por isso pede login.</p>
            <button className="rx-btn-leaf wide" onClick={onEntrar}>Entrar para acompanhar</button>
            <button className="rx-btn-ghost wide" onClick={onClose}>Agora não</button>
          </>
        ) : (
          <>
            <div className="rx-sheet-t">Acompanhar {marca}</div>
            <div className="rx-sheet-sub">{apz.rotulo_forca}{apz.qtd_efetiva ? ` · ${apz.qtd_efetiva} ${unidEmb(apz.forma || '')}` : ''}</div>
            <p className="rx-sheet-p">Qual preço você costuma pagar? Avisamos quando ficar bem abaixo desse valor. {carregando ? '' : sug?.mediana != null ? 'Sugerimos a mediana de mercado — aceite ou corrija.' : 'Digite o seu valor de referência.'}</p>
            <div className="rx-base">
              <span className="rx-base-c">R$</span>
              <input className="rx-base-i" value={carregando ? '' : val} placeholder={carregando ? 'calculando…' : '0,00'} inputMode="decimal"
                onChange={(e) => { setVal(e.target.value); setMexeu(true); }} disabled={carregando} aria-label="preço de referência" autoFocus />
            </div>
            {sug && sug.n_ofertas > 0 && <div className="rx-base-hint">Mediana de mercado: {fmtPreco(sug.mediana, 'BRL')} · menor hoje {fmtPreco(sug.menor, 'BRL')} ({sug.n_ofertas} farmácias com estoque)</div>}
            {erro && <div className="rx-sheet-err">{erro}</div>}
            <button className="rx-btn-leaf wide" onClick={confirmar} disabled={carregando || salvando}>{salvando ? 'Salvando…' : 'Acompanhar'}</button>
            <button className="rx-btn-ghost wide" onClick={onClose}>Cancelar</button>
            <p className="rx-sheet-fine">Você define o preço de referência. Ainda não enviamos notificações — por enquanto só guardamos o que você acompanha.</p>
          </>
        )}
      </div>
    </div>
  );
}

const CEP_REF = '22241040'; // CEP de referência (Rio) p/ o frete; trocável depois
const cepFmt = (c) => { const d = String(c || '').replace(/\D/g, ''); return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : c; };
function FichaRemedio({ info, abrir }) {
  const id = info.identidade || {};
  const m = info.melhor, cmp = info.comparacao;
  const [vivo, setVivo] = useState(null);
  const [carregVivo, setCarregVivo] = useState(true);
  const [cep, setCep] = useState(() => { try { return localStorage.getItem('bigbag_cep') || CEP_REF; } catch { return CEP_REF; } });
  const [cepEdit, setCepEdit] = useState(cepFmt(cep));
  function onCep(v) {
    setCepEdit(v);
    const d = v.replace(/\D/g, '').slice(0, 8);
    if (d.length === 8 && d !== cep) { setCep(d); try { localStorage.setItem('bigbag_cep', d); } catch { /* noop */ } }
  }
  const [expl, setExpl] = useState(null);
  useEffect(() => {
    let on = true; setVivo(null); setCarregVivo(true);
    precosAoVivo(info.ean, cep).then((d) => { if (on) setVivo(d); }).catch(() => {}).finally(() => { if (on) setCarregVivo(false); });
    return () => { on = false; };
  }, [info.ean, cep]);
  useEffect(() => {
    let on = true; setExpl(null);
    explicacaoMedicamento(info.ean).then((d) => { if (on && d && d.para_que_serve) setExpl(d); }).catch(() => {});
    return () => { on = false; };
  }, [info.ean]);
  const bulaUrl = `https://consultas.anvisa.gov.br/#/bulario/q/?nomeProduto=${encodeURIComponent(id.produto || '')}`;
  const best = vivo && vivo.melhor_entrega && vivo.melhor_entrega.entrega ? vivo.melhor_entrega : null;
  const listaAll = vivo && vivo.fontes && vivo.fontes.length ? vivo.fontes : (info.ofertas || []);
  // com CEP, esconde quem NÃO entrega ali (mantém quem entrega p/ pedidos maiores).
  const lista = vivo ? listaAll.filter((o) => o.entrega || o.frete_gratis_maiores) : listaAll;
  const ocultas = vivo ? listaAll.length - lista.length : 0;
  // URL do produto por farmácia (do cache /info; o caminho ao-vivo não a traz) → card clicável p/ o site.
  const urlPorFonte = {};
  (info.ofertas || []).forEach((o) => { if (o.url) urlPorFonte[o.fonte] = o.url; });
  return (
    <div className="med-ficha">
      {info.imagem && <div className="med-img"><img src={info.imagem} alt={id.produto || 'remédio'} loading="lazy" onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }} /></div>}
      <div className="med-head">
        <div className="med-htop">
          <span className="med-htt">{id.produto}</span>
          {id.generico ? <span className="med-gen">genérico</span> : id.tipo ? <span className="med-tipo">{id.tipo}</span> : null}
        </div>
        {id.substancia && <div className="med-hsub">{id.substancia}</div>}
        <div className="med-hap">{[id.apresentacao, id.laboratorio].filter(Boolean).join(' · ')}</div>
        {id.registro_fmt && <div className="med-hreg">Registro ANVISA {id.registro_fmt}</div>}
      </div>

      {expl && (
        <div className="med-expl">
          <div className="med-expl-h">💡 Para que serve <span className="med-expl-t">em linguagem simples</span></div>
          <p className="med-expl-p">{expl.para_que_serve}</p>
          {expl.como_usar && <p className="med-expl-l"><b>Como usar:</b> {expl.como_usar}</p>}
          {expl.cuidados && <p className="med-expl-l"><b>Cuidados:</b> {expl.cuidados}</p>}
          <p className="med-expl-d">Resumo automático com base no princípio ativo — <b>não substitui a bula nem a orientação médica</b>. <a href={bulaUrl} target="_blank" rel="noreferrer">Ver bula oficial (ANVISA) ↗</a></p>
        </div>
      )}

      {best ? (
        <div className="med-best">
          <div className="med-best-k">Mais barato com entrega · agora</div>
          <div className="med-best-p">{fmtPreco(best.total, 'BRL')}</div>
          <div className="med-best-f">em <b>{nomeFarm(best.fonte)}</b> · produto {fmtPreco(best.preco, 'BRL')} + frete {fmtPreco(best.frete, 'BRL')}{best.prazo ? ` (${best.prazo})` : ''}</div>
          {cmp && cmp.pct_vs_pmc != null && cmp.pct_vs_pmc > 0 && <div className="med-best-pmc">{cmp.pct_vs_pmc}% abaixo do teto legal (PMC {fmtPreco(cmp.pmc, 'BRL')})</div>}
        </div>
      ) : m ? (
        <div className="med-best">
          <div className="med-best-k">Mais barato {carregVivo ? '(atualizando…)' : ''}</div>
          <div className="med-best-p">{fmtPreco(m.preco, 'BRL')}</div>
          <div className="med-best-f">em <b>{nomeFarm(m.fonte)}</b></div>
          {cmp && cmp.pct_vs_pmc != null && cmp.pct_vs_pmc > 0 && <div className="med-best-pmc">{cmp.pct_vs_pmc}% abaixo do teto legal (PMC {fmtPreco(cmp.pmc, 'BRL')})</div>}
        </div>
      ) : <p className="empty">Sem preço nas farmácias que colhemos.</p>}

      {info.melhor_cond && (
        <div className="med-cond">
          <div className="med-cond-h">💊 Pode chegar a <b>{fmtPreco(info.melhor_cond.preco_cond, 'BRL')}</b> na {nomeFarm(info.melhor_cond.fonte)}</div>
          <div className="med-cond-o">{info.melhor_cond.preco_cond_obs} — preço normal {fmtPreco(info.melhor_cond.preco, 'BRL')}. Este desconto é <b>condicional</b> e pode não valer para todos.</div>
        </div>
      )}

      {(lista.length > 0 || vivo || carregVivo) && (
        <>
          <div className="med-lbl">Preço por farmácia (com frete)</div>
          <div className="med-cep">
            <span className="med-cep-l">📍 Entrega no CEP</span>
            <input className="med-cep-i" value={cepEdit} onChange={(e) => onCep(e.target.value)} placeholder="00000-000" inputMode="numeric" maxLength={9} aria-label="CEP de entrega" />
            {carregVivo ? <span className="med-cep-s">calculando…</span> : vivo ? <span className="med-cep-s ok">agora</span> : null}
          </div>
          {lista.map((o) => {
            const href = o.url || urlPorFonte[o.fonte]; // ao-vivo não traz url → fallback do cache (mesma fonte)
            const inner = (
              <>
                <div className="med-of2-l">
                  <span className="med-of-f">{nomeFarm(o.fonte)}{href ? <span className="med-of2-go" aria-hidden="true">↗</span> : null}</span>
                  {vivo ? (o.entrega ? <span className="med-of2-sub">+ frete {fmtPreco(o.frete, 'BRL')}{o.prazo ? ` · ${o.prazo}` : ''}</span>
                    : o.retira ? <span className="med-of2-na">só retirada na loja</span> : <span className="med-of2-na">não entrega aqui</span>) : null}
                  {vivo && (o.frete_gratis_acima || o.frete_gratis_maiores) ? <span className="med-of2-fg">🚚 frete grátis acima de {o.frete_gratis_acima ? fmtPreco(o.frete_gratis_acima, 'BRL') : `~${fmtPreco(o.frete_gratis_sub, 'BRL')}`}</span> : null}
                </div>
                <div className="med-of2-r">
                  {vivo && o.entrega && o.total != null
                    ? <><span className="med-of2-total">{fmtPreco(o.total, 'BRL')}</span><span className="med-of2-prod">prod. {fmtPreco(o.preco, 'BRL')}</span></>
                    : <span className="med-of-p">{fmtPreco(o.preco, 'BRL')}</span>}
                </div>
              </>
            );
            return href
              ? <a className="med-of2 med-of2-link" key={o.fonte} href={href} target="_blank" rel="noopener noreferrer" title={`Abrir ${nomeFarm(o.fonte)}`}>{inner}</a>
              : <div className="med-of2" key={o.fonte}>{inner}</div>;
          })}
          {vivo && lista.length === 0 && <p className="empty">Nenhuma farmácia entrega neste CEP — tente outro CEP.</p>}
          {ocultas > 0 && <p className="med-obs2">{ocultas} {ocultas > 1 ? 'farmácias não entregam' : 'farmácia não entrega'} neste CEP (ocultada{ocultas > 1 ? 's' : ''}).</p>}
          <p className="med-obs">Preço e frete capturados <b>agora</b> nas farmácias, para entrega no CEP acima. Os valores podem mudar a qualquer momento — confirme no site da farmácia antes de comprar. Só informação e preço, <b>não é aconselhamento médico</b>.</p>
        </>
      )}

      {info.outras_embalagens && info.outras_embalagens.length > 1 && (
        <>
          <div className="med-lbl">Outras embalagens <span className="med-lbl-s">mesmo remédio, tamanhos diferentes</span></div>
          {info.outras_embalagens.map((e) => (
            <button key={e.ean} className={`med-eq ${e.referencia ? 'ref' : ''}`} onClick={() => !e.referencia && abrir(e.ean)} disabled={e.referencia}>
              <div className="med-eq-n">{e.qtd_embalagem ? `${e.qtd_embalagem} ${unidEmb(e.forma)}` : e.produto}{e.referencia ? <span className="med-atual">este</span> : null}</div>
              <div className="med-eq-r">
                <span className="med-eq-p">{fmtPreco(e.menor_preco, 'BRL')}</span>
                {e.preco_por_dose != null && <span className="med-eq-d">{fmtPreco(e.preco_por_dose, 'BRL')}/{unidEmb(e.forma)}</span>}
              </div>
            </button>
          ))}
          <p className="med-note">Preço por {unidEmb(id.forma)} para comparar os tamanhos. Só informação e preço — não é aconselhamento médico.</p>
        </>
      )}

      {info.equivalentes && info.equivalentes.length > 0 && (
        <>
          <div className="med-lbl">Equivalentes <span className="med-lbl-s">outras marcas, mesma substância e apresentação</span></div>
          {info.equivalentes.map((e) => (
            <button key={e.ean} className="med-eq" onClick={() => abrir(e.ean)}>
              <div className="med-eq-n">{e.produto}{e.generico ? <span className="med-gen">genérico</span> : null}</div>
              <div className="med-eq-r">
                <span className="med-eq-p">{fmtPreco(e.menor_preco, 'BRL')}</span>
                {e.preco_por_dose != null && <span className="med-eq-d">{fmtPreco(e.preco_por_dose, 'BRL')}/{unidEmb(e.forma)}</span>}
              </div>
            </button>
          ))}
          <p className="med-note">Mesma substância, força e forma ({id.forma || 'mesma forma'}{id.dosagem ? ` ${id.dosagem}` : ''}) — preço por {unidEmb(id.forma)} comparável. Confirme a troca com o farmacêutico. Só informação e preço — não é aconselhamento médico.</p>
        </>
      )}
    </div>
  );
}

function Scanner({ go, back, somente, itemId, nomeItem, paraLista, paraComparar, addCmp, k }) { // itemId: identificar linha do talão; paraLista: ADICIONAR à lista; paraComparar: ADICIONAR ao cesto de comparação
  const [modo, setModo] = useState('codigo');
  // CONSULTA default (sem fluxo de tarefa) → mostra a régua de navegação; o scan vem da régua,
  // por isso o botão "Código" sai da barra de métodos e a régua reabre sempre no modo código (k).
  const naRegua = !itemId && !paraLista && !paraComparar;
  useEffect(() => { setModo('codigo'); setFoto(null); }, [k]); // toque no scan da régua → volta ao código
  const [erro, setErro] = useState(false);
  const [luz, setLuz] = useState(false);
  const [temLuz, setTemLuz] = useState(false);
  const [foto, setFoto] = useState(null); // null=pré-visualizar · {fase:'procurando'|'resultados'|'nada'|'erro'|'semcam', cands?}
  const [idLoad, setIdLoad] = useState(false); // a identificar (ligar EAN à linha)
  const [chk, setChk] = useState(false);       // a verificar se o EAN existe
  const [registo, setRegisto] = useState(null); // EAN desconhecido → cadastro: {ean, fotos:[], semcam?, erro?, naoLido?}
  const [regBusy, setRegBusy] = useState(false);
  const [anIdx, setAnIdx] = useState(0);       // foto a mostrar no "Analisando" (cicla as várias)
  // URLs das fotos do cadastro (criadas 1×; revogadas ao mudar) — evita leak do createObjectURL inline
  const fotoUrls = useMemo(() => (registo?.fotos || []).map((f) => URL.createObjectURL(f)), [registo?.fotos]);
  useEffect(() => () => fotoUrls.forEach((u) => URL.revokeObjectURL(u)), [fotoUrls]);
  // enquanto ANALISA (pode demorar), cicla pelas várias fotos tiradas — passa o tempo
  useEffect(() => {
    if (!regBusy || (registo?.fotos?.length || 0) < 2) { setAnIdx(0); return undefined; }
    const id = setInterval(() => setAnIdx((i) => (i + 1) % registo.fotos.length), 1400);
    return () => clearInterval(id);
  }, [regBusy, registo?.fotos?.length]);
  const videoRef = useRef(null);
  const trackRef = useRef(null);
  const fotoVideoRef = useRef(null);
  const code = modo === 'codigo';
  const previewFoto = !code && foto == null && !idLoad && !registo; // câmara da foto (consulta)
  const camFoto = previewFoto || !!registo;                          // câmara de fotos: consulta OU cadastro
  // ao ler/captar: se for identificação (itemId), LIGA o EAN à linha do talão. Em
  // CONSULTA, verifica se o EAN existe; se NÃO, oferece CADASTRO por foto (VLM) em
  // vez de abrir uma ficha vazia (caso: filtros de café sem cadastro).
  const aoCodigo = async (cod) => {
    if (itemId) {
      setIdLoad(true);
      try { await identificarProduto({ ean: cod, itemId }); } catch { /* segue à ficha */ }
      go('ficha', { ean: cod, nome: nomeItem }, { replace: true }); return;
    }
    setChk(true);
    try {
      // BASE LOCAL primeiro: se conhecemos o EAN (catálogo PT/Mercadona/off PT pré-carregado),
      // resolve INSTANTÂNEO/OFFLINE sem ir ao servidor. Telemetria: hit só se há NOME local
      // utilizável (um registo sem nome é, na prática, um miss).
      const fl = await fichaLocal(cod);
      registarHitLocal(cod, !!fl?.nome, paraLista ? 'lista' : paraComparar ? 'comparar' : 'consulta');
      if (fl?.nome) {
        // CONSULTA → ficha (a própria ficha trata o nome via /info quando online).
        if (!paraLista && !paraComparar) { go('ficha', { ean: cod }); return; }
        // LISTA/COMPARAR guardam o NOME verbatim → só usam o nome local quando é PT-fiável:
        // origem 'pt_cat' (lojas PT) ou 'uso' (já traduzido no servidor). 'merc_es'/'pt_off'
        // podem trazer nome estrangeiro → caem no caminho do servidor, que TRADUZ e persiste.
        const ptOk = fl.origem === 'pt_cat' || fl.origem === 'uso';
        if (ptOk) {
          if (paraComparar) { addCmp({ ean: cod, nome: fl.nome }); back(); return; }
          try { await adicionarListaItem({ nome: fl.nome, ean: cod }); } catch { /* outbox/sync apanha */ }
          go('lista', { destaque: cod }); return; // adicionado → volta à lista, com o item EM DESTAQUE
        }
      }
      // MODO LISTA: montar a lista tem de ser RÁPIDO. Só precisa de NOME+EAN → UMA chamada
      // (/consultar?pt=1 resolve, TRADUZ, persiste e PROMOVE a base_local → o PRÓXIMO scan deste EAN
      // é HIT local instantâneo). Salta o /info (era um 2.º round-trip só p/ a ficha rica, inútil para
      // adicionar). Offline ou EAN desconhecido → identificar por foto.
      if (paraLista) {
        let nmL = null;
        try { const c = await consultarProdutoEan(cod, { pt: true }); nmL = c?.nome || null; } catch { /* offline → foto */ }
        if (nmL) { try { await adicionarListaItem({ nome: nmL, ean: cod }); } catch { /* outbox apanha */ } go('lista', { destaque: cod }); return; } // adicionado → volta à lista, item EM DESTAQUE
        setRegisto({ ean: cod, fotos: [], naoLido: true }); return;
      }
      const info = await infoProduto({ ean: cod });
      let nm = info?.nome || info?.off?.nome || info?.vlm?.nome || info?.base?.nome;
      // NOME TRADUZIDO + PERSISTIDO via /consultar?pt=1 — para CONSULTA e COMPARAR: o /info devolve o
      // nome cru do catálogo/OFF (Mercadona-ES/Lidl-FR → "Eggs"). Isto traduz, persiste, ficha lê o PT.
      const fichaMagra = !!info?.ficha_magra;
      try { const c = await consultarProdutoEan(cod, { pt: true }); if (c?.nome) nm = c.nome; } catch { /* fica o nm do /info */ }
      // MODO COMPARAR: junta ao cesto de comparação (sem ir à ficha). Com nome → junta já;
      // sem nome → cadastro por foto e depois junta.
      if (paraComparar) {
        if (nm) { addCmp({ ean: cod, nome: nm }); back(); } // junta e VOLTA já à Comparar (sem tela intermédia)
        else setRegisto({ ean: cod, fotos: [], naoLido: true }); // não-identificado → foto p/ identificar
        return;
      }
      // CONSULTA: ficha MAGRA (sem nutrição NEM imagem — só um nome/marca, talvez só
      // DECODIFICADO do EAN) → pede FOTOS (VLM identifica), não abre uma ficha inútil.
      // Só vai à ficha quando há mesmo algo a mostrar (nutrição/imagem/entrada real).
      if (fichaMagra) { setRegisto({ ean: cod, fotos: [], naoLido: true }); return; }
      if (info?.existe || nm) { go('ficha', { ean: cod }); return; }
      setRegisto({ ean: cod, fotos: [], naoLido: true });
    } catch { if (paraLista || paraComparar) setRegisto({ ean: cod, fotos: [], naoLido: true }); else go('ficha', { ean: cod }); }
    finally { setChk(false); }
  };
  // CÓDIGO: câmara + leitura REAL (mesma função provada da v1). Pára enquanto verifica
  // (chk) ou em cadastro (registo) para não re-disparar.
  useEffect(() => {
    if (!code || chk || registo) return undefined;
    let leitor; setErro(false); setTemLuz(false); setLuz(false);
    (async () => {
      leitor = await lerCodigoBarras(videoRef.current, aoCodigo, () => setErro(true));
      const tr = leitor?.getTrack?.();
      if (tr && (tr.getCapabilities?.() || {}).torch) { trackRef.current = tr; setTemLuz(true); }
    })();
    return () => { leitor?.stop?.(); trackRef.current = null; };
  }, [code, chk, registo, go, itemId, nomeItem]);
  // PRODUTO: câmara AO VIVO dentro do app (não abre a câmara nativa). O disparo
  // captura o frame atual e envia ao reconhecimento por imagem (matchFoto da v1).
  useEffect(() => {
    if (!camFoto) return undefined;
    let stream;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
        if (fotoVideoRef.current) { fotoVideoRef.current.srcObject = stream; fotoVideoRef.current.play().catch(() => {}); }
      } catch { if (registo) setRegisto((r) => r && { ...r, semcam: true }); else setFoto({ fase: 'semcam' }); }
    })();
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
  }, [camFoto]); // eslint-disable-line react-hooks/exhaustive-deps
  // CADASTRO: acumula fotos do produto novo e envia ao VLM (identificarProduto c/ ean+fotos).
  function capturarRegisto() {
    const v = fotoVideoRef.current; if (!v || !v.videoWidth) return;
    const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight;
    cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
    try { navigator.vibrate?.(30); } catch { /* noop */ }
    cv.toBlob((blob) => { if (blob) setRegisto((r) => (r ? { ...r, fotos: [...r.fotos, new File([blob], `reg${r.fotos.length}.jpg`, { type: 'image/jpeg' })], erro: false } : r)); }, 'image/jpeg', 0.85);
  }
  async function registar() {
    if (!registo?.fotos.length || regBusy) return;
    setRegBusy(true);
    try {
      const r = await identificarProduto({ ean: registo.ean, fotos: registo.fotos });
      const nm = r?.vlm?.nome || r?.off?.nome || 'Produto';
      if (paraComparar) { addCmp({ ean: registo.ean, nome: nm }); back(); } // junta e volta já à Comparar
      else if (paraLista) { try { await adicionarListaItem({ nome: nm, ean: registo.ean }); } catch { /* outbox/sync apanha */ } setRegisto(null); go('lista', { destaque: registo.ean }); } // adicionado → volta à lista, item EM DESTAQUE
      else go('ficha', { ean: registo.ean, nome: nm }, { replace: true }); // passa o nome → a ficha não pisca "sem nome"
    } catch { setRegBusy(false); setRegisto((r) => r && { ...r, erro: true }); }
  }
  async function lanterna() {
    const tr = trackRef.current; if (!tr) return; const n = !luz;
    try { await tr.applyConstraints({ advanced: [{ torch: n }] }); setLuz(n); } catch { /* noop */ }
  }
  function capturar() {
    const v = fotoVideoRef.current; if (!v || !v.videoWidth) return;
    const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight;
    cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
    try { navigator.vibrate?.(40); } catch { /* noop */ }
    setFoto({ fase: 'procurando' });
    cv.toBlob(async (blob) => {
      if (!blob) { setFoto({ fase: 'erro' }); return; }
      const file = new File([blob], 'produto.jpg', { type: 'image/jpeg' });
      try {
        if (itemId) { // identificação por FOTO: liga a linha do talão (VLM lê EAN/rótulo) → ficha
          const r = await identificarProduto({ itemId, fotos: [file] });
          go('ficha', { ean: r?.ean || undefined, sku_id: r?.sku_id || undefined, nome: nomeItem }, { replace: true });
        } else { // consulta: reconhecimento por imagem → candidatos
          const r = await matchFoto(file);
          const cands = r.candidatos || [];
          setFoto(cands.length ? { fase: 'resultados', cands } : { fase: 'nada' });
        }
      } catch { setFoto({ fase: 'erro' }); }
    }, 'image/jpeg', 0.85);
  }
  return (
    <>
      <Ctop
        title={registo ? (paraLista || paraComparar ? 'Identificar por foto' : 'Cadastrar produto') : paraComparar ? 'Escanear para comparar' : paraLista ? 'Adicionar à lista' : itemId ? 'Identificar produto' : 'Consultar produto'}
        sub={registo ? `EAN ${registo.ean}` : itemId ? nomeItem : (code ? 'aponte para o código' : 'fotografe o produto')}
        back onBack={registo ? () => { setRegisto(null); setChk(false); } : back}
      />
      <div className="scrollarea" style={{ display: 'flex', flexDirection: 'column' }}>
        {registo ? (regBusy ? (
          // VLM a processar a(s) foto(s): animação "analisando" em vez de tela sem nome
          <div className="analisando">
            <div className="an-card">
              {fotoUrls[anIdx] && <img key={anIdx} src={fotoUrls[anIdx]} alt="produto" className="an-img" />}
              <span className="an-scan" />
            </div>
            <div className="an-txt">Analisando produto<i className="an-dots" /></div>
            <div className="sc-hint" style={{ margin: 0 }}>{registo.fotos.length > 1 ? `a ler o rótulo — foto ${anIdx + 1}/${registo.fotos.length}…` : 'a ler o rótulo — um instante…'}</div>
          </div>
        ) : (
          <>
            <div className="sc-cam photo">
              {!registo.semcam && <video ref={fotoVideoRef} playsInline muted />}
              <div className="sc-frame" />
            </div>
            {registo.fotos.length > 0 && (
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '0 0 10px', flexShrink: 0 }}>
                {registo.fotos.map((f, i) => <img key={i} src={fotoUrls[i]} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 10, border: '2px solid #fff', flex: '0 0 auto' }} />)}
              </div>
            )}
            <button className="cbtn cbtn-amber" style={{ width: '100%', marginBottom: 10, flexShrink: 0 }} onClick={capturarRegisto} disabled={registo.semcam}>
              <Ico name="camera" size={18} color="#3a2606" /> Tirar foto {registo.fotos.length ? `(${registo.fotos.length})` : ''}
            </button>
            {registo.fotos.length > 0 && (
              <button className="cbtn cbtn-leaf" style={{ width: '100%', marginBottom: 12, flexShrink: 0 }} onClick={registar}>{paraLista ? 'Identificar e adicionar' : 'Cadastrar produto'}</button>
            )}
            <div className="sc-hint">{
              registo.semcam ? 'Sem acesso à câmera — verifique a permissão.'
                : registo.erro ? (paraLista ? 'Falha ao adicionar. Tente de novo.' : 'Falha ao cadastrar. Tente de novo.')
                : registo.naoLido && !paraLista ? 'Não encontrei pelo código — vamos identificar por foto.'
                  : paraLista ? 'Fotografe a frente e o rótulo — quantas precisar.'
                    : 'Fotografe a frente e o rótulo.'
            }</div>
            {!paraLista && !registo.semcam && !registo.erro && (
              <div className="sc-hint" style={{ marginTop: 6, color: 'var(--amber-d)', fontWeight: 700 }}>
                <Ico name="spark" size={13} color="var(--amber-d)" /> Não esqueça a <b>tabela nutricional</b> (verso) — é ela que dá a análise de saúde.
              </div>
            )}
          </>
        )) : foto?.fase === 'resultados' ? (
          <>
            <p className="sc-hint" style={{ marginTop: 4 }}>Qual destes é? Toque para ver a ficha.</p>
            {foto.cands.map((c) => (
              <div className="frow" key={c.ean} onClick={() => go('ficha', { ean: c.ean, nome: c.nome })}>
                <span className="fdot" style={{ background: '#cfe0ee', overflow: 'hidden', padding: 0 }}>{c.imagem ? <img src={c.imagem} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : inicial(c.nome)}</span>
                <div className="fb"><div className="fn">{c.nome ? nomeTalao(c.nome) : c.ean}</div><div className="fs">{(c.marca && limparMarca(c.marca)) || ''}{c.score != null ? ` · ${Math.round(c.score * 100)}% parecido` : ''}</div></div>
                <span style={{ color: 'var(--ink-3)' }}>›</span>
              </div>
            ))}
            <button className="cbtn cbtn-leaf" style={{ width: '100%', marginTop: 6 }} onClick={() => setFoto(null)}><Ico name="camera" size={18} color="#f7fff2" /> Tirar outra</button>
          </>
        ) : (
          <>
            <div className={`sc-cam ${code ? '' : 'photo'}`}>
              {code && <video ref={videoRef} playsInline muted />}
              {previewFoto && <video ref={fotoVideoRef} playsInline muted />}
              {temLuz && code && <button className={`sc-torch ${luz ? 'on' : ''}`} onClick={lanterna} aria-label="Lanterna"><Ico name="torch" size={15} stroke={2} color={luz ? '#5a4410' : '#fff'} /></button>}
              {(foto?.fase === 'procurando' || idLoad || chk) && <span style={{ position: 'absolute', font: '800 15px var(--disp)', color: 'var(--ink)', background: 'rgba(251,253,246,.9)', padding: '8px 16px', borderRadius: 999 }}>{chk ? 'Verificando…' : idLoad ? 'Identificando…' : 'Reconhecendo…'}</span>}
              <div className="sc-frame">{code && <><i className="tr" /><i className="bl" /></>}</div>
              <span style={{ position: 'absolute', bottom: 12 }}><Mk size={34} /></span>
            </div>
            {previewFoto && <button className="cbtn cbtn-leaf" style={{ width: '100%', marginBottom: 12, flexShrink: 0 }} onClick={capturar}><Ico name="camera" size={18} color="#f7fff2" /> Tirar foto</button>}
            {!code && (foto?.fase === 'nada' || foto?.fase === 'erro' || foto?.fase === 'semcam') &&
              <button className="cbtn cbtn-leaf" style={{ width: '100%', marginBottom: 12, flexShrink: 0 }} onClick={() => setFoto(null)}><Ico name="camera" size={18} color="#f7fff2" /> Tentar de novo</button>}
            <div className="sc-hint">{
              foto?.fase === 'procurando' ? 'Reconhecendo o produto…'
                : foto?.fase === 'nada' ? 'Não reconheci. Tente outra foto, mais perto e com boa luz.'
                : foto?.fase === 'erro' ? 'Falha ao reconhecer. Tente de novo.'
                : foto?.fase === 'semcam' ? 'Sem acesso à câmera — verifique a permissão.'
                : erro ? 'Não consegui acessar a câmera — verifique a permissão.'
                : code ? 'É só apontar para o código de barras — eu encontro o produto.'
                : 'Enquadre o produto e toque em Tirar foto.'
            }</div>
          </>
        )}
        {!registo && (
          <div className="scanmode">
            {[
              ['codigo', 'scan', 'Código', () => { setModo('codigo'); setFoto(null); }],
              ['produto', 'photoprod', 'Foto', () => { setModo('foto'); setFoto(null); }],
              ['voz', 'mic', 'Voz', () => go('voz')],
              ['texto', 'search', 'Texto', () => go('texto')],
            ].filter(([id]) => !((naRegua || paraLista) && id === 'codigo')) // consulta E lista: o código vem do scan da régua → barra mostra só Foto·Voz·Texto
              .filter(([id]) => !somente || somente.includes(id)).map(([id, ic, lb, on]) => (
              <button key={id} className={`smode ${(id === 'codigo' && code) || (id === 'produto' && !code) ? 'on' : ''}`} onClick={on}>
                <Ico name={ic} size={24} stroke={2} /><span>{lb}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
// VOZ: grava → vozParaProduto (nome) → consultarProdutoNome → ficha (mesma
// mecânica e endpoints da v1; aqui só a UI cartoon). Toca no orbe para falar/parar.
function Voz({ go, back }) {
  const [estado, setEstado] = useState('pronto'); // pronto|gravando|ouvindo|nada|embalado|erro
  const [ouvido, setOuvido] = useState('');
  const mrRef = useRef(null);
  const streamRef = useRef(null);
  useEffect(() => () => { // limpeza ao sair: pára gravação/microfone
    try { if (mrRef.current?.state === 'recording') mrRef.current.stop(); } catch { /* noop */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);
  async function alternar() {
    if (estado === 'gravando') { mrRef.current?.stop(); return; }
    if (estado === 'ouvindo') return;
    setOuvido('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream); const pedacos = [];
      mr.ondataavailable = (e) => { if (e.data.size) pedacos.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setEstado('ouvindo');
        try {
          const { produto } = await vozParaProduto(new Blob(pedacos, { type: mr.mimeType || 'audio/webm' }));
          if (!produto) { setEstado('nada'); return; }
          setOuvido(produto);
          const r = await consultarProdutoNome(produto);
          if (r.encontrado && (r.sku_id || r.ean)) go('ficha', { sku_id: r.sku_id, ean: r.ean, nome: r.nome || produto });
          else setEstado('embalado');
        } catch { setEstado('erro'); }
      };
      mrRef.current = mr; mr.start(); setEstado('gravando');
    } catch { setEstado('erro'); setOuvido('microfone'); }
  }
  const txt = {
    pronto: 'Toque e diga o produto', gravando: 'Ouvindo… toque para parar', ouvindo: 'Reconhecendo…',
    nada: 'Não percebi. Toque e tente de novo.', embalado: `Entendi “${ouvido}” — para a ficha, leia o código de barras.`,
    erro: ouvido === 'microfone' ? 'Sem acesso ao microfone — verifique a permissão.' : 'Falha. Toque e tente de novo.',
  }[estado];
  const rec = estado === 'gravando';
  return (
    <>
      <Ctop title="Consultar por voz" sub="" back onBack={back} />
      <div className="voz-wrap">
        <button className={`voz-orb ${rec ? 'rec' : ''}`} onClick={alternar} disabled={estado === 'ouvindo'} aria-label="falar">
          <Ico name="mic" size={46} stroke={2} color="#f4fff0" />
        </button>
        <div><Mk size={60} /></div>
        <div className="voz-bubble">{txt}</div>
        {estado === 'embalado' && <button className="cbtn cbtn-leaf" onClick={() => go('scanner')}><Ico name="scan" size={18} color="#f7fff2" /> Ler código</button>}
      </div>
    </>
  );
}

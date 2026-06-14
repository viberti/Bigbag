// ──────────────────────────────────────────────────────────────────────────
// BigBag v2 — app com o design "cartoon" do handoff, ligado aos dados reais.
// MESMAS funções da v1 (reusa ../api.js), DESIGN novo (./cartoon.css, ./icons.js,
// ./brand.js). Router próprio (tela + pilha de voltar). A v1 (App.jsx) fica intacta.
// NOTA (fase protótipo): copy PT-BR embutido como no handoff; passar por i18n depois.
// ──────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { norm as normCat, singularizar } from '../../../backend/src/normaliza/categoria.js';
import {
  verificarSessao, setAuth, clearAuth, enviarFatura,
  obterLista, atualizarListaItem, listarNotas, detalhesNota, resumoGastos, gastosCategoria, listarDespensa,
  listarHistoricoProduto, registarHistoricoProduto, infoProduto, analiseProduto,
  avaliacaoPersonalizada, alternativasProduto, compararProdutos, consultarProdutoNome,
  listarPerfis, ativarPerfil, carregarPerfil, matchFoto, vozParaProduto, buscarProduto,
} from '../api.js';
import { lerCodigoBarras } from '../leitorCodigo.js';
import { ICON } from './icons.js';
import { BIGBAG_MARK } from './brand.js';
import './cartoon.css';

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

/* ── helpers ─────────────────────────────────────────────────────────────── */
const Ico = ({ name, size = 24, stroke, color }) =>
  <span style={{ display: 'inline-grid' }} dangerouslySetInnerHTML={{ __html: ICON(name, { size, stroke, color }) }} />;
const Mk = ({ size = 30, chip }) =>
  <span style={{ display: 'inline-grid' }} dangerouslySetInnerHTML={{ __html: BIGBAG_MARK({ size, chip }) }} />;
const eur = (v) => (v == null || Number.isNaN(Number(v)) ? '—' : `${Number(v).toFixed(2).replace('.', ',')} €`);
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
  lacticinios: 'Laticínios', padaria: 'Padaria', congelados: 'Congelados', bebidas: 'Bebidas',
  doces: 'Doces e snacks', mercearia: 'Mercearia', higiene: 'Higiene e limpeza', outros: 'Outros' };
const secDe = (it) => SEC_LABEL[it.grupo] || 'Outros';
const SEC_ORDER = ['Frutas e vegetais', 'Talho e charcutaria', 'Peixe e marisco', 'Padaria', 'Laticínios', 'Congelados', 'Mercearia', 'Bebidas', 'Doces e snacks', 'Higiene e limpeza', 'Outros'];
const ordSec = (s) => { const i = SEC_ORDER.indexOf(s); return i < 0 ? 99 : i; };
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
      {back ? <button className="bk" onClick={onBack}><Ico name="back" size={19} stroke={2.6} />Voltar</button>
        : <span className={`mk ${amber ? 'amber' : ''}`}><Mk size={30} /></span>}
      <div className="hi"><b dangerouslySetInnerHTML={{ __html: title }} />{sub && <span dangerouslySetInnerHTML={{ __html: sub }} />}</div>
      {action}
      {av && <span className="av" onClick={onAv}>{av}</span>}
    </div>
  );
}
function Nav({ cur, go }) {
  const tabs = [['home', 'Início', 'home'], ['list', 'Lista', 'lista'], ['history', 'Histórico', 'historico'], ['user', 'Perfil', 'perfil']];
  return (
    <div className="cnav">
      {tabs.map(([ic, lb, id]) => (
        <button key={id} className={`nb ${cur === id ? 'on' : ''}`} onClick={() => go(id)}>
          <span className="ni"><Ico name={ic} size={23} stroke={2} /></span>{lb}
        </button>
      ))}
    </div>
  );
}

/* ── auth ────────────────────────────────────────────────────────────────── */
export default function AppV2() {
  const [sessao, setSessao] = useState(undefined);
  useEffect(() => { verificarSessao().then(setSessao).catch(() => setSessao(null)); }, []);
  if (sessao === undefined) return <div className="v2"><div className="v2-load">…</div></div>;
  if (!sessao) return <LoginV2 onEntrar={setSessao} />;
  const nome = (sessao.user?.id || '').replace(/^./, (c) => c.toUpperCase());
  return <Shell nome={nome} onSair={() => { clearAuth(); setSessao(null); }} />;
}

function LoginV2({ onEntrar }) {
  const [user, setUser] = useState(''); const [pass, setPass] = useState('');
  const [erro, setErro] = useState(''); const [aEntrar, setAEntrar] = useState(false);
  async function submeter(e) {
    e.preventDefault(); setErro(''); setAEntrar(true); setAuth(user.trim(), pass);
    try { onEntrar(await verificarSessao()); } catch { clearAuth(); setErro('Usuário ou senha inválidos.'); } finally { setAEntrar(false); }
  }
  return (
    <div className="v2"><Motif />
      <form className="v2-login" onSubmit={submeter}>
        <Mk size={64} /><h1>BigBag</h1><div className="ver">v{APP_VERSION} · novo visual</div>
        <input placeholder="Usuário" value={user} onChange={(e) => setUser(e.target.value)} autoCapitalize="none" />
        <input placeholder="Senha" type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
        {erro && <div className="v2-err">{erro}</div>}
        <button className="cbtn cbtn-leaf" disabled={aEntrar || !user || !pass}>{aEntrar ? '…' : 'Entrar'}</button>
      </form>
    </div>
  );
}

/* ── shell + router ──────────────────────────────────────────────────────── */
const TABS = new Set(['home', 'lista', 'historico', 'perfil']);
function Shell({ nome, onSair }) {
  const [view, setView] = useState({ id: 'home', p: {} });
  const stack = useRef([]);
  const go = useCallback((id, p = {}) => {
    setView((cur) => {
      if (TABS.has(id)) stack.current = [];
      else if (cur.id !== id) stack.current.push(cur);
      return { id, p };
    });
  }, []);
  const back = useCallback(() => {
    setView(() => stack.current.pop() || { id: 'home', p: {} });
  }, []);
  const navCur = TABS.has(view.id) ? view.id : null;
  const common = { go, back, user: nome, onSair }; // `user` (não `nome`) p/ não colidir com o `nome` de produto nas params de tela
  const Screen = {
    home: Home, lista: Lista, historico: Historico, perfil: Perfil,
    notas: Notas, gastos: Gastos, gastoscat: GastosCat, ficha: Ficha, comparar: Comparar,
    texto: Texto, despensa: Despensa, recibo: Recibo, receitas: Receitas,
    scanner: Scanner, voz: Voz,
  }[view.id] || Home;
  return (
    <div className="v2"><Motif />
      <Screen {...common} {...view.p} />
      {navCur && <Nav cur={navCur} go={go} />}
    </div>
  );
}

/* ── INÍCIO ──────────────────────────────────────────────────────────────── */
function Home({ go, user }) {
  const [nLista, setNLista] = useState(null);
  const [notas, setNotas] = useState(null);
  useEffect(() => {
    obterLista().then((d) => setNLista((d.itens || []).filter((i) => i.estado !== 'carrinho').length)).catch(() => setNLista(null));
    listarNotas().then((n) => setNotas(n.slice(0, 2))).catch(() => setNotas([]));
  }, []);
  return (
    <>
      <Ctop title={`Olá, ${user}`} sub="vamos às compras?" av={inicial(user)} onAv={() => go('perfil')} />
      <div className="scrollarea">
        <div className="herolist" onClick={() => go('lista')}>
          <span className="mkbig"><Mk size={110} /></span>
          <div className="k">A minha lista</div>
          <div className="v">{nLista == null ? '…' : `${nLista} ${nLista === 1 ? 'produto' : 'produtos'}`}</div>
          <div className="s">na sua lista de compras</div>
          <button className="go">Ver a lista →</button>
        </div>
        <div className="quick">
          {[['scan', 'Consultar', () => go('scanner'), undefined],
            ['recipe', 'Receitas', () => go('receitas'), 'var(--coral)'],
            ['compare', 'Comparar', () => go('comparar'), undefined],
            ['talao', 'Despensa', () => go('despensa'), 'var(--amber-d)'],
            ['chart', 'Gastos', () => go('gastos'), 'var(--sky)']].map(([ic, lb, on, col]) => (
            <button key={lb} className="round-act" onClick={on}>
              <span className="circ" style={col ? { color: col } : undefined}><Ico name={ic} size={24} stroke={2} /></span><b>{lb}</b>
            </button>
          ))}
        </div>
        <div className="clabel-row"><span className="clabel">Comprado há pouco</span><button className="seeall" onClick={() => go('notas')}>Ver tudo →</button></div>
        {notas == null ? <p className="empty">…</p> : notas.length === 0 ? <p className="empty">Sem compras ainda.</p>
          : notas.map((n) => { const [c, ini] = lojaCor(n.loja || n.mercado); return (
            <div className="frow" key={n.id} onClick={() => go('recibo', { id: n.id })}>
              <span className="fdot" style={{ background: c }}>{ini}</span>
              <div className="fb"><div className="fn">{n.loja || n.mercado || 'Compra'}</div><div className="fs">{dataCurta(n.data)}{n.n_itens ? ` ·  itens` : ""}</div></div>
              <span className="fp">{eur(n.total)}</span>
            </div>); })}
      </div>
    </>
  );
}

/* ── LISTA ───────────────────────────────────────────────────────────────── */
function Lista({ go, back }) {
  const [itens, setItens] = useState(null);
  const carregar = useCallback(() => { obterLista().then((d) => setItens(d.itens || [])).catch(() => setItens([])); }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const ativos = (itens || []).filter((i) => i.estado !== 'carrinho');
  const total = ativos.reduce((a, b) => a + (b.preco_estimado || b.preco || 0), 0);
  async function delta(it, d) {
    setItens((xs) => xs.map((x) => (x.id === it.id ? { ...x, quantidade: Math.max(1, (x.quantidade || 1) + d) } : x)));
    try { await atualizarListaItem(it.id, { inc: d }); } catch { carregar(); }
  }
  const grupos = agruparSec(ativos);
  return (
    <>
      <Ctop title="A minha lista" sub="compartilhada<br>com a família" back onBack={back} />
      {total > 0 && <div className="pricetag"><span className="pt-hole" /><div className="pt-v"><b>{eur(total)}</b><small>estimado</small></div></div>}
      <div className="scrollarea">
        {itens == null ? <p className="empty">…</p> : ativos.length === 0 ? <p className="empty">Lista vazia. Toque em + para adicionar.</p>
          : grupos.map((g) => (
            <React.Fragment key={g.s}>
              <div className="sec">{g.s}</div>
              {g.itens.map((it) => {
                const un = it.unidade === 'kg' ? 'kg' : 'un';
                const ql = un === 'kg' ? `${Number(it.quantidade || 1).toFixed(1).replace('.', ',')} kg` : `${it.quantidade || 1} un`;
                return (
                  <div className="item" key={it.id}>
                    <div className="ib" onClick={() => go('ficha', { ean: it.ean, sku_id: it.sku_id, nome: it.nome })}>
                      <div className="iname">{it.nome}</div>
                      <div className="isub">{it.marca ? `${it.marca} · ` : ''}{it.preco_estimado != null || it.preco != null ? `~${eur(it.preco_estimado ?? it.preco)}` : 'sem preço'}</div>
                    </div>
                    <span className="qval">{ql}</span>
                    <div className="qty"><button onClick={() => delta(it, -1)}>−</button><button onClick={() => delta(it, 1)}>+</button></div>
                  </div>
                );
              })}
            </React.Fragment>
          ))}
      </div>
      <div className="actfoot"><div className="addbar">
        <button className="addfab scan" title="Ler código" onClick={() => go('scanner')}><Ico name="scan" size={23} stroke={2} color="#3f7a3f" /></button>
        <button className="addfab mic" title="Voz" onClick={() => go('voz')}><Ico name="mic" size={24} stroke={2} color="#f4fff0" /></button>
        <button className="addfab plus" title="Escrever" onClick={() => go('texto')}><Ico name="plus" size={24} stroke={2.4} color="#3f7a3f" /></button>
      </div></div>
    </>
  );
}

/* ── HISTÓRICO (+ comparar) ──────────────────────────────────────────────── */
function Historico({ go }) {
  const [dados, setDados] = useState(null);
  const [cmp, setCmp] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  useEffect(() => { listarHistoricoProduto(30).then(setDados).catch(() => setDados({ erro: true })); }, []);
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
      <Ctop title="Histórico" sub={cmp ? `${sel.size} selecionado(s)` : 'produtos consultados'} action={action} />
      <div className="scrollarea">
        {dados == null ? <p className="empty">…</p> : dados.erro ? <p className="empty">Não foi possível carregar.</p>
          : produtos.length === 0 ? <p className="empty">Você ainda não consultou nenhum produto.</p>
          : produtos.map((p, i) => {
            const marcado = p.ean && sel.has(p.ean);
            const onTap = cmp ? (p.ean ? () => toggle(p.ean) : undefined) : () => go('ficha', { ean: p.ean, sku_id: p.sku_id, nome: p.nome });
            return (
              <div className={`item hist ${marcado ? 'sel' : ''}`} key={`${p.ean || p.nome}-${i}`} onClick={onTap} style={cmp && !p.ean ? { opacity: .45 } : undefined}>
                {cmp && p.ean && <span className={`histcheck ${marcado ? 'on' : ''}`}>{marcado && <Ico name="check" size={14} stroke={3} color="#fff" />}</span>}
                <div className="ib"><div className="iname">{p.nome}</div><div className="isub">{p.marca || (cmp && !p.ean ? 'sem código' : 'produto')}{p.n_consultas > 1 ? ` · ${p.n_consultas}×` : ''}</div></div>
              </div>
            );
          })}
      </div>
      {cmp && sel.size >= 2 && (
        <div className="actfoot">
          <button className="cbtn cbtn-leaf" style={{ width: '100%' }} onClick={() => go('comparar', { iniciais: escolhidos.map((p) => ({ ean: p.ean, nome: p.nome })) })}>
            Comparar {sel.size} produtos
          </button>
        </div>
      )}
    </>
  );
}

/* ── COMPARAR ────────────────────────────────────────────────────────────── */
function Comparar({ back, iniciais }) {
  const [res, setRes] = useState(iniciais?.length >= 2 ? 'load' : null);
  useEffect(() => {
    if (!(iniciais?.length >= 2)) return;
    compararProdutos(iniciais.map((x) => x.ean)).then(setRes).catch(() => setRes({ erro: true }));
  }, [iniciais]);
  const nomeDe = (ean) => res?.produtos?.find((p) => String(p.ean) === String(ean))?.nome || iniciais?.find((x) => String(x.ean) === String(ean))?.nome || ean;
  const medal = (p) => (p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : `${p}º`);
  return (
    <>
      <Ctop title="Comparar" sub={iniciais?.length ? `${iniciais.length} produtos` : 'escolha 2 a 6 produtos'} back onBack={back} />
      <div className="scrollarea">
        {!iniciais?.length ? (
          <p className="empty">Abra o Histórico, toque no ícone de comparar e marque os produtos.</p>
        ) : res === 'load' ? <p className="empty">A comparar…</p> : res?.erro ? <p className="empty">Falha ao comparar.</p> : res ? (
          <>
            <div style={{ font: '800 18px var(--disp)', color: 'var(--ink)', margin: '2px 0' }}>{res.perfil ? `Melhor para ${res.perfil}` : 'Resultado'}</div>
            <div style={{ font: '500 12.5px var(--font)', color: 'var(--ink-2)', marginBottom: 12 }}>por adequação ao perfil · preço de referência</div>
            {(res.ranking || []).map((r) => (
              <div className="item" key={r.ean}>
                <div className="ib"><div className="iname">{medal(r.posicao)} {nomeDe(String(r.ean))}</div><div className="isub">{r.motivo || r.veredicto}</div></div>
                <span className={`hpill ${r.veredicto === 'evitar' || r.veredicto === 'atencao' ? 'swap' : 'good'}`}>{r.veredicto}</span>
              </div>
            ))}
            {res.resumo && <div className="parecer"><p style={{ margin: 0 }}>{res.resumo}</p></div>}
          </>
        ) : null}
      </div>
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
function Regua({ label, val, tipo }) {
  const cols = ['#7ec46a', '#cdb83e', '#e6a23c', '#e0734f'];
  const n = nivel(tipo, val);
  const lvl = n ? n[0] : -1;
  return (
    <div className="rgrow">
      <span className="rg-l">{label}</span>
      <span className="rg-v">{val == null ? '—' : `${String(val).replace('.', ',')} g`}</span>
      <span className="rg-bar">{[0, 1, 2, 3].map((i) => <span key={i} className="rg-seg" style={{ background: i === lvl ? cols[lvl] : 'var(--cream-2)' }} />)}</span>
      <span className="rg-w" style={{ color: n ? cols[lvl] : 'var(--ink-3)' }}>{n ? n[1] : ''}</span>
    </div>
  );
}
function Ficha({ go, back, ean, sku_id, nome }) {
  const [info, setInfo] = useState(null);
  const [analise, setAnalise] = useState(null);
  const [aval, setAval] = useState(null);
  const [alt, setAlt] = useState(null);
  const [open, setOpen] = useState({});
  const registado = useRef(false);
  useEffect(() => {
    registado.current = false; // novo produto → permite registar 1×
    const q = { itemId: undefined, ean, skuId: sku_id };
    infoProduto(q).then(setInfo).catch(() => setInfo({ erro: true }));
    analiseProduto(q).then((r) => setAnalise(r.analise || null)).catch(() => setAnalise(null));
    avaliacaoPersonalizada(q).then((r) => setAval(r?.perfil ? r : null)).catch(() => setAval(null));
    alternativasProduto(q).then((r) => setAlt(r?.alternativas?.length ? r : null)).catch(() => setAlt(null));
  }, [ean, sku_id]);
  // histórico: regista com o NOME REAL do produto (depois de resolver), nunca o
  // do prop (que pode ser o do utilizador herdado, ou vazio no scan só-EAN).
  useEffect(() => {
    if (registado.current || !info || info.erro) return;
    const nm = info.vlm?.nome || info.off?.nome || info.base?.nome || nome;
    if (!nm) return;
    registado.current = true;
    registarHistoricoProduto({ ean, skuId: sku_id, nome: nm, marca: info.vlm?.marca || info.off?.marca || info.base?.marca });
  }, [info, ean, sku_id, nome]);
  const nut = (() => { const s = info && !info.erro ? info : {}; return s.vlm?.nutricao_100g || s.off?.nutricao_100g || s.generico?.nutricao_100g || {}; })();
  const num = (...ks) => { for (const k of ks) { const v = nut[k]; if (v != null && !Number.isNaN(Number(v))) return Number(v); } return null; };
  const nomeProd = info?.vlm?.nome || info?.off?.nome || info?.base?.nome || nome || 'Produto';
  const grau = analise?.nutriscore?.grau ? String(analise.nutriscore.grau).toUpperCase() : null;
  const attn = aval?.avaliacao && /aten[çc]/i.test(aval.avaliacao.veredicto || aval.avaliacao.selo || '');
  const action = <button className="hist-cmp" title="Adicionar à lista" onClick={() => go('lista')}><span style={{ color: 'var(--leaf-d)' }}><Ico name="plus" size={20} stroke={2.4} /></span></button>;
  return (
    <>
      <Ctop title="Informação do produto" back onBack={back} action={action} />
      <div className="scrollarea">
        <div className="f-hero">
          <div className="f-thumb">{info?.imagem_catalogo ? <img src={info.imagem_catalogo} alt="" /> : <span style={{ display: 'grid', placeItems: 'center', height: '100%' }}><Ico name="photoprod" size={28} color="#7a93b0" /></span>}</div>
          <div className="f-name">{nomeProd}</div>
          {grau && <span className="ns-pill" style={{ background: NS_COR[grau] || '#9ec93f' }}>{grau}</span>}
        </div>

        {(aval?.avaliacao || analise?.parecer) && (
          <div className={`parecer ${attn ? 'attn' : ''}`}>
            <div className="ph">{aval?.perfil ? `Para ${aval.perfil}` : 'Parecer'}{aval?.avaliacao?.selo && <span className={`selo ${attn ? 'attn' : ''}`}>{aval.avaliacao.selo}</span>}</div>
            <p>{aval?.avaliacao?.texto || aval?.avaliacao?.parecer || analise?.parecer}</p>
          </div>
        )}

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
            {alt.alternativas.slice(0, 6).map((a, i) => (
              <div className="altx" key={i} onClick={() => go('ficha', { ean: a.ean, nome: a.nome })}>
                <div className="alt-top"><span className="alt-n">{a.nome}</span>{a.preco_por_base != null && <span className="alt-p">{eur(a.preco_por_base)}/{a.unidade_base || 'kg'}</span>}</div>
              </div>
            ))}
          </div>
        )}

        <div className="accbox">
          {(() => { const ing = info?.vlm?.ingredientes || info?.off?.ingredientes; return ing ? (
            <>
              <button className={`acc ${open.ing ? 'open' : ''}`} onClick={() => setOpen((o) => ({ ...o, ing: !o.ing }))}><span>Ingredientes</span><Ico name="chevron" size={16} stroke={2.6} /></button>
              {open.ing && <div className="acc-body"><p>{ing}</p>{(info?.vlm?.alergenios || info?.off?.alergenios) && <div className="alerg">⚠ Alergénios: <b>{info?.vlm?.alergenios || info?.off?.alergenios}</b></div>}</div>}
            </>
          ) : null; })()}
          <button className={`acc ${open.aval ? 'open' : ''}`} onClick={() => setOpen((o) => ({ ...o, aval: !o.aval }))}><span>Como avaliamos</span><Ico name="chevron" size={16} stroke={2.6} /></button>
          {open.aval && <div className="acc-body"><div className="fontes">Dados nutricionais e Nutri-Score do <b>Open Food Facts</b>; ingredientes lidos do rótulo por IA; limiares do semáforo segundo a FSA (Reino Unido), por 100 g.<br /><i>Informação factual. Não é aconselhamento de saúde.</i></div></div>}
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
          : busy && !produtos.length ? <p className="empty">A procurar…</p>
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
                  <div className="fb"><div className="fn">{p.nome}</div><div className="fs">{[p.marca, p.tamanho].filter(Boolean).join(' · ')}</div></div>
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
function Despensa({ go, back }) {
  const [itens, setItens] = useState(null);
  useEffect(() => { listarDespensa().then((d) => setItens(d || [])).catch(() => setItens([])); }, []);
  const grupos = agruparSec(itens || []);
  return (
    <>
      <Ctop title="Tenho em casa" sub={itens ? `${itens.length} itens` : ''} back onBack={back} amber />
      <div className="scrollarea">
        {itens == null ? <p className="empty">…</p> : itens.length === 0 ? <p className="empty">Despensa vazia. Escaneie um produto.</p>
          : grupos.map((g) => (
            <React.Fragment key={g.s}>
              <div className="sec amber">{g.s}</div>
              {g.itens.map((it) => (
                <div className="item" key={it.ean} onClick={() => go('ficha', { ean: it.ean, nome: it.nome })}>
                  <div className="ib"><div className="iname">{it.nome}</div><div className="isub">{it.tamanho || it.marca || ''}</div></div>
                </div>
              ))}
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
function Notas({ go, back }) {
  const [notas, setNotas] = useState(null);
  const [filtro, setFiltro] = useState('todas');
  const [enviando, setEnviando] = useState(false);
  const fileRef = useRef(null);
  const carregar = useCallback(() => { listarNotas().then(setNotas).catch(() => setNotas([])); }, []);
  useEffect(() => { carregar(); }, [carregar]);
  async function lerTalao(e) {
    const f = e.target.files?.[0]; if (!f) return; setEnviando(true);
    try { await enviarFatura(f, 'v2'); carregar(); } catch { /* falha silenciosa */ } finally { setEnviando(false); e.target.value = ''; }
  }
  const lista = notas || [];
  const nomeLoja = (n) => n.loja || n.mercado || 'Outro';
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
        {notas == null ? <p className="empty">…</p> : filt.length === 0 ? <p className="empty">Sem talões ainda.</p>
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
      <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={lerTalao} />
      <button className="fab-talao" onClick={() => fileRef.current?.click()}>
        <span className="c"><Ico name="camera" size={20} stroke={2.2} color="#f4fff0" /></span>{enviando ? 'A ler…' : 'Ler talão'}
      </button>
    </>
  );
}

/* ── ANÁLISE DE GASTOS (+ "Em que gastou" por tipo de item) ──────────────── */
const mesCurto = (m) => { const s = MES[(Number(m) || 1) - 1] || ''; return s.charAt(0).toUpperCase() + s.slice(1); };
// grupo (lente de loja) → categoria de exibição + cor (carne+peixe fundem em "Talho e peixe")
const CAT_INFO = {
  frutas: ['Frutas e vegetais', '#5a9f57'], lacticinios: ['Laticínios', '#67b2c9'], mercearia: ['Mercearia', '#e6a23c'],
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
  return Object.values(m).map((t) => { // rótulo da PALAVRA ORIGINAL (mantém acentos), plural simples
    const base = t.orig.charAt(0).toUpperCase() + t.orig.slice(1);
    return { ...t, label: t.prods.length > 1 && !/s$/i.test(base) ? base + 's' : base };
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
      <div className="fb"><div className="fn">{p.nome}</div><div className="fs">{p.n > 1 ? `${p.n}× compras` : '1 compra'}{p.marca ? ` · ${p.marca}` : ''}</div></div>
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
  const nota = d?.nota; const itens = d?.itens || [];
  const [c, ini] = lojaCor(nota?.loja || nota?.mercado);
  return (
    <>
      <Ctop title="Talão" back onBack={back} />
      <div className="scrollarea">
        {d == null ? <p className="empty">…</p> : d.erro ? <p className="empty">Não foi possível carregar.</p> : (
          <>
            <div className="rec-band"><span className="fdot" style={{ background: c, width: 46, height: 46, borderRadius: 13, font: '800 16px var(--disp)' }}>{ini}</span>
              <div><div style={{ font: '800 16px var(--disp)', color: 'var(--ink)' }}>{nota?.loja || nota?.mercado || 'Compra'}</div><div style={{ font: '600 12.5px var(--font)', color: 'var(--ink-2)' }}>{nota?.data || ''} · {itens.length} itens</div></div>
              <span className="rec-tot">{eur(nota?.total)}</span></div>
            {itens.map((p, i) => (
              <div className="rec-item" key={i} onClick={() => go('ficha', { ean: p.ean, nome: p.nome || p.descricao })}>
                <span className="ri-nm">{p.nome || p.descricao}</span><span className="ri-q">{p.quantidade || ''}</span><span className="ri-p">{eur(p.preco || p.preco_liquido)}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}

/* ── PERFIL ──────────────────────────────────────────────────────────────── */
function Perfil({ user }) {
  const [perfis, setPerfis] = useState(null);
  const [texto, setTexto] = useState(''); const [aGuardar, setAGuardar] = useState(false); const [msg, setMsg] = useState('');
  const carregar = useCallback(() => { listarPerfis().then(setPerfis).catch(() => setPerfis([])); }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const ativo = (perfis || []).find((p) => p.ativo) || (perfis || [])[0];
  async function guardar() {
    if (!texto.trim() || aGuardar) return; setAGuardar(true); setMsg('');
    try { await carregarPerfil({ nome: ativo?.nome || user, texto: texto.trim() }); setTexto(''); setMsg('Perfil guardado.'); carregar(); }
    catch { setMsg('Falha ao guardar.'); } finally { setAGuardar(false); }
  }
  return (
    <>
      <Ctop title="Perfil nutricional" sub="membro ativo" />
      <div className="scrollarea">
        <div className="parecer" style={{ background: 'var(--card)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="m-av" style={{ background: 'var(--leaf-soft)', color: 'var(--leaf-d)', border: 0 }}>{inicial(ativo?.nome || user)}</span>
            <div><div style={{ font: '800 17px var(--disp)', color: 'var(--ink)' }}>{ativo?.nome || user}</div><div style={{ font: '500 12.5px var(--font)', color: 'var(--ink-2)' }}>perfil ativo · usado nos pareceres</div></div>
          </div>
          {ativo?.resumo && <p style={{ margin: '12px 0 0', font: '500 13px/1.5 var(--font)', color: 'var(--ink)' }}>{ativo.resumo}</p>}
        </div>

        {(perfis || []).length > 0 && <>
          <div className="menu-cap">Quem está comprando</div>
          <div className="members">
            {perfis.map((p) => (
              <div className={`member ${p.ativo ? 'on' : ''}`} key={p.id} onClick={() => { ativarPerfil(p.id).then(carregar).catch(() => {}); }}>
                <div className="m-av">{inicial(p.nome)}</div><div className="m-name">{p.nome}</div><div className="m-on">{p.ativo ? 'ativo' : 'trocar'}</div>
              </div>
            ))}
            <div className="member add"><div className="m-av">+</div><div className="m-name" style={{ color: 'var(--ink-3)' }}>Membro</div></div>
          </div>
        </>}

        <div className="pf-load">
          <div className="pf-load-h"><Ico name="spark" size={16} color="var(--leaf-d)" /> Carregar perfil de saúde</div>
          <p className="pf-load-s">Cole o texto do perfil gerado pelo seu assistente. Fica ativo nas avaliações dos produtos.</p>
          <div className="pf-or"><span>cole o texto</span></div>
          <textarea className="pf-text" placeholder="Cole aqui o conteúdo do perfil…" value={texto} onChange={(e) => setTexto(e.target.value)} />
          {msg && <div style={{ font: '600 12.5px var(--font)', color: 'var(--leaf-d)', margin: '0 0 8px' }}>{msg}</div>}
          <button className="cbtn cbtn-leaf" style={{ width: '100%', marginTop: 4 }} disabled={aGuardar || !texto.trim()} onClick={guardar}>{aGuardar ? '…' : 'Guardar perfil'}</button>
        </div>
        <div className="v2-ver">BigBag · versão {APP_VERSION}</div>
      </div>
    </>
  );
}

/* ── RECEITAS (estático por enquanto) ────────────────────────────────────── */
function Receitas({ back }) {
  const cards = [['Salada de frango grelhado', 'rica em proteína · 20 min', 'linear-gradient(135deg,#cfe6b0,#a6cd8c)', '#3f7a3f'],
    ['Omelete de legumes', 'baixo açúcar · 12 min', 'linear-gradient(135deg,#f4d9b0,#e6b34a)', '#9a6a16'],
    ['Sopa de tomate caseira', 'usa o que tens na despensa', 'linear-gradient(135deg,#f3c2b0,#e0734f)', '#fff']];
  return (
    <>
      <Ctop title="Receitas" sub="para o seu perfil" back onBack={back} />
      <div className="scrollarea">
        {cards.map(([n, s, bg, col]) => (
          <div className="item" key={n} style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ height: 88, flex: '0 0 96px', background: bg, display: 'grid', placeItems: 'center', color: col }}><Ico name="recipe" size={34} stroke={2} /></div>
            <div className="ib" style={{ padding: '11px 13px' }}><div className="iname">{n}</div><div className="isub">{s}</div></div>
          </div>
        ))}
        <p className="empty">Em breve: receitas geradas a partir do seu perfil e da sua despensa.</p>
      </div>
    </>
  );
}

/* ── CONSULTAR PRODUTO: Código (barras) · Produto (foto ao vivo) ─────────── */
function Scanner({ go, back }) {
  const [modo, setModo] = useState('codigo');
  const [erro, setErro] = useState(false);
  const [luz, setLuz] = useState(false);
  const [temLuz, setTemLuz] = useState(false);
  const [foto, setFoto] = useState(null); // null=pré-visualizar · {fase:'procurando'|'resultados'|'nada'|'erro'|'semcam', cands?}
  const videoRef = useRef(null);
  const trackRef = useRef(null);
  const fotoVideoRef = useRef(null);
  const code = modo === 'codigo';
  const previewFoto = !code && foto == null; // câmara da foto ligada só na pré-visualização
  // CÓDIGO: câmara + leitura REAL (mesma função provada da v1). Lê EAN → ficha.
  useEffect(() => {
    if (!code) return undefined;
    let leitor; setErro(false); setTemLuz(false); setLuz(false);
    (async () => {
      leitor = await lerCodigoBarras(videoRef.current, (cod) => go('ficha', { ean: cod }), () => setErro(true));
      const tr = leitor?.getTrack?.();
      if (tr && (tr.getCapabilities?.() || {}).torch) { trackRef.current = tr; setTemLuz(true); }
    })();
    return () => { leitor?.stop?.(); trackRef.current = null; };
  }, [code, go]);
  // PRODUTO: câmara AO VIVO dentro do app (não abre a câmara nativa). O disparo
  // captura o frame atual e envia ao reconhecimento por imagem (matchFoto da v1).
  useEffect(() => {
    if (!previewFoto) return undefined;
    let stream;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
        if (fotoVideoRef.current) { fotoVideoRef.current.srcObject = stream; fotoVideoRef.current.play().catch(() => {}); }
      } catch { setFoto({ fase: 'semcam' }); }
    })();
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
  }, [previewFoto]);
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
      try {
        const r = await matchFoto(new File([blob], 'produto.jpg', { type: 'image/jpeg' }));
        const cands = r.candidatos || [];
        setFoto(cands.length ? { fase: 'resultados', cands } : { fase: 'nada' });
      } catch { setFoto({ fase: 'erro' }); }
    }, 'image/jpeg', 0.85);
  }
  return (
    <>
      <Ctop title="Consultar produto" sub={code ? 'aponte para o código' : 'fotografe o produto'} back onBack={back} />
      <div className="scrollarea" style={{ display: 'flex', flexDirection: 'column' }}>
        {foto?.fase === 'resultados' ? (
          <>
            <p className="sc-hint" style={{ marginTop: 4 }}>Qual destes é? Toque para ver a ficha.</p>
            {foto.cands.map((c) => (
              <div className="frow" key={c.ean} onClick={() => go('ficha', { ean: c.ean, nome: c.nome })}>
                <span className="fdot" style={{ background: '#cfe0ee', overflow: 'hidden', padding: 0 }}>{c.imagem ? <img src={c.imagem} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : inicial(c.nome)}</span>
                <div className="fb"><div className="fn">{c.nome || c.ean}</div><div className="fs">{c.marca || ''}{c.score != null ? ` · ${Math.round(c.score * 100)}% parecido` : ''}</div></div>
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
              {foto?.fase === 'procurando' && <span style={{ position: 'absolute', font: '800 15px var(--disp)', color: 'var(--ink)', background: 'rgba(251,253,246,.85)', padding: '8px 16px', borderRadius: 999 }}>A reconhecer…</span>}
              <div className="sc-frame">{code && <><i className="tr" /><i className="bl" /></>}</div>
              <span style={{ position: 'absolute', bottom: 12 }}><Mk size={34} /></span>
            </div>
            {previewFoto && <button className="cbtn cbtn-leaf" style={{ width: '100%', marginBottom: 12 }} onClick={capturar}><Ico name="camera" size={18} color="#f7fff2" /> Tirar foto</button>}
            {!code && (foto?.fase === 'nada' || foto?.fase === 'erro' || foto?.fase === 'semcam') &&
              <button className="cbtn cbtn-leaf" style={{ width: '100%', marginBottom: 12 }} onClick={() => setFoto(null)}><Ico name="camera" size={18} color="#f7fff2" /> Tentar de novo</button>}
            <div className="sc-hint">{
              foto?.fase === 'procurando' ? 'A reconhecer o produto…'
                : foto?.fase === 'nada' ? 'Não reconheci. Tente outra foto, mais perto e com boa luz.'
                : foto?.fase === 'erro' ? 'Falha ao reconhecer. Tente de novo.'
                : foto?.fase === 'semcam' ? 'Sem acesso à câmara — verifique a permissão.'
                : erro ? 'Não consegui aceder à câmara — verifique a permissão.'
                : code ? 'É só apontar para o código de barras — eu encontro o produto.'
                : 'Enquadre o produto e toque em Tirar foto.'
            }</div>
          </>
        )}
        <div className="scanmode">
          <button className={`smode ${code ? 'on' : ''}`} onClick={() => { setModo('codigo'); setFoto(null); }}><Ico name="scan" size={24} stroke={2} /><span>Código</span></button>
          <button className={`smode ${!code ? 'on' : ''}`} onClick={() => { setModo('foto'); setFoto(null); }}><Ico name="photoprod" size={24} stroke={2} /><span>Produto</span></button>
          <button className="smode" onClick={() => go('voz')}><Ico name="mic" size={24} stroke={2} /><span>Voz</span></button>
          <button className="smode" onClick={() => go('texto')}><Ico name="search" size={24} stroke={2} /><span>Texto</span></button>
        </div>
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
    pronto: 'Toque e diga o produto', gravando: 'A ouvir… toque para parar', ouvindo: 'A reconhecer…',
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

// ──────────────────────────────────────────────────────────────────────────
// BigBag v2 — superfície NOVA e independente (rota /v2 em main.jsx). MESMAS
// funções da v1 (reusa ../api.js, ../i18n.js, ../marca.js), DESIGN diferente.
// A v1 (App.jsx) fica intacta; a v2 evolui à parte até o design novo estar pronto.
//
// Este ficheiro é o ESQUELETO: auth + shell + navegação + 4 vistas. Lista, Buscar
// e Histórico já chamam o backend real (prova de que o wiring funciona). Substitui
// o markup/estilos pelo design final — a lógica de dados já está aqui.
// ──────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from 'react';
import { verificarSessao, setAuth, clearAuth, obterLista, consultar, listarHistoricoProduto } from '../api.js';
import { t } from '../i18n.js';
import { ICON } from '../marca.js';
import './v2.css';

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const Ico = ({ name, size = 22 }) => <span className="v2-ico" dangerouslySetInnerHTML={{ __html: ICON(name, { size }) }} />;

const NAV = [
  { id: 'inicio', ic: 'spark', label: 'Início' },
  { id: 'lista', ic: 'cart', label: 'Lista' },
  { id: 'buscar', ic: 'search', label: 'Buscar' },
  { id: 'historico', ic: 'historico', label: 'Histórico' },
];

export default function AppV2() {
  const [sessao, setSessao] = useState(undefined); // undefined=a verificar · null=sem sessão
  useEffect(() => { verificarSessao().then(setSessao).catch(() => setSessao(null)); }, []);
  if (sessao === undefined) return <div className="v2"><div className="v2-load">…</div></div>;
  if (!sessao) return <LoginV2 onEntrar={setSessao} />;
  const nome = (sessao.user?.id || '').replace(/^./, (c) => c.toUpperCase());
  return <ShellV2 nome={nome} onSair={() => { clearAuth(); setSessao(null); }} />;
}

function LoginV2({ onEntrar }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [erro, setErro] = useState('');
  const [aEntrar, setAEntrar] = useState(false);
  async function submeter(e) {
    e.preventDefault(); setErro(''); setAEntrar(true);
    setAuth(user.trim(), pass);
    try { onEntrar(await verificarSessao()); }
    catch { clearAuth(); setErro(t('login.invalid')); }
    finally { setAEntrar(false); }
  }
  return (
    <div className="v2">
      <form className="v2-login" onSubmit={submeter}>
        <h1>BigBag <span className="v2-tag">v2</span></h1>
        <div className="ver">v{APP_VERSION}</div>
        <input placeholder={t('login.user')} value={user} onChange={(e) => setUser(e.target.value)} autoCapitalize="none" />
        <input placeholder={t('login.pass')} type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
        {erro && <div className="v2-err">{erro}</div>}
        <button disabled={aEntrar || !user || !pass}>{aEntrar ? '…' : t('login.enter')}</button>
      </form>
    </div>
  );
}

function ShellV2({ nome, onSair }) {
  const [aba, setAba] = useState('inicio');
  return (
    <div className="v2">
      <header className="v2-top">
        <div className="v2-brand">BigBag<span className="v2-tag">v2</span></div>
        <span className="v2-sp" />
        <button className="v2-av" onClick={onSair} title={t('conta.sair')}>{(nome || '?')[0]}</button>
      </header>
      <main className="v2-main">
        {aba === 'inicio' && <Inicio nome={nome} onIr={setAba} />}
        {aba === 'lista' && <Lista />}
        {aba === 'buscar' && <Buscar />}
        {aba === 'historico' && <Historico />}
      </main>
      <nav className="v2-nav">
        {NAV.map((n) => (
          <button key={n.id} className={`v2-tab ${aba === n.id ? 'on' : ''}`} onClick={() => setAba(n.id)}>
            <Ico name={n.ic} size={22} /><span>{n.label}</span>
          </button>
        ))}
      </nav>
      <a className="v2-back" href="/">← v1</a>
    </div>
  );
}

// INÍCIO — saudação + atalhos. Carrega a lista só para um número (prova de ligação).
function Inicio({ nome, onIr }) {
  const [nLista, setNLista] = useState(null);
  useEffect(() => { obterLista().then((d) => setNLista((d.itens || []).filter((i) => i.estado !== 'carrinho').length)).catch(() => setNLista(null)); }, []);
  return (
    <>
      <h1 className="v2-h1">Olá, {nome}.</h1>
      <p className="v2-sub">Mesmo motor da v1, visual novo. (Esqueleto — ligar o resto das telas.)</p>
      <div className="v2-grid">
        <button className="v2-stat go" onClick={() => onIr('lista')}>
          <div className="n">{nLista == null ? '—' : nLista}</div>
          <div className="l">na lista de compras</div>
        </button>
        <button className="v2-stat go" onClick={() => onIr('buscar')}>
          <div className="n">＋</div>
          <div className="l">perguntar ao assistente</div>
        </button>
      </div>
      <div className="v2-card">
        <strong>Estrutura v2 pronta.</strong>
        <p className="v2-sub" style={{ margin: '8px 0 0' }}>
          Cada vista (Início · Lista · Buscar · Histórico) é um componente isolado neste ficheiro,
          reutilizando os mesmos endpoints da v1. Vai trocando o design vista a vista.
        </p>
      </div>
    </>
  );
}

// LISTA — lê /api/lista (mesmo endpoint da v1) e mostra os itens ativos.
function Lista() {
  const [estado, setEstado] = useState({ carregando: true, itens: [], erro: false });
  useEffect(() => {
    obterLista()
      .then((d) => setEstado({ carregando: false, itens: (d.itens || []).filter((i) => i.estado !== 'carrinho'), erro: false }))
      .catch(() => setEstado({ carregando: false, itens: [], erro: true }));
  }, []);
  return (
    <>
      <h1 className="v2-h1">Lista</h1>
      {estado.carregando ? <p className="v2-empty">…</p>
        : estado.erro ? <p className="v2-empty">Não foi possível carregar a lista.</p>
        : estado.itens.length === 0 ? <p className="v2-empty">Lista vazia.</p>
        : (
          <div className="v2-list">
            {estado.itens.map((it) => (
              <div className="v2-row" key={it.id}>
                <span className="nm">{it.nome}{it.marca ? <span className="mk"> {it.marca}</span> : null}</span>
                {it.quantidade > 1 && <span className="meta">×{it.quantidade}</span>}
              </div>
            ))}
          </div>
        )}
    </>
  );
}

// BUSCAR — pergunta ao assistente (mesmo /api/consulta, tool use no servidor).
function Buscar() {
  const [q, setQ] = useState('');
  const [resp, setResp] = useState('');
  const [ocupado, setOcupado] = useState(false);
  async function perguntar(e) {
    e.preventDefault();
    const p = q.trim(); if (!p || ocupado) return;
    setOcupado(true); setResp('');
    try { const out = await consultar(p); setResp(out.resposta || ''); }
    catch { setResp('Falha ao consultar.'); }
    finally { setOcupado(false); }
  }
  return (
    <>
      <h1 className="v2-h1">Buscar</h1>
      <form className="v2-ask" onSubmit={perguntar}>
        <input placeholder="Pergunte sobre os seus produtos…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="v2-btn" disabled={ocupado || !q.trim()}>{ocupado ? '…' : 'Ir'}</button>
      </form>
      {resp && <div className="v2-card"><div className="v2-answer">{resp}</div></div>}
    </>
  );
}

// HISTÓRICO — produtos consultados (mesmo /api/produto/consultados da v1).
function Historico() {
  const [estado, setEstado] = useState({ carregando: true, produtos: [], total: 0, erro: false });
  useEffect(() => {
    listarHistoricoProduto(20)
      .then((d) => setEstado({ carregando: false, produtos: d.produtos || [], total: d.total || 0, erro: false }))
      .catch(() => setEstado({ carregando: false, produtos: [], total: 0, erro: true }));
  }, []);
  return (
    <>
      <h1 className="v2-h1">Histórico{estado.total ? ` · ${estado.total}` : ''}</h1>
      {estado.carregando ? <p className="v2-empty">…</p>
        : estado.erro ? <p className="v2-empty">Não foi possível carregar.</p>
        : estado.produtos.length === 0 ? <p className="v2-empty">Você ainda não consultou nenhum produto.</p>
        : (
          <div className="v2-list">
            {estado.produtos.map((p, i) => (
              <div className="v2-row" key={`${p.ean || p.nome}-${i}`}>
                <span className="nm">{p.nome}{p.marca ? <span className="mk"> {p.marca}</span> : null}</span>
                {p.n_consultas > 1 && <span className="meta">{p.n_consultas}×</span>}
              </div>
            ))}
          </div>
        )}
    </>
  );
}

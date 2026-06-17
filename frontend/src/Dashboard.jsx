// Dashboard de GESTÃO (/dash) — BI denso, desktop. Quatro secções: visão global (KPIs),
// fontes (tabela ordenável/filtrável/pesquisável + export CSV), países (cards), custos de IA.
// Reusa a auth Basic e o cliente adminApi do Operador. Dados via /api/admin/dashboard (cacheado).
import { useEffect, useMemo, useState } from 'react';
import { verificarSessao, setAuth, clearAuth } from './api.js';
import * as adm from './adminApi.js';
import './styles.css';
import './dashboard.css';

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-PT'));
const pct = (a, b) => (b ? Math.round((Number(a) / Number(b)) * 100) : 0);
const usd = (v) => (v == null ? '—' : '$' + Number(v).toFixed(2));
const dataCurta = (iso) => String(iso || '').slice(0, 10);
const BANDEIRA = { PT: '🇵🇹', ES: '🇪🇸', FR: '🇫🇷', AT: '🇦🇹', BR: '🇧🇷', Global: '🌍', '—': '·' };

export default function Dashboard() {
  const [sessao, setSessao] = useState(undefined);
  useEffect(() => { verificarSessao().then(setSessao).catch(() => setSessao(null)); }, []);
  if (sessao === undefined) return <div className="adm-centro">carregando…</div>;
  if (!sessao) return <DashLogin onEntrar={setSessao} />;
  return <DashApp />;
}

function DashLogin({ onEntrar }) {
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [erro, setErro] = useState('');
  async function submeter(e) {
    e.preventDefault(); setErro(''); setAuth(u.trim(), p);
    try { onEntrar(await verificarSessao()); } catch { clearAuth(); setErro('Credenciais inválidas.'); }
  }
  return (
    <form className="adm-login" onSubmit={submeter}>
      <h1>📊 Dashboard</h1>
      <input placeholder="usuário" value={u} onChange={(e) => setU(e.target.value)} autoCapitalize="none" />
      <input placeholder="senha" type="password" value={p} onChange={(e) => setP(e.target.value)} />
      {erro && <div className="adm-erro">{erro}</div>}
      <button>Entrar</button>
    </form>
  );
}

function Kpi({ n, l, sub }) {
  return <div className="dash-kpi"><span className="dk-n">{n}</span><span className="dk-l">{l}</span>{sub && <span className="dk-s">{sub}</span>}</div>;
}

function DashApp() {
  const [d, setD] = useState(null); const [erro, setErro] = useState(false);
  const carregar = (forcar) => { setD(null); setErro(false); adm.dashboard(forcar).then(setD).catch(() => setErro(true)); };
  useEffect(() => { carregar(false); }, []);

  const [pais, setPais] = useState(''); const [busca, setBusca] = useState('');
  const [ord, setOrd] = useState({ col: 'produtos', dir: -1 });
  const sortBy = (col) => setOrd((o) => (o.col === col ? { col, dir: -o.dir } : { col, dir: -1 }));

  const fontes = d?.fontes || [];
  const filtradas = useMemo(() => {
    let f = fontes;
    if (pais) f = f.filter((x) => x.pais === pais);
    if (busca.trim()) { const q = busca.trim().toLowerCase(); f = f.filter((x) => `${x.fonte} ${x.plataforma}`.toLowerCase().includes(q)); }
    const { col, dir } = ord;
    return [...f].sort((a, b) => {
      const va = a[col]; const vb = b[col];
      if (typeof va === 'string' || typeof vb === 'string') return dir * String(va ?? '').localeCompare(String(vb ?? ''));
      return dir * ((Number(va) || 0) - (Number(vb) || 0));
    });
  }, [fontes, pais, busca, ord]);

  const resumo = filtradas.reduce((a, x) => ({
    produtos: a.produtos + x.produtos, eans: a.eans + x.eans, fotos: a.fotos + x.fotos,
    nut: a.nut + x.com_nutricao, ing: a.ing + x.com_ingredientes,
  }), { produtos: 0, eans: 0, fotos: 0, nut: 0, ing: 0 });

  function exportarCSV() {
    const cols = ['fonte', 'pais', 'plataforma', 'produtos', 'eans', 'fotos', 'com_nutricao', 'com_ingredientes', 'eans_unicos'];
    const linhas = [cols.join(';'), ...filtradas.map((x) => cols.map((c) => (x[c] ?? '')).join(';'))];
    const blob = new Blob(['﻿' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'bigbag-fontes.csv'; a.click();
    URL.revokeObjectURL(a.href);
  }

  const g = d?.global || {};
  const COLS = [['fonte', 'Fonte'], ['pais', 'País'], ['plataforma', 'Plataforma'], ['produtos', 'Produtos'],
    ['eans', 'EANs'], ['fotos', 'Fotos'], ['com_nutricao', 'Nutrição'], ['com_ingredientes', 'Ingredientes'], ['eans_unicos', 'EANs únicos']];

  return (
    <div className="adm dash">
      <header className="adm-top">
        <strong>📊 Bigbag · Dashboard</strong>
        <span className="dash-meta">{d?.gerado_em ? `dados de ${new Date(d.gerado_em).toLocaleString('pt-PT')}${d.cacheado ? ' (cache)' : ''}` : ''}</span>
        <button className="dash-refresh" onClick={() => carregar(true)} disabled={d == null && !erro}>↻ recalcular</button>
        <a className="adm-link" href="/">← app</a>
      </header>

      {erro ? <p className="adm-vazio">Falha a carregar o dashboard.</p>
        : d == null ? <p className="adm-vazio">a calcular o panorama… (a primeira carga pode demorar ~20 s)</p>
          : (
            <div className="dash-body">
              <h2 className="dash-h">Visão global</h2>
              <div className="dash-kpis">
                <Kpi n={fmt(g.paises_cobertos)} l="países cobertos" />
                <Kpi n={fmt(g.ean_unico_global)} l="EANs únicos (global, dedup)" sub={`OFF ${fmt(g.ean_off)} + ${fmt(g.ean_novos_retalho)} de retalho`} />
                <Kpi n={fmt(g.ean_com_nutricao)} l="EANs c/ nutrição (OFF)" sub={`+ ${fmt(g.ean_com_nutricao_catalogo)} no catálogo`} />
                <Kpi n={fmt(g.ean_catalogo)} l="EANs no catálogo (retalho)" />
              </div>

              <h2 className="dash-h">Países</h2>
              <div className="dash-paises">
                {d.paises.map((p) => (
                  <button key={p.pais} className={`dash-pais ${pais === p.pais ? 'on' : ''}`} onClick={() => setPais(pais === p.pais ? '' : p.pais)}>
                    <span className="dp-flag">{BANDEIRA[p.pais] || '·'}</span>
                    <span className="dp-nome">{p.pais === '—' ? 'outras' : p.pais}</span>
                    <span className="dp-m"><b>{fmt(p.n_fontes)}</b> fontes</span>
                    <span className="dp-m"><b>{fmt(p.eans)}</b> EANs</span>
                  </button>
                ))}
              </div>

              <div className="dash-bar-top">
                <h2 className="dash-h">Fontes de dados {pais && <span className="dash-filtro">{BANDEIRA[pais]} {pais} <button onClick={() => setPais('')}>×</button></span>}</h2>
                <input className="dash-busca" placeholder="pesquisar fonte / plataforma…" value={busca} onChange={(e) => setBusca(e.target.value)} />
                <button className="dash-csv" onClick={exportarCSV} title="Exportar a tabela visível">⤓ CSV</button>
              </div>
              <div className="dash-tabela-wrap">
                <table className="adm-tabela dash-tabela">
                  <thead><tr>{COLS.map(([c, l]) => (
                    <th key={c} className={`dash-th ${ord.col === c ? 'on' : ''} ${['fonte', 'pais', 'plataforma'].includes(c) ? '' : 'num'}`} onClick={() => sortBy(c)}>
                      {l}{ord.col === c ? (ord.dir < 0 ? ' ▾' : ' ▴') : ''}
                    </th>))}</tr></thead>
                  <tbody>
                    {filtradas.map((x) => (
                      <tr key={x.fonte}>
                        <td className="adm-it-nome">{x.fonte}</td>
                        <td>{BANDEIRA[x.pais] || ''} {x.pais}</td>
                        <td className="dash-plat">{x.plataforma}</td>
                        <td className="num">{fmt(x.produtos)}</td>
                        <td className="num">{fmt(x.eans)}</td>
                        <td className="num">{fmt(x.fotos)} <small>{pct(x.fotos, x.produtos)}%</small></td>
                        <td className="num">{fmt(x.com_nutricao)} <small>{pct(x.com_nutricao, x.produtos)}%</small></td>
                        <td className="num">{fmt(x.com_ingredientes)} <small>{pct(x.com_ingredientes, x.produtos)}%</small></td>
                        <td className="num">{x.eans_unicos == null ? '—' : fmt(x.eans_unicos)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="dash-foot">
                    <td>{filtradas.length} fontes</td><td>{pais ? BANDEIRA[pais] + ' ' + pais : 'todos'}</td><td>—</td>
                    <td className="num">{fmt(resumo.produtos)}</td><td className="num">{fmt(resumo.eans)}</td>
                    <td className="num">{fmt(resumo.fotos)}</td><td className="num">{fmt(resumo.nut)}</td><td className="num">{fmt(resumo.ing)}</td><td className="num">—</td>
                  </tr></tfoot>
                </table>
              </div>

              <DashCustos />
            </div>
          )}
    </div>
  );
}

// CUSTOS de IA — total, por operação (contexto), por modelo, evolução por dia. Período selecionável.
function DashCustos() {
  const [dias, setDias] = useState(30); const [c, setC] = useState(null);
  useEffect(() => { setC(null); adm.custos(dias).then(setC).catch(() => setC(false)); }, [dias]);
  const maxDia = Math.max(1, ...((c?.por_dia || []).map((x) => Number(x.usd) || 0)));
  return (
    <div className="dash-custos">
      <div className="dash-bar-top">
        <h2 className="dash-h">Custos de IA</h2>
        <div className="dash-periodo">{[7, 30, 365].map((dd) => <button key={dd} className={dias === dd ? 'on' : ''} onClick={() => setDias(dd)}>{dd === 365 ? 'ano' : dd + 'd'}</button>)}</div>
      </div>
      {c == null ? <p className="adm-vazio">a carregar…</p> : c === false ? <p className="adm-vazio">Falha a carregar custos.</p> : (
        <>
          <div className="dash-kpis">
            <Kpi n={usd(c.total?.usd)} l={`gasto nos últimos ${dias}d`} />
            <Kpi n={fmt(c.total?.chamadas)} l="chamadas de IA" />
            <Kpi n={usd(c.geral?.usd)} l="gasto total (histórico)" />
          </div>
          <div className="dash-custos-grid">
            <div>
              <h3 className="dash-h3">Por operação (contexto)</h3>
              <table className="adm-tabela">
                <thead><tr><th>operação</th><th className="num">chamadas</th><th className="num">custo</th><th className="num">média</th></tr></thead>
                <tbody>{(c.por_contexto || []).map((x) => (
                  <tr key={x.contexto}><td className="adm-it-nome">{x.contexto}</td><td className="num">{fmt(x.chamadas)}</td><td className="num adm-custo-usd">{usd(x.usd)}</td><td className="num"><small>{usd(x.media)}</small></td></tr>
                ))}</tbody>
              </table>
              <h3 className="dash-h3">Por modelo</h3>
              <table className="adm-tabela">
                <thead><tr><th>modelo</th><th className="num">chamadas</th><th className="num">custo</th></tr></thead>
                <tbody>{(c.por_modelo || []).map((x) => (
                  <tr key={x.modelo || '?'}><td className="adm-it-nome">{x.modelo || '—'}</td><td className="num">{fmt(x.chamadas)}</td><td className="num adm-custo-usd">{usd(x.usd)}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div>
              <h3 className="dash-h3">Evolução por dia</h3>
              <div className="dash-bars">
                {(c.por_dia || []).map((x) => (
                  <div key={x.dia} className="dash-bar">
                    <span className="db-d">{dataCurta(x.dia).slice(5)}</span>
                    <span className="db-track"><i style={{ width: `${Math.round(100 * (Number(x.usd) / maxDia))}%` }} /></span>
                    <span className="db-v">{usd(x.usd)}</span>
                    <span className="db-n">{fmt(x.chamadas)}×</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Interface do COMPRADOR (desktop): explorar produtos, ver a variação de preço
// no tempo e comparar por mercado (onde é mais barato), frequência, gasto.
import { useEffect, useState } from 'react';
import { verificarSessao, setAuth, clearAuth } from './api.js';
import * as exp from './explorarApi.js';

const eur = (v) => (v == null ? '—' : `${Number(v).toFixed(2).replace('.', ',')} €`);
const dataCurta = (iso) => {
  const s = String(iso || '').slice(0, 10);
  return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}` : '';
};

export default function Explorar() {
  const [sessao, setSessao] = useState(undefined);
  useEffect(() => {
    verificarSessao().then(setSessao).catch(() => setSessao(null));
  }, []);
  if (sessao === undefined) return <div className="ex-centro">carregando…</div>;
  if (!sessao) return <Login onEntrar={setSessao} />;
  return <Painel />;
}

function Login({ onEntrar }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [erro, setErro] = useState('');
  async function submeter(e) {
    e.preventDefault();
    setErro('');
    setAuth(u.trim(), p);
    try {
      onEntrar(await verificarSessao());
    } catch {
      clearAuth();
      setErro('Credenciais inválidas.');
    }
  }
  return (
    <form className="ex-login" onSubmit={submeter}>
      <h1>📊 Minhas compras</h1>
      <input placeholder="usuário" value={u} onChange={(e) => setU(e.target.value)} autoCapitalize="none" />
      <input placeholder="senha" type="password" value={p} onChange={(e) => setP(e.target.value)} />
      {erro && <div className="ex-erro">{erro}</div>}
      <button>Entrar</button>
    </form>
  );
}

function Painel() {
  const [q, setQ] = useState('');
  const [produtos, setProdutos] = useState([]);
  const [sel, setSel] = useState(null);
  const [det, setDet] = useState(null);

  const carregar = (busca = q) => exp.listarProdutos(busca).then((r) => setProdutos(r.produtos)).catch(() => {});
  useEffect(() => {
    carregar('');
  }, []);

  async function abrir(id) {
    setSel(id);
    setDet(null);
    setDet(await exp.carregarProduto(id));
  }

  return (
    <div className="ex">
      <header className="ex-top">
        <strong>📊 Minhas compras</strong>
        <span className="ex-sub">explorar preços e onde comprar</span>
        <a className="ex-link" href="/">
          ← app
        </a>
      </header>
      <div className="ex-2col">
        <aside className="ex-lista">
          <form
            className="ex-busca"
            onSubmit={(e) => {
              e.preventDefault();
              carregar();
            }}
          >
            <input placeholder="procurar produto…" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <ul>
            {produtos.map((p) => (
              <li key={p.id} className={p.id === sel ? 'on' : ''} onClick={() => abrir(p.id)}>
                <span className="ex-pnome">{p.nome_simplificado || p.nome_canonico}</span>
                <span className="ex-pmeta">
                  {p.n_compras}× · {p.n_lojas} {p.n_lojas === 1 ? 'loja' : 'lojas'}
                </span>
              </li>
            ))}
            {produtos.length === 0 && <li className="ex-vazio2">sem produtos</li>}
          </ul>
        </aside>

        <section className="ex-det">
          {!det ? (
            <p className="ex-vazio">Escolha um produto à esquerda.</p>
          ) : (
            <Detalhe det={det} />
          )}
        </section>
      </div>
    </div>
  );
}

function Detalhe({ det }) {
  const u = det.sku.unidade_base || 'un';
  const h = det.historico || [];
  const precos = h.map((p) => Number(p.preco));
  const min = precos.length ? Math.min(...precos) : null;
  const max = precos.length ? Math.max(...precos) : null;
  const ultimo = h.length ? Number(h[h.length - 1].preco) : null;
  const total = h.reduce((a, p) => a + Number(p.pago || 0), 0);
  const maisBarata = det.por_loja[0];

  return (
    <div className="ex-detalhe">
      <h2>{det.sku.nome_canonico}</h2>
      <div className="ex-meta">
        {det.sku.nome_simplificado ? `“${det.sku.nome_simplificado}” · ` : ''}
        {det.sku.categoria || '—'} · preço em €/{u}
      </div>

      <div className="ex-cards">
        <div className="ex-card">
          <span>último</span>
          <b>{eur(ultimo)}</b>/{u}
        </div>
        <div className="ex-card">
          <span>mín · máx</span>
          <b>
            {eur(min)} · {eur(max)}
          </b>
        </div>
        <div className="ex-card">
          <span>compras</span>
          <b>{h.length}</b>
        </div>
        <div className="ex-card">
          <span>gasto total</span>
          <b>{eur(total)}</b>
        </div>
        {maisBarata && (
          <div className="ex-card ex-card-bom">
            <span>mais barata</span>
            <b>{maisBarata.loja}</b>
            {eur(maisBarata.preco_medio)}/{u}
          </div>
        )}
      </div>

      <h3>Variação de preço (€/{u})</h3>
      <GraficoPreco pontos={h} unidade={u} />

      <h3>Por mercado</h3>
      <table className="ex-tabela">
        <thead>
          <tr>
            <th>Loja</th>
            <th>Compras</th>
            <th>Médio</th>
            <th>Mín</th>
            <th>Máx</th>
          </tr>
        </thead>
        <tbody>
          {det.por_loja.map((l, i) => (
            <tr key={l.loja} className={i === 0 ? 'ex-melhor' : ''}>
              <td>
                {i === 0 ? '🏆 ' : ''}
                {l.loja}
              </td>
              <td>{l.n}</td>
              <td>
                <b>{eur(l.preco_medio)}</b>/{u}
              </td>
              <td>{eur(l.preco_min)}</td>
              <td>{eur(l.preco_max)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Gráfico de linha simples (SVG, sem dependências) do preço ao longo do tempo.
function GraficoPreco({ pontos, unidade }) {
  if (!pontos || pontos.length === 0) return <p className="ex-vazio2">sem histórico de preço.</p>;
  const W = 660;
  const H = 240;
  const pad = 44;
  const xs = pontos.map((p) => new Date(p.data).getTime());
  const ys = pontos.map((p) => Number(p.preco));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  if (minY === maxY) {
    minY *= 0.9;
    maxY = maxY * 1.1 || 1;
  }
  const sx = (t) => (maxX === minX ? W / 2 : pad + ((W - 2 * pad) * (t - minX)) / (maxX - minX));
  const sy = (v) => H - pad - ((H - 2 * pad) * (v - minY)) / (maxY - minY);
  const linha = pontos.map((p, i) => `${sx(xs[i])},${sy(ys[i])}`).join(' ');
  const fmtD = (t) =>
    new Date(t).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const fmtP = (v) => v.toFixed(2).replace('.', ',');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ex-grafico" preserveAspectRatio="xMidYMid meet">
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} className="ex-eixo" />
      <line x1={pad} y1={pad} x2={pad} y2={H - pad} className="ex-eixo" />
      <text x={pad - 8} y={sy(maxY) + 4} className="ex-lbl" textAnchor="end">
        {fmtP(maxY)}
      </text>
      <text x={pad - 8} y={sy(minY) + 4} className="ex-lbl" textAnchor="end">
        {fmtP(minY)}
      </text>
      {pontos.length > 1 && <polyline points={linha} className="ex-linha" />}
      {pontos.map((p, i) => (
        <circle key={i} cx={sx(xs[i])} cy={sy(ys[i])} r="4.5" className={p.promo ? 'ex-pt-promo' : 'ex-pt'}>
          <title>
            {fmtD(xs[i])} · {fmtP(ys[i])} €/{unidade} · {p.loja}
            {p.promo ? ' (promo)' : ''}
          </title>
        </circle>
      ))}
      <text x={pad} y={H - pad + 18} className="ex-lbl">
        {fmtD(minX)}
      </text>
      <text x={W - pad} y={H - pad + 18} className="ex-lbl" textAnchor="end">
        {fmtD(maxX)}
      </text>
    </svg>
  );
}

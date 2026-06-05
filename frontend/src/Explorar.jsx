// Interface do COMPRADOR (desktop) — redesign "talão". Detalhe de produto:
// barra lateral (lista por categoria + pesquisa), cartão-recibo com estatísticas
// e veredito, pódio dos mercados, gráfico de variação e histórico de compras.
// Ligado à API real (/api/explorar). Tema isolado em explorar.css (.tlao).
import { useEffect, useRef, useState } from 'react';
import { verificarSessao, setAuth, clearAuth } from './api.js';
import * as exp from './explorarApi.js';
import './explorar.css';

const fmt = (v) => (v == null ? '—' : Number(v).toFixed(2).replace('.', ','));
const ddmm = (iso) => {
  const s = String(iso || '').slice(0, 10);
  return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '';
};
const ddmmaa = (iso) => {
  const s = String(iso || '').slice(0, 10);
  return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}` : '';
};
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

// categoria granular → secção coesa (igual ao carrinho) e emoji.
function secaoDe(cat) {
  const c = norm(cat);
  if (c.includes('fruta') || c.includes('legume') || c.includes('hort')) return 'Frutas e Legumes';
  if (c.includes('pao') || c.includes('padaria') || c.includes('pastelaria')) return 'Padaria';
  if (c.includes('talho') || c.includes('carne')) return 'Talho';
  if (c.includes('charcut') || c.includes('enchido') || c.includes('fiambre') || c.includes('presunto')) return 'Charcutaria';
  if (c.includes('peixe') || c.includes('marisco') || c.includes('peixaria')) return 'Peixaria';
  if (c.includes('latic') || c.includes('queijo') || c.includes('iogurte')) return 'Laticínios';
  if (c.includes('ovo')) return 'Ovos';
  if (c.includes('congel')) return 'Congelados';
  if (c.includes('bebida')) return 'Bebidas';
  if (c.includes('higiene')) return 'Higiene';
  if (c.includes('limpeza') || c.includes('detergente')) return 'Limpeza';
  if (c.includes('mercearia') || c.includes('doce') || c.includes('snack') || c.includes('cereal')) return 'Mercearia';
  return cat ? 'Mercearia' : 'Outros';
}
const EMOJI = {
  'Frutas e Legumes': '🥬',
  Padaria: '🥖',
  Talho: '🥩',
  Charcutaria: '🍖',
  Peixaria: '🐟',
  Laticínios: '🧀',
  Ovos: '🥚',
  Congelados: '🧊',
  Mercearia: '🛒',
  Bebidas: '🥤',
  Higiene: '🧼',
  Limpeza: '🧽',
  Outros: '📦',
};
const emojiDe = (cat) => EMOJI[secaoDe(cat)] || '📦';

const CORES = {
  Continente: '#e2231a',
  'Pingo Doce': '#0a8a3f',
  Lidl: '#0050aa',
  Auchan: '#e2001a',
  Minipreço: '#e94e1b',
  Minipreco: '#e94e1b',
  Aldi: '#1f3a93',
  Mercadona: '#00843d',
  Makro: '#003da5',
};
function corLoja(n) {
  if (CORES[n]) return CORES[n];
  let h = 0;
  for (const ch of String(n || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 42% 45%)`;
}

const MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MESES_FULL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const nomeMes = (mes) => {
  const [y, m] = String(mes).split('-');
  return `${MESES_FULL[+m - 1]} ${y}`;
};

// Seletor de mês/ano no estilo talão. onEscolher(null) = todos os meses.
function DatePicker({ mes, meses, onEscolher }) {
  const [aberto, setAberto] = useState(false);
  const anos = [...new Set(meses.map((x) => x.mes.slice(0, 4)))].sort();
  const [ano, setAno] = useState('');
  useEffect(() => {
    setAno(mes ? mes.slice(0, 4) : anos[anos.length - 1] || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes, aberto, meses.length]);
  const comData = new Set(meses.map((x) => x.mes));
  const i = anos.indexOf(ano);
  return (
    <div className="dp">
      <button className="dp-btn" onClick={() => setAberto((a) => !a)}>
        <span>📅 {mes ? nomeMes(mes) : 'Todos os meses'}</span>
        <span className="dp-car">▾</span>
      </button>
      {aberto && (
        <>
          <div className="dp-bd" onClick={() => setAberto(false)} />
          <div className="dp-pop">
            <div className="dp-ano">
              <button disabled={i <= 0} onClick={() => setAno(anos[i - 1])}>
                ◀
              </button>
              <b>{ano || '—'}</b>
              <button disabled={i < 0 || i >= anos.length - 1} onClick={() => setAno(anos[i + 1])}>
                ▶
              </button>
            </div>
            <div className="dp-grid">
              {MESES_PT.map((nm, k) => {
                const val = `${ano}-${String(k + 1).padStart(2, '0')}`;
                return (
                  <button
                    key={k}
                    className={`dp-mes ${mes === val ? 'on' : ''}`}
                    disabled={!comData.has(val)}
                    onClick={() => {
                      onEscolher(val);
                      setAberto(false);
                    }}
                  >
                    {nm}
                  </button>
                );
              })}
            </div>
            <button
              className="dp-todos"
              onClick={() => {
                onEscolher(null);
                setAberto(false);
              }}
            >
              Todos os meses
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ───────────────────────── logo (mascote saco) ─────────────────────────
function Logo({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-label="Bigbag" style={{ display: 'block' }}>
      <path d="M17 15 C17 7, 31 7, 31 15" stroke="#27200f" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <path
        d="M11 15 L37 15 L35.2 41 C35.1 42.7 33.8 44 32.1 44 L15.9 44 C14.2 44 12.9 42.7 12.8 41 Z"
        fill="#27200f"
      />
      <path d="M11 15 L37 15 L36.4 21.2 C36.3 22.2 35.5 23 34.5 23 L13.5 23 C12.5 23 11.7 22.2 11.6 21.2 Z" fill="#27200f" />
      <circle cx="18" cy="33" r="2.4" fill="#e0a93c" />
      <circle cx="30" cy="33" r="2.4" fill="#e0a93c" />
      <circle cx="20.5" cy="30" r="1.7" fill="#e0a93c" />
      <circle cx="27.5" cy="30" r="1.7" fill="#e0a93c" />
      <path d="M20 35.5 C22 38.4, 26 38.4, 28 35.5" stroke="#e0a93c" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

// ───────────────────────── gráfico de linha (canvas) ─────────────────────────
function desenhar(canvas, points) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || 600;
  const cssH = canvas.clientHeight || 230;
  if (!cssW || !cssH || !points.length) return;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);
  const padL = 44, padR = 16, padT = 18, padB = 28;
  const w = cssW - padL - padR, h = cssH - padT - padB;
  const vals = points.map((p) => p.y);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.18;
  min -= pad; max += pad;
  const X = (i) => padL + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const Y = (v) => padT + h - ((v - min) / (max - min)) * h;
  ctx.font = '12px "Space Mono", monospace';
  ctx.fillStyle = '#9c9075';
  ctx.textBaseline = 'middle';
  for (let t = 0; t <= 3; t++) {
    const v = min + (t / 3) * (max - min);
    const y = Y(v);
    ctx.strokeStyle = 'rgba(40,30,15,.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(cssW - padR, y);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(fmt(v), padL - 8, y);
  }
  const g = ctx.createLinearGradient(0, padT, 0, padT + h);
  g.addColorStop(0, 'rgba(224,169,60,.22)');
  g.addColorStop(1, 'rgba(224,169,60,0)');
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(X(i), Y(p.y)) : ctx.moveTo(X(i), Y(p.y))));
  ctx.lineTo(X(points.length - 1), padT + h);
  ctx.lineTo(X(0), padT + h);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(X(i), Y(p.y)) : ctx.moveTo(X(i), Y(p.y))));
  ctx.strokeStyle = '#d2542f';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
  points.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(X(i), Y(p.y), 4, 0, Math.PI * 2);
    ctx.fillStyle = '#d2542f';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fffdf7';
    ctx.stroke();
  });
  ctx.fillStyle = '#9c9075';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText(points[0].x, padL, cssH - 8);
  ctx.textAlign = 'right';
  ctx.fillText(points[points.length - 1].x, cssW - padR, cssH - 8);
}

function Grafico({ pontos }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => desenhar(c, pontos);
    const id = setTimeout(draw, 0); // não usar rAF (suspende em tab de fundo)
    let ro;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(draw);
      ro.observe(c);
    }
    return () => {
      clearTimeout(id);
      ro && ro.disconnect();
    };
  }, [pontos]);
  return <canvas ref={ref} />;
}

// ───────────────────────── estatísticas derivadas ─────────────────────────
function calcStats(det) {
  const ps = det.historico || [];
  const precos = ps.map((x) => Number(x.preco));
  const count = ps.length;
  const min = count ? Math.min(...precos) : null;
  const max = count ? Math.max(...precos) : null;
  const last = count ? ps[count - 1] : null;
  const first = count ? ps[0] : null;
  const avg = count ? precos.reduce((a, b) => a + b, 0) / count : null;
  const total = ps.reduce((a, x) => a + Number(x.pago || 0), 0);
  const trend = first && first.preco > 0 ? ((last.preco - first.preco) / first.preco) * 100 : 0;
  const stores = (det.por_loja || []).map((l) => ({ ...l, color: corLoja(l.loja) }));
  const cheapest = stores[0] || null;
  const totalQty = ps.reduce((a, x) => a + (x.preco > 0 ? Number(x.pago) / Number(x.preco) : 0), 0);
  const savings = cheapest ? total - cheapest.preco_medio * totalQty : 0;
  return { ps, count, min, max, last, first, avg, total, trend, stores, cheapest, nStores: stores.length, savings };
}

// ───────────────────────────── página ─────────────────────────────
export default function Explorar() {
  const [sessao, setSessao] = useState(undefined);
  useEffect(() => {
    verificarSessao().then(setSessao).catch(() => setSessao(null));
  }, []);
  if (sessao === undefined) return <div className="tlao"><div className="carregando">carregando…</div></div>;
  if (!sessao) return <Login onEntrar={setSessao} />;
  return <Painel />;
}

function Login({ onEntrar }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  async function submeter(e) {
    e.preventDefault();
    setAuth(u.trim(), p);
    try {
      onEntrar(await verificarSessao());
    } catch {
      clearAuth();
    }
  }
  return (
    <div className="tlao">
      <form className="tlao-login" onSubmit={submeter}>
        <div style={{ textAlign: 'center' }}>
          <Logo size={56} />
        </div>
        <input placeholder="usuário" value={u} onChange={(e) => setU(e.target.value)} autoCapitalize="none" />
        <input placeholder="senha" type="password" value={p} onChange={(e) => setP(e.target.value)} />
        <button>Entrar</button>
      </form>
    </div>
  );
}

function Painel() {
  const [produtos, setProdutos] = useState([]);
  const [q, setQ] = useState('');
  const [mes, setMes] = useState(null);
  const [meses, setMeses] = useState([]);
  const [current, setCurrent] = useState(null);
  const [det, setDet] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    exp.listarMeses().then((r) => setMeses(r.meses)).catch(() => {});
  }, []);

  // (re)carrega a lista ao mudar o mês (filtro do servidor) e seleciona o 1.º.
  useEffect(() => {
    exp.listarProdutos('', mes).then((r) => {
      setProdutos(r.produtos);
      if (r.produtos[0]) abrir(r.produtos[0].id);
      else {
        setCurrent(null);
        setDet(null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes]);

  async function abrir(id) {
    setCurrent(id);
    setDet(null);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setDet(await exp.carregarProduto(id));
  }

  const kpiTotal = produtos.reduce((a, p) => a + Number(p.total_gasto || 0), 0);

  // lista: plana filtrada (com pesquisa) ou agrupada por secção (sem pesquisa)
  const qn = norm(q);
  const filtrados = qn
    ? produtos.filter((p) => norm(p.nome_canonico).includes(qn) || norm(p.nome_simplificado).includes(qn))
    : produtos;

  let grupos = null;
  if (!qn) {
    const m = {};
    for (const p of produtos) {
      const sec = secaoDe(p.categoria);
      (m[sec] = m[sec] || []).push(p);
    }
    grupos = Object.entries(m).sort((a, b) => b[1].length - a[1].length);
  }

  const Item = (p) => (
    <div key={p.id} className={`pitem ${p.id === current ? 'on' : ''}`} onClick={() => abrir(p.id)}>
      <div className="pico">{emojiDe(p.categoria)}</div>
      <div className="pmeta">
        <div className="pname">{p.nome_canonico}</div>
        <div className="psub">
          {p.n_compras}× · {p.n_lojas} {p.n_lojas > 1 ? 'lojas' : 'loja'} · {fmt(p.ultimo_preco)} €
        </div>
      </div>
    </div>
  );

  return (
    <div className="tlao">
      <div className="hdr">
        <a className="logo-wrap" href="/" title="voltar ao app">
          <span className="logo-badge">
            <Logo size={34} />
          </span>
          <span className="wm">
            bigbag<small>cada compra fica no talão</small>
          </span>
        </a>
        <span className="spacer" />
        <div className="hstat">
          gasto acompanhado<b>{fmt(kpiTotal)} €</b>
        </div>
      </div>

      <div className="shell">
        <aside className="side">
          <div className="search">
            <input placeholder="procurar produto…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
          </div>
          <div className="dp-wrap">
            <DatePicker mes={mes} meses={meses} onEscolher={setMes} />
          </div>
          <div className="list-lbl">
            <span>A tua lista</span>
            <span className="ct">{qn ? `${filtrados.length} de ${produtos.length}` : `${produtos.length} itens`}</span>
          </div>
          <div className="plist">
            {qn ? (
              filtrados.length ? (
                filtrados.map(Item)
              ) : (
                <div className="empty">sem resultados 🤷</div>
              )
            ) : (
              grupos.map(([cat, items]) => (
                <div key={cat}>
                  <div className="cathead">
                    {cat} · {items.length}
                  </div>
                  {items.map(Item)}
                </div>
              ))
            )}
          </div>
        </aside>

        <div className="scroll" ref={scrollRef}>
          <div className="wrap">{det && <Detalhe det={det} />}</div>
        </div>
      </div>
    </div>
  );
}

function Detalhe({ det }) {
  const s = calcStats(det);
  const u = det.sku.unidade_base || 'un';
  const nome = det.sku.nome_canonico;
  const pontos = s.ps.map((x) => ({ x: ddmm(x.data), y: Number(x.preco) }));
  const medals = ['🥇', '🥈', '🥉'];
  const podium = s.stores.slice(0, 3);
  const trendUp = s.trend >= 0;

  let verdict;
  if (s.count < 2) {
    verdict = (
      <>
        <span className="tag good">NOVO</span> Ainda só {s.count} compra registada de <b>{nome}</b>.
      </>
    );
  } else if (trendUp) {
    verdict = (
      <>
        <span className="tag warn">A SUBIR</span> O preço de <b>{nome}</b> subiu <b>{Math.abs(s.trend).toFixed(0)}%</b>{' '}
        desde {ddmm(s.first.data)}.{' '}
        {s.savings > 0.5 && (
          <>
            Se comprasses sempre no <b>{s.cheapest.loja}</b>, terias poupado <b>{fmt(s.savings)} €</b>.
          </>
        )}
      </>
    );
  } else {
    verdict = (
      <>
        <span className="tag good">A DESCER</span> Boa! O <b>{nome}</b> está <b>{Math.abs(s.trend).toFixed(0)}%</b> mais
        barato que no início. O <b>{s.cheapest.loja}</b> é a tua aposta segura.
      </>
    );
  }

  return (
    <>
      <div className="receipt">
        <div className="r-top">
          <div className="r-emoji">{emojiDe(det.sku.categoria)}</div>
          <div>
            <div className="r-name">{nome}</div>
            <div className="r-cat">
              {det.sku.categoria || '—'} · €/{u}
            </div>
          </div>
        </div>
        <div className="r-lines">
          <div className="r-line">
            <span className="lbl">Último preço ({s.last ? ddmm(s.last.data) : '—'})</span>
            <span className="val big">{fmt(s.last && s.last.preco)} €</span>
          </div>
          <div className="r-line">
            <span className="lbl">Preço médio</span>
            <span className="val">{fmt(s.avg)} €</span>
          </div>
          <div className="r-line">
            <span className="lbl">Mais barato pago</span>
            <span className="val" style={{ color: 'var(--olive-d)' }}>
              {fmt(s.min)} €
            </span>
          </div>
          <div className="r-line">
            <span className="lbl">Mais caro pago</span>
            <span className="val" style={{ color: 'var(--tomato-d)' }}>
              {fmt(s.max)} €
            </span>
          </div>
          <div className="r-line">
            <span className="lbl">Compras · mercados</span>
            <span className="val">
              {s.count}× · {s.nStores}
            </span>
          </div>
        </div>
        <div className="r-total">
          <span className="lbl">Gasto total</span>
          <span className="val">{fmt(s.total)} €</span>
        </div>
        <div className="verdict">{verdict}</div>
      </div>

      <div className="right">
        <div className="card">
          <h3>Pódio dos mercados</h3>
          <div className="sub">média €/{u} · mais barato vence</div>
          <div className="podium">
            {[1, 0, 2].map((idx) => {
              const st = podium[idx];
              if (!st) return <div key={idx} />;
              return (
                <div key={idx} className={`pod ${idx === 0 ? 'first' : ''}`}>
                  <div className="medal">{medals[idx]}</div>
                  <div className="sn">{st.loja}</div>
                  <div className="pp">{fmt(st.preco_medio)} €</div>
                  <div className="ct">{st.n}× compra</div>
                </div>
              );
            })}
          </div>
          {s.stores.length > 3 && (
            <div className="otherstores">
              {s.stores.slice(3).map((st) => (
                <div className="osrow" key={st.loja}>
                  <span className="d" style={{ background: st.color }} />
                  <span className="nm">{st.loja}</span>
                  <span className="pr">{fmt(st.preco_medio)} €</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card chartcard">
        <h3>Variação de preço</h3>
        <div className="sub">
          €/{u} · de {s.first ? ddmm(s.first.data) : '—'} a {s.last ? ddmm(s.last.data) : '—'}
        </div>
        <Grafico pontos={pontos} />
      </div>

      <div className="card histcard">
        <h3>O teu talão</h3>
        <div className="sub">{s.count} compras registadas</div>
        <table className="htbl">
          <thead>
            <tr>
              <th>Data</th>
              <th>Mercado</th>
              <th className="r">Preço</th>
            </tr>
          </thead>
          <tbody>
            {s.ps
              .slice()
              .reverse()
              .map((x, i) => (
                <tr key={i}>
                  <td className="date">{ddmmaa(x.data)}</td>
                  <td>
                    <span className="store">
                      <span className="d" style={{ background: corLoja(x.loja) }} />
                      {x.loja}
                    </span>
                  </td>
                  <td className={`r mono ${Number(x.preco) === s.min ? 'lo' : Number(x.preco) === s.max ? 'hi' : ''}`}>
                    {fmt(x.preco)} €
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

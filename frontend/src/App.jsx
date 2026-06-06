import { useCallback, useEffect, useRef, useState } from 'react';
import { verificarSessao, setAuth, clearAuth, consultar, enviarFatura, enviarVoz, carregarConversa, carregarHabituais } from './api.js';
import { lerCacheHabituais, gravarCacheHabituais } from './habituaisCache.js';
import { digitalizar } from './scanner.js';
import { MARK, ICON } from './marca.js';
import { t, detetarLocale } from './i18n.js';

detetarLocale('pt-BR'); // default; usa o idioma do browser se houver dicionário

// Versão do build (hash do git + data), injetada pelo Vite. Mostrada junto ao
// logo para se ver, num relance, se o PWA está em cache antigo.
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

const eur = (v) => (v == null ? '—' : `${Number(v).toFixed(2).replace('.', ',')} €`);
const hora = () => new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
const dataHora = (ts) =>
  ts ? new Date(ts).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const dataCurta = (iso) => {
  const s = String(iso || '').slice(0, 10);
  return s ? s.slice(8, 10) + '/' + s.slice(5, 7) : '';
};
const fmtQtd = (q) => (Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/0+$/, '').replace('.', ','));

// Wrappers SVG do handoff (marca + ícones de linha).
const Mark = ({ size = 30, chip = false }) => <span className="mk" dangerouslySetInnerHTML={{ __html: MARK({ size, chip }) }} />;
const Ico = ({ name, size = 21, stroke }) => <span className="ico" dangerouslySetInnerHTML={{ __html: ICON(name, { size, stroke }) }} />;

// Realce subtil na resposta do assistente: valores em € (verde) e cadeias (menta).
const CADEIAS = /\b(Continente|Pingo Doce|Mercadona|Lidl|Aldi|Auchan|Minipre[çc]o|Makro|Intermarch[ée])\b/g;
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function realce(txt) {
  let h = escapeHtml(txt);
  h = h.replace(/(\d+(?:[.,]\d{1,2})?\s?€)/g, '<span class="eur">$1</span>');
  h = h.replace(CADEIAS, '<span class="store">$1</span>');
  return h;
}

// Chips de sugestão (arranque rápido de conversa).
const SUGESTOES = [
  { ic: 'chart', label: 'sugg.trend', q: 'sugg.trendQ' },
  { ic: 'store', label: 'sugg.cheap', q: 'sugg.cheapQ' },
  { ic: 'receipt', label: 'sugg.receipt', q: 'sugg.receiptQ' },
];

// Agrega linhas idênticas (mesmo produto E mesmo preço) somando a quantidade.
function agregarItens(itens) {
  const m = new Map();
  for (const it of itens) {
    const nome = it.produto || it.descricao_original;
    const preco = it.preco_unitario ?? it.preco_liquido;
    const key = `${nome}|${preco}`;
    const qtd = Number(it.quantidade) || 1;
    const ex = m.get(key);
    if (ex) ex.qtd += qtd;
    else m.set(key, { nome, preco, qtd });
  }
  return [...m.values()];
}

export default function App() {
  const [sessao, setSessao] = useState(undefined);
  useEffect(() => {
    verificarSessao()
      .then(setSessao)
      .catch(() => setSessao(null));
  }, []);
  if (sessao === undefined) return <div className="centro">{t('app.loading')}</div>;
  if (!sessao) return <Login onEntrar={setSessao} />;
  const nome = (sessao.user?.id || '').replace(/^./, (c) => c.toUpperCase());
  return (
    <Chat
      nome={nome}
      onSair={() => {
        clearAuth();
        setSessao(null);
      }}
    />
  );
}

function Login({ onEntrar }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [erro, setErro] = useState('');
  const [aEntrar, setAEntrar] = useState(false);

  async function submeter(e) {
    e.preventDefault();
    setErro('');
    setAEntrar(true);
    setAuth(user.trim(), pass);
    try {
      onEntrar(await verificarSessao());
    } catch {
      clearAuth();
      setErro(t('login.invalid'));
    } finally {
      setAEntrar(false);
    }
  }

  return (
    <form className="login" onSubmit={submeter}>
      <h1>🛍️ Bigbag</h1>
      <div className="versao login-versao">v{APP_VERSION}</div>
      <p className="subtitulo">{t('login.subtitle')}</p>
      <input placeholder={t('login.user')} value={user} onChange={(e) => setUser(e.target.value)} autoCapitalize="none" />
      <input placeholder={t('login.pass')} type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
      {erro && <div className="erro-txt">{erro}</div>}
      <button disabled={aEntrar || !user || !pass}>{aEntrar ? '…' : t('login.enter')}</button>
    </form>
  );
}

function Chat({ onSair, nome }) {
  const [msgs, setMsgs] = useState([
    { id: 'intro', lado: 'bot', tipo: 'resposta', texto: t('chat.intro', { nome }), hora: hora() },
  ]);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [aGravar, setAGravar] = useState(false);
  const [camAberta, setCamAberta] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  // Lista de compras (carrinho), persistida no aparelho. Itens: { nome, feito }.
  const [carrinho, setCarrinho] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('bigbag_carrinho') || '[]');
    } catch {
      return [];
    }
  });
  const [habituaisAberto, setHabituaisAberto] = useState(false);
  const [carrinhoAberto, setCarrinhoAberto] = useState(false);
  // Habituais com stale-while-revalidate: arranca da cache offline (renderiza
  // já, mesmo sem rede), e revalida em fundo quando online.
  const [habituaisLista, setHabituaisLista] = useState(() => lerCacheHabituais()?.produtos ?? null);
  const [habituaisTs, setHabituaisTs] = useState(() => lerCacheHabituais()?.ts ?? null);
  const [habituaisOffline, setHabituaisOffline] = useState(false);
  const fimRef = useRef(null);
  const fileRef = useRef(null);
  const fotoRef = useRef(null); // foto crua (escape: "Foto normal")
  const galeriaRef = useRef(null);
  const mrRef = useRef(null);
  const chunksRef = useRef([]);

  const add = (m) => setMsgs((xs) => [...xs, { id: `${xs.length}-${m.tipo}`, hora: hora(), ...m }]);
  const tiraPensar = () => setMsgs((xs) => xs.filter((m) => m.tipo !== 'pensar'));

  // Carregar a conversa anterior ao abrir (memória entre sessões).
  useEffect(() => {
    carregarConversa()
      .then((hist) => {
        if (hist.length)
          setMsgs(
            hist.map((m, i) => ({
              id: `h${i}`,
              lado: m.papel === 'user' ? 'user' : 'bot',
              tipo: m.papel === 'user' ? 'texto' : 'resposta',
              texto: m.conteudo,
              hora: m.hora,
            })),
          );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  async function perguntar(q) {
    q = (q ?? texto).trim();
    if (!q || ocupado) return;
    setTexto('');
    add({ lado: 'user', tipo: 'texto', texto: q });
    setOcupado(true);
    add({ lado: 'bot', tipo: 'pensar' });
    try {
      const out = await consultar(q);
      tiraPensar();
      add({ lado: 'bot', tipo: 'resposta', texto: out.resposta, chamadas: out.chamadas });
    } catch {
      tiraPensar();
      add({ lado: 'bot', tipo: 'erro', texto: t('err.query') });
    } finally {
      setOcupado(false);
    }
  }

  // Processa UMA nota (sem gerir `ocupado` — quem chama é que gere, para o lote).
  async function processarUma(file, { dewarp = false, origem = 'arquivo', prefixo = '', etiqueta } = {}) {
    const ehImagem = file.type?.startsWith('image/');
    add({ lado: 'user', tipo: 'ficheiro', nome: etiqueta || t('nota.enviada') });
    add({ lado: 'bot', tipo: 'pensar', texto: prefixo + (dewarp && ehImagem ? t('nota.scanning') : t('nota.reading')) });
    try {
      const enviar = dewarp && ehImagem ? await digitalizar(file) : file; // dewarp já é feito na Camera (scan)
      if (dewarp && ehImagem)
        setMsgs((xs) => xs.map((m) => (m.tipo === 'pensar' ? { ...m, texto: prefixo + t('nota.reading') } : m)));
      const out = await enviarFatura(enviar, origem);
      tiraPensar();
      if (out.erro) add({ lado: 'bot', tipo: 'erro', texto: out.detalhe || out.erro });
      else if (out.duplicada)
        add({
          lado: 'bot',
          tipo: 'resposta',
          texto: t('nota.duplicate', { loja: out.loja?.nome || out.loja?.cadeia, data: dataCurta(out.data_compra) }),
        });
      else add({ lado: 'bot', tipo: 'compra', dados: out });
    } catch {
      tiraPensar();
      add({ lado: 'bot', tipo: 'erro', texto: t('err.upload') });
    }
  }

  async function fatura(file, opts = {}) {
    if (!file || ocupado) return;
    setOcupado(true);
    try {
      await processarUma(file, opts);
    } finally {
      setOcupado(false);
    }
  }

  // Envio em lote (galeria): processa sequencialmente para não martelar a API.
  async function faturaLote(files, origem = 'galeria') {
    const lista = Array.from(files || []);
    if (!lista.length || ocupado) return;
    setOcupado(true);
    try {
      for (let i = 0; i < lista.length; i++) {
        const prefixo = lista.length > 1 ? t('cap.lote', { i: i + 1, n: lista.length }) + ' ' : '';
        const etiqueta = lista.length > 1 ? t('nota.enviadaN', { i: i + 1, n: lista.length }) : t('nota.enviada');
        await processarUma(lista[i], { dewarp: false, origem, prefixo, etiqueta });
      }
    } finally {
      setOcupado(false);
    }
  }

  async function iniciarVoz() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        setOcupado(true);
        add({ lado: 'bot', tipo: 'pensar', texto: t('voz.listening') });
        try {
          const out = await enviarVoz(blob);
          tiraPensar();
          if (out.erro) add({ lado: 'bot', tipo: 'erro', texto: out.detalhe || out.erro });
          else {
            add({ lado: 'user', tipo: 'texto', texto: out.transcricao || t('voz.audio') });
            add({ lado: 'bot', tipo: 'resposta', texto: out.resposta, chamadas: out.chamadas });
          }
        } catch {
          tiraPensar();
          add({ lado: 'bot', tipo: 'erro', texto: t('err.voice') });
        } finally {
          setOcupado(false);
        }
      };
      mrRef.current = mr;
      mr.start();
      setAGravar(true);
    } catch {
      add({ lado: 'bot', tipo: 'erro', texto: t('err.mic') });
    }
  }
  function pararVoz() {
    mrRef.current?.stop();
    setAGravar(false);
  }

  // Persiste o carrinho no aparelho a cada alteração.
  useEffect(() => {
    localStorage.setItem('bigbag_carrinho', JSON.stringify(carrinho));
  }, [carrinho]);

  const noCarrinho = (n) => carrinho.some((i) => i.nome === n);
  const alternarCarrinho = (n, categoria, preco) =>
    setCarrinho((c) => (c.some((i) => i.nome === n) ? c.filter((i) => i.nome !== n) : [...c, { nome: n, categoria, preco, feito: false }]));
  const removerDoCarrinho = (n) => setCarrinho((c) => c.filter((i) => i.nome !== n));
  const limparCarrinho = () => setCarrinho([]);

  // Revalida os habituais: busca à rede e, em sucesso, atualiza estado + cache.
  // Em falha (offline), MANTÉM a cache — nunca branqueia a lista — e sinaliza.
  const revalidarHabituais = useCallback(async () => {
    try {
      const produtos = await carregarHabituais();
      setHabituaisLista(produtos);
      setHabituaisTs(gravarCacheHabituais(produtos));
      setHabituaisOffline(false);
    } catch {
      const cache = lerCacheHabituais();
      if (cache) {
        setHabituaisLista((x) => x ?? cache.produtos);
        setHabituaisTs(cache.ts);
        setHabituaisOffline(true);
      } else {
        setHabituaisLista((x) => x ?? []);
      }
    }
  }, []);

  // Aquece a cache assim que a app abre (e o carrinho já tem secção/preço).
  useEffect(() => {
    revalidarHabituais();
  }, [revalidarHabituais]);

  function abrirHabituais() {
    setCarrinhoAberto(false);
    setHabituaisAberto(true);
    revalidarHabituais();
  }
  function abrirCarrinho() {
    setHabituaisAberto(false);
    setCarrinhoAberto(true);
    revalidarHabituais();
  }
  function novaConversa() {
    setMsgs([{ id: 'intro', lado: 'bot', tipo: 'resposta', texto: t('chat.intro', { nome }), hora: hora() }]);
  }

  const catPorNome = Object.fromEntries((habituaisLista || []).map((p) => [p.produto, p.categoria]));

  return (
    <div className="bb">
      <BgDeco />

      <header className="top">
        <div className="brand">
          <Mark size={34} chip />
          <span className="brand-txt">
            <span className="wm">
              Big<span className="b2">Bag</span>
            </span>
            <span className="ver">v{APP_VERSION}</span>
          </span>
        </div>
        <span className="sp" />
        <button className="ibtn" onClick={novaConversa} title={t('chat.newConv')} aria-label={t('chat.newConv')}>
          <Ico name="sync" size={21} />
        </button>
        <button className="ibtn" onClick={abrirHabituais} title={t('habituais.title')} aria-label={t('habituais.title')}>
          <Ico name="usual" size={21} />
        </button>
        <button className="ibtn" onClick={abrirCarrinho} title={t('cart.title')} aria-label={t('cart.title')}>
          <Ico name="cart" size={21} />
          {carrinho.length > 0 && <span className="badge">{carrinho.length}</span>}
        </button>
      </header>

      <main className="chat">
        {msgs.map((m) => (
          <Bolha key={m.id} m={m} />
        ))}
        <div className="sugg">
          {SUGESTOES.map((s) => (
            <button key={s.ic} type="button" className="schip" onClick={() => perguntar(t(s.q))} disabled={ocupado}>
              <Ico name={s.ic} size={15} />
              <span>{t(s.label)}</span>
            </button>
          ))}
        </div>
        <div ref={fimRef} />
      </main>

      <form
        className="inputbar"
        onSubmit={(e) => {
          e.preventDefault();
          perguntar();
        }}
      >
        <button type="button" className="round" onClick={() => setCamAberta(true)} disabled={ocupado} aria-label="digitalizar nota">
          <Ico name="camera" size={21} />
        </button>
        <button type="button" className="round" onClick={() => setMenuAberto(true)} disabled={ocupado} aria-label="mais opções">
          <Ico name="more" size={21} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          hidden
          onChange={(e) => {
            const arr = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = '';
            faturaLote(arr, 'arquivo');
          }}
        />
        <input
          ref={fotoRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            fatura(f, { dewarp: false, origem: 'foto' }); // foto crua, sem processar
          }}
        />
        <input
          ref={galeriaRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const arr = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = '';
            faturaLote(arr, 'galeria');
          }}
        />
        <div className="field">
          <input
            placeholder={t('chat.placeholder')}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            disabled={ocupado}
          />
        </div>
        {texto.trim() ? (
          <button type="submit" className="send" disabled={ocupado} aria-label="enviar">
            <Ico name="send" size={20} />
          </button>
        ) : (
          <button
            type="button"
            className={`send ${aGravar ? 'rec' : ''}`}
            onClick={aGravar ? pararVoz : iniciarVoz}
            disabled={ocupado}
            aria-label="gravar"
          >
            <Ico name={aGravar ? 'stop' : 'mic'} size={20} />
          </button>
        )}
      </form>

      {menuAberto && (
        <>
          <div className="cap-menu-bd" onClick={() => setMenuAberto(false)} />
          <div className="cap-menu">
            <button onClick={() => { setMenuAberto(false); fotoRef.current?.click(); }}>{t('cap.photo')}</button>
            <button onClick={() => { setMenuAberto(false); galeriaRef.current?.click(); }}>{t('cap.gallery')}</button>
            <button onClick={() => { setMenuAberto(false); fileRef.current?.click(); }}>{t('cap.file')}</button>
          </div>
        </>
      )}

      <Camera
        aberto={camAberta}
        onFechar={() => setCamAberta(false)}
        onFicheiro={() => {
          setCamAberta(false);
          galeriaRef.current?.click();
        }}
        onCapturar={(f) => {
          setCamAberta(false);
          fatura(f, { dewarp: false, origem: 'scan' }); // a Camera já digitalizou + pré-visualizou
        }}
      />

      <HabituaisSheet
        aberto={habituaisAberto}
        produtos={habituaisLista}
        offline={habituaisOffline}
        dataCache={dataHora(habituaisTs)}
        cartCount={carrinho.length}
        noCarrinho={noCarrinho}
        onAlternar={alternarCarrinho}
        onFechar={() => setHabituaisAberto(false)}
      />
      <CarrinhoSheet
        aberto={carrinhoAberto}
        carrinho={carrinho}
        catPorNome={catPorNome}
        offline={habituaisOffline}
        dataCache={dataHora(habituaisTs)}
        onRemover={removerDoCarrinho}
        onLimpar={limparCarrinho}
        onFechar={() => setCarrinhoAberto(false)}
      />
    </div>
  );
}

// ── Mensagens ──────────────────────────────────────────────────────────────
function Bolha({ m }) {
  const me = m.lado === 'user';
  if (m.tipo === 'pensar')
    return (
      <div className="row bot">
        <div className="av">
          <Mark size={30} />
        </div>
        <div className="bubble">
          <span className="typing">
            <i />
            <i />
            <i />
          </span>
          {m.texto && <span className="ttxt"> {m.texto}</span>}
        </div>
      </div>
    );
  return (
    <div className={`row ${me ? 'me' : 'bot'}`}>
      {!me && (
        <div className="av">
          <Mark size={30} />
        </div>
      )}
      <div className="bubble">
        {m.tipo === 'ficheiro' && (
          <span className="fic">
            <Ico name="receipt" size={17} /> {m.nome}
          </span>
        )}
        {m.tipo === 'texto' && <span className="txt">{m.texto}</span>}
        {m.tipo === 'resposta' && <Resposta m={m} />}
        {m.tipo === 'erro' && <span className="erro-txt">{m.texto}</span>}
        {m.tipo === 'compra' && <CartaoCompra d={m.dados} />}
        {m.tipo === 'habituais' && <CartaoHabituais produtos={m.produtos} />}
        <span className="time">{m.hora}</span>
      </div>
    </div>
  );
}

function Resposta({ m }) {
  const cmp = (m.chamadas || []).find(
    (c) => c.nome === 'comparar_precos_por_loja' && Array.isArray(c.resultado) && c.resultado.length,
  );
  return (
    <>
      {m.texto && <span className="txt" dangerouslySetInnerHTML={{ __html: realce(m.texto) }} />}
      {cmp && (
        <ul className="precos">
          {cmp.resultado.map((l, i) => (
            <li key={i} className={i === 0 ? 'melhor' : ''}>
              <span>
                {i === 0 ? '🏆 ' : ''}
                {l.cadeia}
              </span>
              <b>{eur(l.preco_por_base)}</b>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function CartaoHabituais({ produtos }) {
  if (!produtos || !produtos.length) return <span className="txt">{t('habituais.empty')}</span>;
  return (
    <div className="compra">
      <div className="compra-cab">{t('habituais.title')}</div>
      <ul className="compra-itens">
        {produtos.map((p, i) => (
          <li key={i}>
            <span>{p.produto}</span>
            <b>{t('habituais.times', { n: p.idas })}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CartaoCompra({ d }) {
  const [aberto, setAberto] = useState(false);
  const itens = agregarItens(d.itens || []);
  const mostra = aberto ? itens : itens.slice(0, 2);
  return (
    <div className="compra">
      <div className="compra-cab">
        {d.extracao_bate ? '✓' : '⚠'} {t('nota.added')}
      </div>
      <div className="compra-sub">
        {t('nota.summary', {
          n: d.n_itens,
          loja: d.loja?.cadeia,
          data: dataCurta(d.data_compra),
          total: eur(d.total_impresso),
        })}
      </div>
      <ul className="compra-itens">
        {mostra.map((it, i) => (
          <li key={i}>
            <span>
              {it.nome}
              {it.qtd > 1 && <em className="qtd"> ×{fmtQtd(it.qtd)}</em>}
            </span>
            <b>{eur(it.preco)}</b>
          </li>
        ))}
      </ul>
      {itens.length > 2 && (
        <button className="mais" onClick={() => setAberto(!aberto)}>
          {aberto ? `${t('nota.less')} ⌃` : `${t('nota.more', { n: itens.length - 2 })} ⌄`}
        </button>
      )}
    </div>
  );
}

// ── Folhas (bottom sheets) ───────────────────────────────────────────────────
function HabituaisSheet({ aberto, produtos, offline, dataCache, cartCount, noCarrinho, onAlternar, onFechar }) {
  return (
    <>
      <div className={`scrim ${aberto ? 'open' : ''}`} onClick={onFechar} />
      <section className={`sheet ${aberto ? 'open' : ''}`} aria-label={t('habituais.title')}>
        <div className="sheet-h">
          <Mark size={30} chip />
          <span className="t">{t('habituais.title')}</span>
          <button className="sheet-x" onClick={onFechar} aria-label="fechar">
            <Ico name="close" size={18} />
          </button>
        </div>
        {offline && <p className="sheet-offline">{t('habituais.offline', { data: dataCache })}</p>}
        <div className="usual-list">
          {produtos === null ? (
            <p className="sheet-vazio">{t('chat.thinking')}</p>
          ) : produtos.length === 0 ? (
            <p className="sheet-vazio">{t('habituais.empty')}</p>
          ) : (
            produtos.map((p) => {
              const dentro = noCarrinho(p.produto);
              return (
                <div
                  key={p.produto}
                  className={`urow ${dentro ? 'in' : ''}`}
                  onClick={() => onAlternar(p.produto, p.categoria, p.ultimo_preco)}
                >
                  <div className="uname">{p.produto}</div>
                  <div className="utoggle">
                    <Ico name={dentro ? 'check' : 'plus'} size={18} stroke={2.4} />
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="sheet-f">
          <span>{t('habituais.footer', { n: cartCount })}</span> <span className="hint">{t('habituais.footerHint')}</span>
        </div>
      </section>
    </>
  );
}

// Linha do carrinho: arrasta para a DIREITA para apagar (revela 🗑).
function ItemCarrinho({ it, onRemover }) {
  const [dx, setDx] = useState(0);
  const g = useRef({ x0: 0, y0: 0, horiz: false, mov: false, dx: 0 });
  function start(e) {
    const tt = e.touches[0];
    g.current = { x0: tt.clientX, y0: tt.clientY, horiz: false, mov: true, dx: 0 };
  }
  function move(e) {
    const r = g.current;
    if (!r.mov) return;
    const tt = e.touches[0];
    const dX = tt.clientX - r.x0;
    const dY = tt.clientY - r.y0;
    if (!r.horiz && Math.abs(dX) > Math.abs(dY) + 6) r.horiz = true;
    if (r.horiz) {
      r.dx = Math.max(0, dX);
      setDx(r.dx);
    }
  }
  function end() {
    const r = g.current;
    r.mov = false;
    if (r.horiz && r.dx > 90) onRemover(it.nome);
    setDx(0);
  }
  return (
    <div className="crow-li">
      <div className="crow-bg">
        <Ico name="close" size={18} />
      </div>
      <div
        className="crow"
        style={{ transform: `translateX(${dx}px)`, transition: dx ? 'none' : 'transform .18s' }}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      >
        <span className="cn">{it.nome}</span>
        {it.preco != null && <span className="cp">{eur(it.preco)}</span>}
      </div>
    </div>
  );
}

function CarrinhoSheet({ aberto, carrinho, catPorNome, offline, dataCache, onRemover, onLimpar, onFechar }) {
  const itens = carrinho.map((it) => ({ ...it, categoria: it.categoria || catPorNome?.[it.nome] }));
  const total = carrinho.reduce((s, it) => s + (Number(it.preco) || 0), 0);
  return (
    <>
      <div className={`scrim ${aberto ? 'open' : ''}`} onClick={onFechar} />
      <section className={`sheet ${aberto ? 'open' : ''}`} aria-label={t('cart.title')}>
        <div className="sheet-h">
          <span className="cart-ic">
            <Ico name="cart" size={20} />
          </span>
          <span className="t">{t('cart.sheetTitle')}</span>
          {carrinho.length > 0 && <span className="cart-count">{t('cart.left', { n: carrinho.length })}</span>}
          <button className="sheet-x" onClick={onFechar} aria-label="fechar">
            <Ico name="close" size={18} />
          </button>
        </div>
        {offline && <p className="sheet-offline">{t('habituais.offline', { data: dataCache })}</p>}
        {carrinho.length === 0 ? (
          <div className="cart-empty">{t('cart.empty')}</div>
        ) : (
          <div className="cart-list">
            {agruparPorSecao(itens).map(([sec, lista]) => (
              <div key={sec}>
                <div className="cart-cat">{sec}</div>
                {lista.map((it) => (
                  <ItemCarrinho key={it.nome} it={it} onRemover={onRemover} />
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="cart-foot">
          <div className="cart-total">
            <span>{t('cart.total')}</span>
            <b>{eur(total)}</b>
          </div>
          <button className="cart-clear" onClick={onLimpar} disabled={!carrinho.length}>
            {t('cart.clear')}
          </button>
        </div>
      </section>
    </>
  );
}

// Ordem das secções do mercado (percurso típico); desconhecidas vão para o fim.
const ORDEM_SECAO = [
  'Frutas e Legumes', 'Padaria', 'Talho', 'Charcutaria', 'Peixaria', 'Laticínios',
  'Ovos', 'Congelados', 'Mercearia', 'Bebidas', 'Higiene', 'Limpeza', 'Outros',
];

function secaoDe(cat) {
  const c = String(cat || '').toLowerCase();
  if (c.includes('fruta') || c.includes('legume') || c.includes('hort')) return 'Frutas e Legumes';
  if (c.includes('pão') || c.includes('pao') || c.includes('padaria') || c.includes('pastelaria')) return 'Padaria';
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

function agruparPorSecao(itens) {
  const grupos = {};
  for (const it of itens) {
    const s = secaoDe(it.categoria);
    (grupos[s] = grupos[s] || []).push(it);
  }
  const ord = (s) => {
    const i = ORDEM_SECAO.indexOf(s);
    return i < 0 ? 99 : i;
  };
  return Object.entries(grupos).sort((a, b) => ord(a[0]) - ord(b[0]) || a[0].localeCompare(b[0]));
}

// Captura guiada ao vivo: câmara traseira + moldura de alinhamento.
function Camera({ aberto, onCapturar, onFicheiro, onFechar }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [erro, setErro] = useState('');
  const [processando, setProcessando] = useState(false);
  const [preview, setPreview] = useState(null); // { url, file, info } — resultado já digitalizado, à espera de confirmação
  const [lanterna, setLanterna] = useState(false);
  const [temLanterna, setTemLanterna] = useState(false); // o aparelho suporta torch? (Android sim; iOS não)

  useEffect(() => {
    if (!aberto) {
      setPreview((p) => {
        if (p?.url) URL.revokeObjectURL(p.url);
        return null;
      });
      setProcessando(false);
      setLanterna(false); // a lanterna apaga quando o stream para
      return;
    }
    let cancelado = false;
    setErro('');
    (async () => {
      try {
        // Pedir alta resolução: sem isto o browser entrega ~640×480 e a foto
        // sai borrada depois do warp/recorte. `ideal` deixa o browser escolher
        // o máximo suportado pela câmara traseira.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
          audio: false,
        });
        if (cancelado) return stream.getTracks().forEach((tr) => tr.stop());
        streamRef.current = stream;
        // Tentar autofoco contínuo (suporte variável; falha em silêncio) e
        // detetar suporte de lanterna (torch) — Android sim, iOS/Safari não.
        try {
          const track = stream.getVideoTracks()[0];
          const caps = track.getCapabilities?.() || {};
          if (caps.focusMode?.includes('continuous')) {
            await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
          }
          if (!cancelado) setTemLanterna(!!caps.torch);
        } catch {
          /* noop */
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        if (!cancelado) setErro(t('cam.error'));
      }
    })();
    return () => {
      cancelado = true;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, [aberto]);

  // Ao voltar da pré-visualização para o vídeo, re-liga o stream.
  useEffect(() => {
    if (!preview && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [preview]);

  if (!aberto) return null;

  async function capturar() {
    const v = videoRef.current;
    if (!v || !v.videoWidth || processando) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.95));
    if (!blob) return;
    setProcessando(true);
    let info = null;
    const file = await digitalizar(new File([blob], 'nota.jpg', { type: 'image/jpeg' }), (d) => {
      info = d;
    });
    setProcessando(false);
    setPreview({ url: URL.createObjectURL(file), file, info, res: `${v.videoWidth}×${v.videoHeight}` });
  }

  function enviar() {
    if (!preview) return;
    const f = preview.file;
    URL.revokeObjectURL(preview.url);
    setPreview(null);
    onCapturar(f); // já digitalizada → App envia sem re-processar
  }
  function repetir() {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }
  async function alternarLanterna() {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    try {
      const novo = !lanterna;
      await track.applyConstraints({ advanced: [{ torch: novo }] });
      setLanterna(novo);
    } catch {
      /* noop */
    }
  }

  return (
    <div className="cam-overlay">
      <div className="cam-topo">
        {temLanterna && !preview && !erro ? (
          <button
            className={`cam-luz ${lanterna ? 'on' : ''}`}
            onClick={alternarLanterna}
            aria-label={t('cam.luz')}
          >
            🔦
          </button>
        ) : null}
        <button className="cam-x" onClick={onFechar} aria-label="fechar">
          ✕
        </button>
      </div>
      {erro ? (
        <div className="cam-erro">
          <p>{erro}</p>
          <button className="cam-file" onClick={onFicheiro}>
            {t('cam.file')}
          </button>
        </div>
      ) : preview ? (
        <>
          <img className="cam-preview" src={preview.url} alt="pré-visualização da nota" />
          <p className="cam-hint">
            {preview.info?.dewarped
              ? t('cam.ajeitado', { c: preview.info.cobertura })
              : preview.info?.recortado
              ? t('cam.recortado', { c: preview.info.cobertura })
              : t('cam.original', {
                  motivo:
                    {
                      'sem contorno': 'não detetei as bordas do talão',
                      'contorno ocupa a imagem toda': 'o talão preenche o ecrã todo',
                      'contorno implausível': 'bordas detetadas pequenas demais',
                      'sem cantos': 'cantos não detetados',
                      'não-imagem': 'não é imagem',
                    }[preview.info?.motivo] || preview.info?.motivo || 'desconhecido',
                })}
            {preview.res ? <span className="cam-res"> · captura {preview.res}</span> : null}
          </p>
          <div className="cam-acoes cam-acoes-prev">
            <button className="cam-file" onClick={repetir}>
              {t('cam.repetir')}
            </button>
            <button className="cam-enviar" onClick={enviar}>
              {t('cam.enviar')}
            </button>
          </div>
        </>
      ) : (
        <>
          <video ref={videoRef} className="cam-video" playsInline muted autoPlay />
          <div className="cam-moldura" />
          <p className="cam-hint">{processando ? t('cam.processando') : t('cam.hint')}</p>
          <div className="cam-acoes">
            <button className="cam-file" onClick={onFicheiro}>
              {t('cam.file')}
            </button>
            <button className="cam-cap" onClick={capturar} disabled={processando} aria-label={t('cam.capture')} />
            <span className="cam-spacer" />
          </div>
        </>
      )}
    </div>
  );
}

// Marca de água do fundo (glifos de mercearia, do handoff).
function BgDeco() {
  return (
    <div className="bg-deco" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
        <defs>
          <pattern id="bbpat" width="280" height="280" patternUnits="userSpaceOnUse" patternTransform="rotate(-8) scale(1.04)">
            <g fill="none" stroke="#c7efd9" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
              <g transform="translate(48,56) rotate(-6)">
                <path d="M0 -8 C-11 -20 -26 -12 -24 4 C-22 17 -9 24 0 26 C9 24 22 17 24 4 C26 -12 11 -20 0 -8 Z" />
                <path d="M0 -10 C0 -16 3 -21 9 -23" />
                <path d="M3 -15 C9 -21 17 -19 17 -13 C11 -11 5 -11 3 -15 Z" />
              </g>
              <g transform="translate(150,46) rotate(8)">
                <path d="M-7 -24 L7 -24 L7 -14 C7 -10 11 -8 11 -2 L11 20 a4 4 0 0 1 -4 4 L-7 24 a4 4 0 0 1 -4 -4 L-11 -2 C-11 -8 -7 -10 -7 -14 Z" />
                <path d="M-11 6 L11 6" />
              </g>
              <g transform="translate(238,72) rotate(-12)">
                <path d="M0 26 L-13 -4 C-8 -11 8 -11 13 -4 Z" />
                <path d="M0 -6 L0 -22 M0 -8 L-9 -19 M0 -8 L9 -19" />
              </g>
              <g transform="translate(70,150)">
                <path d="M-19 -13 L-13 -13 L-10 9 a3 3 0 0 0 3 2.5 L13 11.5 a3 3 0 0 0 3 -2.4 L20 -5 L-11 -5" />
                <circle cx="-6" cy="18" r="2.4" />
                <circle cx="12" cy="18" r="2.4" />
              </g>
              <g transform="translate(186,150) rotate(4)">
                <path d="M-22 7 C-22 -14 22 -14 22 7 a4 4 0 0 1 -4 4 L-18 11 a4 4 0 0 1 -4 -4 Z" />
                <path d="M-12 -3 L-8 1 M-2 -5 L2 -1 M8 -3 L12 1" />
              </g>
              <g transform="translate(250,188)">
                <path d="M0 26 L0 6" />
                <circle cx="-8" cy="-4" r="9" />
                <circle cx="8" cy="-4" r="9" />
                <circle cx="0" cy="-12" r="9" />
                <circle cx="0" cy="4" r="8" />
              </g>
              <g transform="translate(54,232) rotate(-8)">
                <path d="M-20 0 C-12 -12 8 -12 16 0 C8 12 -12 12 -20 0 Z" />
                <path d="M16 0 L27 -8 L27 8 Z" />
                <circle cx="-9" cy="-2" r="1.6" />
              </g>
              <g transform="translate(156,238) rotate(6)">
                <path d="M-12 24 L-12 -8 L0 -20 L12 -8 L12 24 Z" />
                <path d="M-12 -8 L12 -8 M0 -20 L0 -8" />
              </g>
            </g>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#bbpat)" />
      </svg>
    </div>
  );
}

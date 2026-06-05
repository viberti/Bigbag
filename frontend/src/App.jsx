import { useEffect, useRef, useState } from 'react';
import { verificarSessao, setAuth, clearAuth, consultar, enviarFatura, enviarVoz, carregarConversa, carregarHabituais } from './api.js';
import { digitalizar } from './scanner.js';
import { t, detetarLocale } from './i18n.js';

detetarLocale('pt-BR'); // default; usa o idioma do browser se houver dicionário

// Versão do build (hash do git + data), injetada pelo Vite. Mostrada junto ao
// logo para se ver, num relance, se o PWA está em cache antigo.
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

const eur = (v) => (v == null ? '—' : `${Number(v).toFixed(2).replace('.', ',')} €`);
const hora = () => new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
const dataCurta = (iso) => {
  const s = String(iso || '').slice(0, 10);
  return s ? s.slice(8, 10) + '/' + s.slice(5, 7) : '';
};
const fmtQtd = (q) => (Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/0+$/, '').replace('.', ','));

// Agrega linhas idênticas (mesmo produto E mesmo preço) somando a quantidade —
// não repetir o mesmo produto no cartão. Usa o nome canónico (legível).
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
  if (!sessao)
    return (
      <Login
        onEntrar={setSessao}
      />
    );
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
  const fimRef = useRef(null);
  const fileRef = useRef(null);
  const fotoRef = useRef(null);
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
  // `dewarp` só no caminho do scanner de documento; `origem` marca o caminho
  // (scan/foto/galeria/arquivo) para depois comparar a leitura por caminho.
  async function processarUma(file, { dewarp = false, origem = 'arquivo', prefixo = '' } = {}) {
    const ehImagem = file.type?.startsWith('image/');
    add({ lado: 'user', tipo: 'ficheiro', nome: file.name });
    add({ lado: 'bot', tipo: 'pensar', texto: prefixo + (dewarp && ehImagem ? t('nota.scanning') : t('nota.reading')) });
    try {
      const enviar = dewarp && ehImagem ? await digitalizar(file) : file; // dewarp só no caminho 'scan'
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
        await processarUma(lista[i], { dewarp: false, origem, prefixo });
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
        stream.getTracks().forEach((t) => t.stop());
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

  async function mostrarHabituais() {
    if (ocupado) return;
    setOcupado(true);
    add({ lado: 'bot', tipo: 'pensar' });
    try {
      const produtos = await carregarHabituais();
      tiraPensar();
      add({ lado: 'bot', tipo: 'habituais', produtos });
    } catch {
      tiraPensar();
      add({ lado: 'bot', tipo: 'erro', texto: t('err.query') });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="chat">
      <header>
        <span className="marca">
          <strong>🛍️ Bigbag</strong>
          <span className="versao">v{APP_VERSION}</span>
        </span>
        <div className="header-acoes">
          <button className="icone-cab" onClick={mostrarHabituais} disabled={ocupado} aria-label="lista habitual" title={t('habituais.title')}>
            🛒
          </button>
          <button className="link" onClick={onSair}>
            {t('chat.logout')}
          </button>
        </div>
      </header>

      <div className="thread">
        {msgs.map((m) => (
          <Bolha key={m.id} m={m} />
        ))}
        <div ref={fimRef} />
      </div>

      <form
        className="barra"
        onSubmit={(e) => {
          e.preventDefault();
          perguntar();
        }}
      >
        <button
          type="button"
          className="icone"
          onClick={() => fotoRef.current?.click()}
          disabled={ocupado}
          aria-label="foto da nota"
        >
          📷
        </button>
        <button
          type="button"
          className="icone-mais"
          onClick={() => setMenuAberto(true)}
          disabled={ocupado}
          aria-label="mais opções de envio"
        >
          ⋯
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            fatura(f, { dewarp: false, origem: 'arquivo' });
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
            fatura(f, { dewarp: false, origem: 'foto' });
          }}
        />
        <input
          ref={galeriaRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const fs = e.target.files;
            const arr = fs ? Array.from(fs) : [];
            e.target.value = '';
            faturaLote(arr, 'galeria');
          }}
        />
        <input
          className="campo"
          placeholder={t('chat.placeholder')}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          disabled={ocupado}
        />
        {texto.trim() ? (
          <button type="submit" className="icone enviar" disabled={ocupado} aria-label="enviar">
            ➤
          </button>
        ) : (
          <button
            type="button"
            className={`icone mic ${aGravar ? 'ativo' : ''}`}
            onClick={aGravar ? pararVoz : iniciarVoz}
            disabled={ocupado}
            aria-label="gravar"
          >
            {aGravar ? '⏹' : '🎤'}
          </button>
        )}
      </form>

      {menuAberto && (
        <>
          <div className="cap-menu-bd" onClick={() => setMenuAberto(false)} />
          <div className="cap-menu">
            <button onClick={() => { setMenuAberto(false); fotoRef.current?.click(); }}>{t('cap.photo')}</button>
            <button onClick={() => { setMenuAberto(false); galeriaRef.current?.click(); }}>{t('cap.gallery')}</button>
            <button onClick={() => { setMenuAberto(false); setCamAberta(true); }}>{t('cap.scan')}</button>
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
          fatura(f, { dewarp: true, origem: 'scan' });
        }}
      />
    </div>
  );
}

// Captura guiada ao vivo: câmara traseira + moldura de alinhamento, para a nota
// preencher o quadro (legibilidade na origem). Ao capturar, devolve um File que
// segue o fluxo normal (digitalizar/dewarp + upload). Fallback para ficheiro.
function Camera({ aberto, onCapturar, onFicheiro, onFechar }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!aberto) return;
    let cancelado = false;
    setErro('');
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelado) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
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
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [aberto]);

  if (!aberto) return null;

  function capturar() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0);
    canvas.toBlob((blob) => blob && onCapturar(new File([blob], 'nota.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.95);
  }

  return (
    <div className="cam-overlay">
      <div className="cam-topo">
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
      ) : (
        <>
          <video ref={videoRef} className="cam-video" playsInline muted autoPlay />
          <div className="cam-moldura" />
          <p className="cam-hint">{t('cam.hint')}</p>
          <div className="cam-acoes">
            <button className="cam-file" onClick={onFicheiro}>
              {t('cam.file')}
            </button>
            <button className="cam-cap" onClick={capturar} aria-label={t('cam.capture')} />
            <span className="cam-spacer" />
          </div>
        </>
      )}
    </div>
  );
}

function Bolha({ m }) {
  if (m.tipo === 'pensar')
    return (
      <div className="bolha bot">
        <span className="pensar">{m.texto || t('chat.thinking')}</span>
      </div>
    );
  const cls = `bolha ${m.lado}`;
  return (
    <div className={cls}>
      {m.tipo === 'ficheiro' && <div className="ficheiro">📄 {m.nome}</div>}
      {m.tipo === 'compra' && <CartaoCompra d={m.dados} />}
      {m.tipo === 'habituais' && <CartaoHabituais produtos={m.produtos} />}
      {m.tipo === 'resposta' && <Resposta m={m} />}
      {m.tipo === 'erro' && <span className="erro-txt">{m.texto}</span>}
      {m.tipo === 'texto' && <span className="txt">{m.texto}</span>}
      <span className="hora">{m.hora}</span>
    </div>
  );
}

function Resposta({ m }) {
  const cmp = (m.chamadas || []).find(
    (c) => c.nome === 'comparar_precos_por_loja' && Array.isArray(c.resultado) && c.resultado.length,
  );
  return (
    <div>
      {m.texto && <p className="txt">{m.texto}</p>}
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
    </div>
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

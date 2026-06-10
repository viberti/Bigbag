import { useCallback, useEffect, useRef, useState } from 'react';
import { verificarSessao, setAuth, clearAuth, consultar, enviarFatura, enviarVoz, carregarConversa, carregarHabituais, historicoProduto, listarNotas, detalhesNota, identificarProduto, infoProduto, fotoProdutoUrl, analiseProduto, listarDespensa, resumoGastos, listarPorIdentificar, consultarProdutoEan, consultarProdutoNome, compararProdutos, lerEanFoto, fotoInteligente, carregarPerfil, listarPerfis, ativarPerfil, avaliacaoPersonalizada } from './api.js';
import { lerCacheHabituais, gravarCacheHabituais } from './habituaisCache.js';
import { lerCapturas, guardarCaptura, removerCaptura } from './capturas.js';
import { fichaLocal, catalogoLocal, sincronizarBaseLocal } from './baseLocal.js';
import { track } from './telemetria.js';
import { digitalizar, detectarPapel } from './scanner.js';
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
const dataNota = (iso) => {
  const s = String(iso || '').slice(0, 10);
  return s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '';
};
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
// Validade: aceita "AAAA-MM-DD" → "DD/MM/AAAA", "AAAA-MM" → "MM/AAAA", senão o texto cru.
const fmtValidade = (v) => {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4);
  if (/^\d{4}-\d{2}$/.test(s)) return s.slice(5, 7) + '/' + s.slice(0, 4);
  return s;
};

// Wrappers SVG do handoff (marca + ícones de linha).
const Mark = ({ size = 30, chip = false }) => <span className="mk" dangerouslySetInnerHTML={{ __html: MARK({ size, chip }) }} />;
const Ico = ({ name, size = 21, stroke }) => <span className="ico" dangerouslySetInnerHTML={{ __html: ICON(name, { size, stroke }) }} />;

// Limpa a marca: o Open Food Facts lista várias separadas por vírgula (incl. a
// HOLDING, ex.: "Continente, Continente Seleção, SONAE"). Fica com a 1.ª marca real.
const MARCAS_HOLDING = new Set(['sonae', 'jerónimo martins', 'jeronimo martins', 'auchan holding', 'schwarz']);
// Padroniza a capitalização da marca: 1.ª letra de cada palavra maiúscula, resto
// minúscula (o OFF/talão ora vem ALLCAPS ora não → "NESTLE"/"nestle" → "Nestle",
// "PINGO DOCE" → "Pingo Doce").
const capMarca = (s) =>
  String(s || '').toLowerCase().replace(/(^|[\s\-/&.])([a-zà-ÿ])/g, (_, sep, ch) => sep + ch.toUpperCase());
const limparMarca = (s) => {
  const partes = String(s || '').split(/[,/;]/).map((x) => x.trim()).filter(Boolean);
  const reais = partes.filter((p) => !MARCAS_HOLDING.has(p.toLowerCase()));
  return capMarca((reais[0] || partes[0] || '').trim());
};

// Tenta descodificar um código de barras (EAN/UPC) de uma imagem (zxing). Devolve
// os dígitos ou null. Usado para distinguir "foto de produto" de "foto de talão".
async function decodeEanDeImagem(file) {
  if (!file) return null;
  const url = URL.createObjectURL(file);
  try {
    const [{ BrowserMultiFormatReader }, lib] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
    const hints = new Map();
    hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [lib.BarcodeFormat.EAN_13, lib.BarcodeFormat.EAN_8, lib.BarcodeFormat.UPC_A, lib.BarcodeFormat.UPC_E]);
    hints.set(lib.DecodeHintType.TRY_HARDER, true);
    const res = await new BrowserMultiFormatReader(hints).decodeFromImageUrl(url);
    const cod = res.getText().replace(/\D/g, '');
    return cod.length >= 8 ? cod : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

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
  const [notasAberto, setNotasAberto] = useState(false);
  const [notasLista, setNotasLista] = useState(null); // null=a carregar · []=vazio
  const [identItem, setIdentItem] = useState(null); // item a identificar (EAN+fotos) ou null
  const [infoItem, setInfoItem] = useState(null); // item com EAN → ver toda a info
  // item_id → EAN, dos identificados nesta sessão (atualiza listas sem refresh)
  const [identificados, setIdentificados] = useState({});
  const marcarIdentificado = (itemId, ean) => {
    if (itemId && ean) setIdentificados((m) => ({ ...m, [itemId]: ean }));
  };
  // stale-while-revalidate: ao reabrir uma folha, mostra LOGO a última versão (sem
  // "a pensar…") e atualiza por trás. Cache de sessão, em memória (some no reload).
  const cacheListas = useRef({});
  const abrirComCache = (chave, setAberto, setDados, buscar, fallback) => {
    setAberto(true);
    setDados(cacheListas.current[chave] ?? null);
    buscar()
      .then((d) => { cacheListas.current[chave] = d; setDados(d); })
      .catch(() => { if (cacheListas.current[chave] == null) setDados(fallback); });
  };
  const abrirNotas = () => abrirComCache('notas', setNotasAberto, setNotasLista, listarNotas, []);
  const [despensaAberto, setDespensaAberto] = useState(false);
  const [despensaLista, setDespensaLista] = useState(null); // null=a carregar · []=vazio
  const abrirDespensa = () => abrirComCache('despensa', setDespensaAberto, setDespensaLista, listarDespensa, []);
  const [gastosAberto, setGastosAberto] = useState(false);
  const [gastosDados, setGastosDados] = useState(null); // null=a carregar · {erro} em falha
  const abrirGastos = () => abrirComCache('gastos', setGastosAberto, setGastosDados, resumoGastos, { erro: true });
  const [porIdentAberto, setPorIdentAberto] = useState(false);
  const [porIdentLista, setPorIdentLista] = useState(null); // null=a carregar · []=vazio
  // Capturas pendentes (item_id → {item_id, ean, nome, fotos[]}), persistidas em
  // IndexedDB: scan de barcode + fotos por item, acumulam até "Enviar".
  const [capturas, setCapturas] = useState({});
  const [captItem, setCaptItem] = useState(null); // item aberto na folha de captura
  const [enviandoCap, setEnviandoCap] = useState(null); // texto de progresso | null
  const abrirPorIdentificar = () => {
    abrirComCache('porIdent', setPorIdentAberto, setPorIdentLista, listarPorIdentificar, []);
    lerCapturas().then(setCapturas).catch(() => setCapturas({}));
  };
  const aoGuardarCaptura = () => { lerCapturas().then(setCapturas).catch(() => {}); };
  async function enviarCapturas() {
    const lista = Object.values(capturas);
    if (!lista.length || enviandoCap) return;
    let ok = 0, falhou = 0;
    for (let i = 0; i < lista.length; i++) {
      const c = lista[i];
      setEnviandoCap(t('pid.enviando', { i: i + 1, n: lista.length }));
      try {
        const r = await identificarProduto({ ean: c.ean || undefined, itemId: c.item_id, fotos: c.fotos || [] });
        if (r && !r.erro) { await removerCaptura(c.item_id); ok++; }
        else falhou++;
      } catch { falhou++; }
    }
    setEnviandoCap(null);
    // recarrega da fonte de verdade: itens que ganharam EAN saem da lista
    listarPorIdentificar().then((d) => { cacheListas.current.porIdent = d; setPorIdentLista(d); }).catch(() => {});
    lerCapturas().then(setCapturas).catch(() => {});
    sincronizarBaseLocal({ forcar: true }); // as fichas novas entram já na base local
    mostrarToast(t('toast.enviados', { n: ok }) + (falhou ? t('toast.falharam', { n: falhou }) : '') + '.');
  }
  const [scannerAberto, setScannerAberto] = useState(false);
  const [compararAberto, setCompararAberto] = useState(false);
  const [perfilAberto, setPerfilAberto] = useState(false);
  const [toast, setToast] = useState('');
  const mostrarToast = (m) => { setToast(m); setTimeout(() => setToast(''), 4500); };
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

  // Telemetria: marca o arranque da app (uma vez por visita). E sincroniza a BASE
  // LOCAL de produtos (fire-and-forget, auto-limitada a 1x/hora) — é o que torna o
  // scan instantâneo/offline para produtos já conhecidos.
  useEffect(() => { track('app_abrir'); sincronizarBaseLocal(); }, []);

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
    // Miniatura local imediata: mostra a própria foto na bolha enquanto faz upload
    // (feedback instantâneo). Só para imagens — PDF mantém o ícone de talão.
    add({ lado: 'user', tipo: 'ficheiro', nome: etiqueta || t('nota.enviada'), previa: ehImagem ? URL.createObjectURL(file) : null });
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
    track('carrinho_abrir');
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
        {/* Linha 1: campo de escrita a largura toda */}
        <div className="field">
          <input
            placeholder={t('chat.placeholder')}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            disabled={ocupado}
          />
        </div>
        {/* Linha 2: ações (câmara/mais à esquerda; voz+enviar à direita) */}
        <div className="input-actions">
          <button type="button" className="round" onClick={() => fotoRef.current?.click()} disabled={ocupado} aria-label="tirar foto">
            <Ico name="camera" size={21} />
          </button>
          <button type="button" className="round" onClick={() => { setMenuAberto(true); track('menu_abrir'); }} disabled={ocupado} aria-label="mais opções">
            <Ico name="more" size={21} />
          </button>
          <button type="button" className="round" onClick={abrirNotas} disabled={ocupado} aria-label="as minhas compras">
            <Ico name="notas" size={21} />
          </button>
          <button type="button" className="round" onClick={() => { setCompararAberto(true); track('comparar_abrir'); }} disabled={ocupado} aria-label={t('comp.title')}>
            <Ico name="comparar" size={21} />
          </button>
          <button type="button" className="round scan" onClick={() => { setScannerAberto(true); track('scanner_abrir'); }} disabled={ocupado} aria-label="consultar produto (código de barras)">
            <Ico name="barras" size={21} />
          </button>
          <span className="ia-sp" />
          <button
            type="button"
            className={`voice ${aGravar ? 'rec' : ''}`}
            onClick={aGravar ? pararVoz : iniciarVoz}
            disabled={ocupado}
            aria-label="gravar"
          >
            <Ico name={aGravar ? 'stop' : 'mic'} size={22} />
          </button>
          <button
            type="submit"
            className={`send ${texto.trim() ? '' : 'hidden'}`}
            disabled={ocupado || !texto.trim()}
            aria-label="enviar"
          >
            <Ico name="send" size={22} />
          </button>
          {/* inputs de ficheiro ocultos */}
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
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              // se a foto for de um código de barras → consultar produto (como o scanner);
              // senão, trata-se de um talão → fluxo normal de nota.
              const cod = await decodeEanDeImagem(f);
              if (cod) {
                // LOCAL-FIRST: se o produto já está na base local, a ficha abre
                // instantânea (e offline); a consulta ao servidor segue em fundo
                // (acumula conhecimento p/ a próxima sincronização).
                const local = await fichaLocal(cod).catch(() => null);
                if (local) {
                  setInfoItem({ ean: cod, produto: local.nome || cod, local });
                  consultarProdutoEan(cod).catch(() => {});
                  return;
                }
                const cat = await catalogoLocal(cod).catch(() => null);
                if (cat) {
                  setInfoItem({ ean: cod, produto: cat.nome || cod, local: { ...cat, soCatalogo: true } });
                  consultarProdutoEan(cod).catch(() => {});
                  return;
                }
                try {
                  const r = await consultarProdutoEan(cod);
                  if (r.encontrado) setInfoItem({ ean: r.ean, produto: r.nome || r.ean });
                  else mostrarToast(t('toast.naoNaBase', { cod }));
                } catch {
                  mostrarToast(t('toast.falhaConsulta'));
                }
                return;
              }
              // 3.º comportamento: sem código → classificar (talão / produto / outro)
              mostrarToast(t('toast.analisando'));
              try {
                const r = await fotoInteligente(f);
                if (r.tipo === 'talao') {
                  fatura(f, { dewarp: false, origem: 'foto' });
                } else if (r.tipo === 'produto' && r.encontrado) {
                  // EAN → ficha por EAN; genérico (fresco sem código) → ficha por SKU
                  if (r.ean) setInfoItem({ ean: r.ean, produto: r.nome || r.ean });
                  else setInfoItem({ sku_id: r.sku_id, produto: r.nome || r.generico?.alimento || 'Produto' });
                } else if (r.tipo === 'produto') {
                  mostrarToast(t('toast.liSemDados', { nome: r.nome || 'produto', marca: r.marca ? ` (${r.marca})` : '' }));
                } else {
                  mostrarToast(t('toast.naoReconheci'));
                }
              } catch {
                fatura(f, { dewarp: false, origem: 'foto' }); // em falha, assume talão
              }
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
        </div>
      </form>

      {menuAberto && (
        <>
          <div className="cap-menu-bd" onClick={() => setMenuAberto(false)} />
          <div className="cap-menu">
            <button onClick={() => { setMenuAberto(false); setCamAberta(true); }}><Ico name="scan" size={18} /> {t('cap.scan')}</button>
            <button onClick={() => { setMenuAberto(false); galeriaRef.current?.click(); }}><Ico name="galeria" size={18} /> {t('cap.gallery')}</button>
            <button onClick={() => { setMenuAberto(false); fileRef.current?.click(); }}><Ico name="ficheiro" size={18} /> {t('cap.file')}</button>
            <div className="cap-menu-sep" />
            <button onClick={() => { setMenuAberto(false); setPerfilAberto(true); }}><Ico name="spark" size={18} /> {t('menu.perfil')}</button>
            <button onClick={() => { setMenuAberto(false); abrirDespensa(); }}><Ico name="despensa" size={18} /> {t('menu.despensa')}</button>
            <button onClick={() => { setMenuAberto(false); abrirGastos(); }}><Ico name="gastos" size={18} /> {t('menu.gastos')}</button>
            <button onClick={() => { setMenuAberto(false); abrirPorIdentificar(); }}><Ico name="camera" size={18} /> {t('menu.porident')}</button>
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
      <NotasSheet aberto={notasAberto} notas={notasLista} onFechar={() => setNotasAberto(false)} onIdentificar={setIdentItem} onInfo={setInfoItem} identificados={identificados} />
      <DespensaSheet aberto={despensaAberto} produtos={despensaLista} onFechar={() => setDespensaAberto(false)} onInfo={setInfoItem} />
      <GastosSheet aberto={gastosAberto} dados={gastosDados} onFechar={() => setGastosAberto(false)} />
      <PorIdentificarSheet
        aberto={porIdentAberto}
        itens={porIdentLista}
        onFechar={() => setPorIdentAberto(false)}
        onCapturar={(it) => setCaptItem({ id: it.item_id, sku_id: it.sku_id, produto: it.produto })}
        identificados={identificados}
        capturas={capturas}
        enviando={enviandoCap}
        onEnviar={enviarCapturas}
      />
      <CapturaIdentSheet
        item={captItem}
        capturaExistente={captItem ? capturas[captItem.id] : null}
        onGuardado={aoGuardarCaptura}
        onFechar={() => setCaptItem(null)}
      />
      <ScannerSheet
        aberto={scannerAberto}
        onFechar={() => setScannerAberto(false)}
        onEncontrado={(p) => { setScannerAberto(false); setInfoItem(p.sku_id ? { sku_id: p.sku_id, produto: p.nome } : { ean: p.ean, produto: p.nome || p.ean, local: p.local }); }}
      />
      <CompararSheet aberto={compararAberto} onFechar={() => setCompararAberto(false)} />
      <PerfilSheet aberto={perfilAberto} onFechar={() => setPerfilAberto(false)} />
      {toast && <div className="toast" onClick={() => setToast('')}>{toast}</div>}
      <ProdutoIdentSheet item={identItem} onFechar={() => setIdentItem(null)} onIdentificado={marcarIdentificado} />
      <ProdutoInfoSheet item={infoItem} onFechar={() => setInfoItem(null)} />
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
        {m.tipo === 'ficheiro' &&
          (m.previa ? (
            <span className="fic fic-com-img">
              <img src={m.previa} alt="" className="fic-previa" loading="lazy" />
              <span className="fic-nome">{m.nome}</span>
            </span>
          ) : (
            <span className="fic">
              <Ico name="receipt" size={17} /> {m.nome}
            </span>
          ))}
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

// Identidade visual por loja (cor + monograma) para os cartões de compra.
const LOJAS_TEMA = {
  continente: { c: '#ef5346', mono: 'C' },
  mercadona: { c: '#f0a73c', mono: 'M' },
  'pingo doce': { c: '#37bcb4', mono: 'PD' },
  makro: { c: '#9b8cf2', mono: 'Mk' },
  aldi: { c: '#5b8def', mono: 'A' },
  lidl: { c: '#f2c14e', mono: 'L' },
};
const LOJA_PALETA = ['#ef5346', '#f0a73c', '#37bcb4', '#9b8cf2', '#5b8def', '#f2c14e', '#46d488', '#e57bb0'];
function lojaTema(nome) {
  const k = String(nome || '').trim().toLowerCase();
  for (const [key, tema] of Object.entries(LOJAS_TEMA)) if (k === key || k.includes(key)) return tema;
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  const mono = (k.split(/\s+/).map((w) => w[0]).filter(Boolean).join('').slice(0, 2) || '?').toUpperCase();
  return { c: LOJA_PALETA[h % LOJA_PALETA.length], mono };
}

// As minhas compras (redesign): cartões por loja (cor+monograma) agrupados por
// mês, com resumo do mês; tocar abre o detalhe (produtos + total) que desliza.
function NotasSheet({ aberto, notas, onFechar, onIdentificar, onInfo, identificados }) {
  const [aberta, setAberta] = useState(null); // nota mostrada no detalhe (mantém-se no slide-out)
  const [detAberto, setDetAberto] = useState(false);
  const [detItens, setDetItens] = useState(null); // itens da nota aberta (null = a carregar)
  const [filtroLoja, setFiltroLoja] = useState(null); // ícone de mercado: filtra os cartões

  useEffect(() => {
    if (!aberto) { setDetAberto(false); setFiltroLoja(null); setAberta(null); } // sair da tela limpa o "visto"
  }, [aberto]);

  function abrirDetalhe(n) {
    setAberta(n);
    setDetItens(null);
    setDetAberto(true);
    detalhesNota(n.id).then((d) => setDetItens(d.itens)).catch(() => setDetItens([]));
  }

  // mercados distintos (para os ícones) e a lista filtrada pelo mercado escolhido.
  const lojas = notas ? [...new Set(notas.map((n) => n.loja).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt')) : [];
  const lista = notas && filtroLoja ? notas.filter((n) => n.loja === filtroLoja) : notas;

  const somaMes = (y, m) =>
    lista.filter((n) => +String(n.data).slice(0, 4) === y && +String(n.data).slice(5, 7) === m).reduce((a, n) => a + Number(n.total || 0), 0);

  let resumo = null;
  if (notas && notas.length) {
    const y = +String(notas[0].data).slice(0, 4), m = +String(notas[0].data).slice(5, 7);
    const soma = (arr) => arr.reduce((a, n) => a + Number(n.total || 0), 0);
    const doMes = notas.filter((n) => +String(n.data).slice(0, 4) === y && +String(n.data).slice(5, 7) === m);
    // mês anterior (gasto total) + comparação de PERÍODO HOMÓLOGO: o mês atual só
    // tem compras até hoje, por isso o % compara com o anterior ATÉ AO MESMO DIA.
    const pa = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
    const doAnterior = notas.filter((n) => +String(n.data).slice(0, 4) === pa.y && +String(n.data).slice(5, 7) === pa.m);
    const hoje = new Date();
    const mesCorrente = y === hoje.getFullYear() && m === hoje.getMonth() + 1;
    const diaCorte = mesCorrente ? hoje.getDate() : 31; // mês fechado → compara inteiro
    const anteriorMesmoPeriodo = soma(doAnterior.filter((n) => +String(n.data).slice(8, 10) <= diaCorte));
    const gasto = soma(doMes);
    const pct = anteriorMesmoPeriodo > 0 ? Math.round(((gasto - anteriorMesmoPeriodo) / anteriorMesmoPeriodo) * 100) : null;
    resumo = { mes: m, n: doMes.length, gasto, mesAnterior: pa.m, gastoAnterior: soma(doAnterior), pct };
  }

  return (
    <>
      <div className={`scrim ${aberto ? 'open' : ''}`} onClick={onFechar} />
      <section className={`sheet ${aberto ? 'open' : ''} cmp`} aria-label={t('cmp.title')}>
        <div className="sheet-h">
          <Mark size={30} chip />
          <span className="t">{t('cmp.title')}</span>
          <button className="sheet-x" onClick={onFechar} aria-label="fechar">
            <Ico name="close" size={18} />
          </button>
        </div>

        {resumo && (
          <div className="cmp-sum">
            <div className="cmp-s">
              <span className="cmp-k">{t('cmp.esteMes')}</span>
              <span className="cmp-v">{t('cmp.nCompras', { n: resumo.n })}</span>
            </div>
            <div className="cmp-s">
              <span className="cmp-k">{t('cmp.gasto', { mes: MESES[resumo.mes - 1].toLowerCase() })}</span>
              <span className="cmp-v eur">{eur(resumo.gasto)}</span>
              {resumo.pct != null && (
                <span className={`cmp-pct ${resumo.pct > 0 ? 'sobe' : 'desce'}`}>
                  {resumo.pct > 0 ? '▲' : resumo.pct < 0 ? '▼' : '='} {Math.abs(resumo.pct)}% {t('cmp.vsPeriodo')}
                </span>
              )}
            </div>
            <div className="cmp-s">
              <span className="cmp-k">{t('gastos.mesAnterior', { mes: MESES[resumo.mesAnterior - 1].toLowerCase() })}</span>
              <span className="cmp-v">{eur(resumo.gastoAnterior)}</span>
            </div>
          </div>
        )}

        {lojas.length > 1 && (
          <div className="cmp-lojas">
            {lojas.map((loja) => {
              const tm = lojaTema(loja);
              return (
                <button key={loja} type="button" title={loja}
                  className={`cmp-loja${filtroLoja === loja ? ' on' : ''}`} style={{ '--c': tm.c }}
                  onClick={() => setFiltroLoja(filtroLoja === loja ? null : loja)}>
                  <span className="cmp-loja-mono">{tm.mono}</span>
                </button>
              );
            })}
            {filtroLoja && (
              <button type="button" className="cmp-loja-todos" onClick={() => setFiltroLoja(null)}>{t('cmp.todos')}</button>
            )}
          </div>
        )}

        <div className="cmp-list">
          {notas === null ? (
            <p className="sheet-vazio">{t('chat.thinking')}</p>
          ) : lista.length === 0 ? (
            <p className="sheet-vazio">{t('cmp.semCompras')}</p>
          ) : (
            (() => {
              const anoBase = +String(lista[0].data).slice(0, 4);
              let lastY = null, lastM = null;
              const out = [];
              for (const n of lista) {
                const y = +String(n.data).slice(0, 4), m = +String(n.data).slice(5, 7);
                if (y !== lastY || m !== lastM) {
                  out.push(
                    <div key={`h${y}-${m}`} className="cmp-mes">
                      <b>{MESES[m - 1]}{y !== anoBase ? ` ${y}` : ''}</b>
                      <span className="cmp-ln" />
                      <span className="cmp-mt">{eur(somaMes(y, m))}</span>
                    </div>,
                  );
                  lastY = y;
                  lastM = m;
                }
                const tema = lojaTema(n.loja);
                out.push(
                  <button key={n.id} type="button" className={`cmp-card${aberta?.id === n.id ? ' visto' : ''}`} style={{ '--c': tema.c }} onClick={() => abrirDetalhe(n)}>
                    <span className="cmp-logo"><span className="cmp-mono">{tema.mono}</span></span>
                    <span className="cmp-ci">
                      <span className="cmp-nm">{n.loja}</span>
                      <span className="cmp-dt">
                        <span className="cmp-tag">{String(n.data).slice(8, 10)} {MESES[m - 1].slice(0, 3).toLowerCase()}</span>
                        {t('cmp.nItens', { n: n.n_itens })}
                      </span>
                    </span>
                    <span className="cmp-cr"><span className="cmp-pr">{eur(n.total)}</span></span>
                    <span className="cmp-chev"><Ico name="chevron" size={18} /></span>
                  </button>,
                );
              }
              return out;
            })()
          )}
        </div>

        <DetalheCompra
          aberto={detAberto}
          nota={aberta}
          itens={detItens}
          identificados={identificados}
          onVoltar={() => setDetAberto(false)}
          onInfo={onInfo}
          onIdentificar={onIdentificar}
        />
      </section>
    </>
  );
}

// Categorias de alto nível para a vista "por categoria" do detalhe da nota.
// Mapeia a categoria existente (frescos do `produto_generico` + OFF, PT+EN, suja)
// para ~10 grupos. v1 "começa com o que temos"; evoluirá para categoria por SKU.
const normCat = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const GRUPOS_CAT = [
  { id: 'frutas', label: 'Frutas e Vegetais', ic: '🍎', t: ['fruta', 'fruit', 'legume', 'vegetal', 'vegetable', 'verdura', 'hortic', 'hortofrut', 'salada', 'cogumelo', 'meloa', 'melao', 'melancia', 'salsa'] },
  { id: 'carne', label: 'Carne e Charcutaria', ic: '🥩', t: ['carne', 'meat', 'charcutaria', 'fiambre', 'ham', 'enchido', 'salsicha', 'sausage', 'salam', 'talho', 'aves', 'poultry', 'bovino', 'beef', 'suino', 'pork', 'porco', 'frango', 'chicken', 'peru'] },
  { id: 'peixe', label: 'Peixe e Marisco', ic: '🐟', t: ['peixe', 'fish', 'marisco', 'seafood', 'bacalhau', 'atum', 'tuna', 'salmao', 'salmon', 'pescado'] },
  { id: 'lacticinios', label: 'Laticínios e Ovos', ic: '🥛', t: ['laticinio', 'lacteo', 'lacte', 'dair', 'leite', 'milk', 'queijo', 'cheese', 'iogurte', 'yogurt', 'yoghurt', 'manteiga', 'butter', 'nata', 'ovo', 'ovos', 'egg', 'eggs', 'requeijao', 'kefir', 'skyr'] },
  { id: 'padaria', label: 'Padaria e Cereais', ic: '🥖', t: ['cereai', 'cereal', 'breakfast', 'pao', 'bread', 'padaria', 'bakery', 'pastelaria', 'massa', 'pasta', 'arroz', 'rice', 'farinha', 'flour', 'tosta', 'wrap', 'croissant', 'muesli', 'granola'] },
  { id: 'bebidas', label: 'Bebidas', ic: '🥤', t: ['bebida', 'beverage', 'drink', 'agua', 'water', 'sumo', 'juice', 'refrigerante', 'soda', 'cerveja', 'beer', 'vinho', 'wine', 'cafe', 'coffee', 'cha', 'tea', 'alcool', 'alcohol'] },
  { id: 'doces', label: 'Doces e Snacks', ic: '🍫', t: ['chocolate', 'doce', 'sweet', 'guloseima', 'candy', 'gelado', 'ice cream', 'snack', 'bolacha', 'biscuit', 'biscoito', 'cookie', 'sobremesa', 'dessert', 'mel', 'honey', 'compota', 'marmelada', 'jam'] },
  { id: 'congelados', label: 'Congelados', ic: '❄️', t: ['congelado', 'frozen', 'ultracongelado'] },
  { id: 'higiene', label: 'Higiene e Limpeza', ic: '🧼', t: ['higiene', 'hygiene', 'limpeza', 'cleaning', 'nao alimentar', 'detergente', 'detergent', 'papel', 'paper', 'cosmetic', 'sabonete', 'champo'] },
  { id: 'mercearia', label: 'Mercearia', ic: '🛒', t: ['mercearia', 'grocery', 'conserva', 'azeite', 'olive oil', 'oleo', 'oil', 'molho', 'sauce', 'tempero', 'especiaria', 'spice', 'enlatado', 'canned', 'sal', 'salt', 'acucar', 'sugar'] },
];
const CAT_OUTROS = { id: 'outros', label: 'Outros', ic: '⋯' };
// Match por INÍCIO de palavra, não substring ("VERMELHA" continha "mel" → Doces;
// "CHAMPO" continha "cha" → Bebidas). Termos curtos (≤3) exigem a palavra inteira;
// os longos podem ser prefixo ("cereai" apanha "cereais"). Regexes cacheadas.
const _catRe = new Map();
function catTermRe(term) {
  let re = _catRe.get(term);
  if (!re) {
    re = new RegExp(`(^|[^a-z0-9])${term}${term.length <= 3 ? '(?![a-z0-9])' : ''}`);
    _catRe.set(term, re);
  }
  return re;
}
function categoriaAlto(cat) {
  const s = normCat(cat);
  if (!s) return CAT_OUTROS;
  for (const g of GRUPOS_CAT) if (g.t.some((term) => catTermRe(term).test(s))) return g;
  return CAT_OUTROS;
}
// Grupo de um item: tenta pela categoria; se "Outros", tenta pelo NOME do produto
// (apanha "Ovos", "Sumo…", "Banana" quando a categoria está má/ausente — melhora a
// cobertura v1 até termos categoria limpa por SKU).
function grupoProduto(categoria, nome) {
  const g = categoriaAlto(categoria);
  return g.id === 'outros' ? categoriaAlto(nome) : g;
}

// Tamanho/formato do produto (cerveja "33 cl · lata", leite "1 l", fiambre "200 g"):
// junta o tamanho (produto_ean.quantidade) com o contentor lido na descrição crua do
// talão (LATA / GARRAFA / TP=tara perdida). Útil sobretudo em bebidas/embalados.
const CONTENTORES = [
  { re: /\blatas?\b/i, label: 'lata' },
  { re: /\b(garrafas?|grf|gf)\b/i, label: 'garrafa' },
  { re: /\btp\b/i, label: 'garrafa' },
  { re: /\bbarril\b/i, label: 'barril' },
];
function tamanhoTexto(s) {
  const m = String(s || '').match(/(\d+(?:[.,]\d+)?)\s*(cl|ml|lt|litros?|kg|gr|g|l)\b/i);
  if (!m) return null;
  const u = m[2].toLowerCase().replace(/^lt$/, 'l').replace(/^litros?$/, 'l').replace(/^gr$/, 'g');
  return `${m[1].replace('.', ',')} ${u}`;
}
function formatoProduto(it) {
  const desc = String(it.descricao_raw || '');
  let tam = tamanhoTexto(it.tamanho) || tamanhoTexto(desc);
  let cont = null;
  for (const c of CONTENTORES) if (c.re.test(desc)) { cont = c.label; break; }
  if (!tam && cont) { const b = desc.match(/\b(\d{2,3})\b/); if (b) tam = `${b[1]} cl`; } // bebida: nº ≈ cl
  return [tam, cont].filter(Boolean).join(' · ') || null;
}

// Detalhe de uma compra (slide-in): cabeçalho da loja + produtos + total. Tocar
// num produto abre a ficha (ou a identificação, se ainda for preciso). Três vistas:
// original (ordem da nota), A→Z, e por categoria (agrupada).
function DetalheCompra({ aberto, nota, itens, identificados, onVoltar, onInfo, onIdentificar }) {
  const [vista, setVista] = useState('original'); // original | alfa | categoria
  const tema = lojaTema(nota?.loja);
  const dia = nota ? String(nota.data).slice(8, 10) : '';
  const mes = nota ? +String(nota.data).slice(5, 7) : 1;
  // Agrega ocorrências do MESMO produto na nota (mesmo nome+marca+EAN+preço
  // unitário) numa só linha, somando quantidade e total — algumas lojas (ex.:
  // Mercadona) repetem o mesmo item em linhas separadas.
  const itensAgg = (() => {
    if (!Array.isArray(itens)) return itens;
    const mapa = new Map();
    const out = [];
    for (const it of itens) {
      const qtd = Number(it.quantidade) || 1;
      const linha = Number(it.preco) || 0;
      const unit = qtd ? linha / qtd : linha;
      const key = [it.produto, it.ean || '', limparMarca(it.marca) || '', Math.round(unit * 100)].join('|');
      const ex = mapa.get(key);
      if (ex) { ex.quantidade += qtd; ex.preco += linha; }
      else { const novo = { ...it, quantidade: qtd, preco: linha }; mapa.set(key, novo); out.push(novo); }
    }
    return out;
  })();
  const nprod = Array.isArray(itensAgg) ? itensAgg.length : nota?.n_itens || 0;

  // uma linha de produto (clicável → ficha; ou com botão de identificar)
  const linhaProduto = (it) => {
    const qtd = Number(it.quantidade) || 1;
    const linha = Number(it.preco) || 0;
    const unit = qtd ? linha / qtd : linha;
    const eanItem = it.ean || identificados?.[it.id] || null;
    const temFicha = !!it.tem_dados || !!identificados?.[it.id] || it.tipo_alimento === 'fresco';
    const marca = limparMarca(it.marca) || null;
    const fmt = formatoProduto(it);
    // sub-linha abaixo do nome: tamanho/formato + quantidade (quando há), juntos
    const sub = [fmt, qtd !== 1 ? `${qtd} × ${eur(unit)}` : null].filter(Boolean).join(' · ');
    return temFicha ? (
      <button key={it.id} type="button" className="cmp-prow clic" onClick={() => onInfo({ id: it.id, ean: eanItem, produto: it.produto })}>
        <span className="cmp-pn">
          <b>{it.produto}{marca && <em className="cmp-marca">{marca}</em>}</b>
          {sub && <span>{sub}</span>}
        </span>
        <span className="cmp-pp">{eur(linha)}</span>
      </button>
    ) : (
      <div key={it.id} className="cmp-prow">
        <span className="cmp-pn">
          <b>{it.produto}</b>
          {sub && <span>{sub}</span>}
        </span>
        <button type="button" className="cmp-pcam" onClick={() => onIdentificar({ id: it.id, sku_id: it.sku_id, produto: it.produto })} title={t('cmp.identTitle')} aria-label={t('cmp.identTitle')}>
          <Ico name="camera" size={16} />
        </button>
        <span className="cmp-pp">{eur(linha)}</span>
      </div>
    );
  };
  const porNome = (a, b) => String(a.produto).localeCompare(String(b.produto), 'pt');
  const ordemGrupo = (id) => { const i = GRUPOS_CAT.findIndex((x) => x.id === id); return i < 0 ? 99 : i; };

  return (
    <div className={`cmp-det ${aberto ? 'open' : ''}`} style={{ '--c': tema.c }} aria-hidden={!aberto}>
      <div className="cmp-dhead">
        <button className="cmp-back" onClick={onVoltar} aria-label="voltar">
          <Ico name="voltar" size={20} />
        </button>
        <span className="cmp-dava"><span className="cmp-mono">{tema.mono}</span></span>
        <span className="cmp-dht">
          <span className="cmp-dnm">{nota?.loja}</span>
          {nota && (
            <span className="cmp-ddt">
              {dia} de {MESES[mes - 1]} · {t('cmp.nItens', { n: nota.n_itens })}
            </span>
          )}
        </span>
      </div>
      {Array.isArray(itensAgg) && itensAgg.length > 0 && (
        <div className="cmp-vistas">
          <button type="button" className={vista === 'original' ? 'on' : ''} onClick={() => { setVista('original'); track('compra_vista', { vista: 'original' }); }} title={t('cmp.vNotaT')}>
            <Ico name="receipt" size={15} /> {t('cmp.vNota')}
          </button>
          <button type="button" className={vista === 'alfa' ? 'on' : ''} onClick={() => { setVista('alfa'); track('compra_vista', { vista: 'alfa' }); }} title={t('cmp.vAzT')}>A→Z</button>
          <button type="button" className={vista === 'categoria' ? 'on' : ''} onClick={() => { setVista('categoria'); track('compra_vista', { vista: 'categoria' }); }} title={t('cmp.vCatT')}>
            <Ico name="usual" size={15} /> {t('cmp.vCat')}
          </button>
        </div>
      )}
      <div className="cmp-dlist">
        {itens === null ? (
          <p className="sheet-vazio">{t('chat.thinking')}</p>
        ) : itensAgg.length === 0 ? (
          <p className="sheet-vazio">{t('cmp.semProdutos')}</p>
        ) : vista === 'categoria' ? (
          (() => {
            const grupos = new Map();
            for (const it of itensAgg) {
              const g = grupoProduto(it.categoria, it.produto);
              if (!grupos.has(g.id)) grupos.set(g.id, { g, lista: [] });
              grupos.get(g.id).lista.push(it);
            }
            return [...grupos.values()]
              .sort((a, b) => ordemGrupo(a.g.id) - ordemGrupo(b.g.id))
              .map(({ g, lista }) => (
                <div key={g.id} className="cmp-cat">
                  <div className="cmp-cat-h">
                    <span className="cmp-cat-ic">{g.ic}</span> {t(`cat.${g.id}`)}
                    <span className="cmp-cat-n">{lista.length}</span>
                  </div>
                  {[...lista].sort(porNome).map(linhaProduto)}
                </div>
              ));
          })()
        ) : (
          (vista === 'alfa' ? [...itensAgg].sort(porNome) : itensAgg).map(linhaProduto)
        )}
      </div>
      <div className="cmp-dfoot">
        <span className="cmp-dlab">{t('cmp.nProdutos', { n: nprod })}</span>
        <span className="cmp-dtot">{nota ? eur(nota.total) : ''}</span>
      </div>
    </div>
  );
}

// Despensa: produtos que conhecemos (com EAN), por ordem de compra desc. Tocar
// num produto abre a ficha completa (info + análise).
// timestamp de uma data em vários formatos (ISO, DD/MM/AAAA) para ordenar; null→fim.
function tsData(s) {
  if (!s) return null;
  const iso = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  const br = String(s).match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (br) { let y = +br[3]; if (y < 100) y += 2000; return Date.UTC(y, +br[2] - 1, +br[1]); }
  const d = Date.parse(s);
  return Number.isNaN(d) ? null : d;
}

function DespensaSheet({ aberto, produtos, onFechar, onInfo }) {
  const [ordem, setOrdem] = useState('data'); // data | nome | validade
  let lista = produtos;
  if (produtos) {
    lista = [...produtos];
    if (ordem === 'nome') {
      lista.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt', { sensitivity: 'base' }));
    } else if (ordem === 'validade') {
      lista.sort((a, b) => (tsData(a.validade) ?? Infinity) - (tsData(b.validade) ?? Infinity)); // a expirar primeiro
    } else {
      lista.sort((a, b) => (tsData(b.data) ?? -Infinity) - (tsData(a.data) ?? -Infinity)); // compra mais recente primeiro
    }
  }
  return (
    <>
      <div className={`scrim ${aberto ? 'open' : ''}`} onClick={onFechar} />
      <section className={`sheet ${aberto ? 'open' : ''}`} aria-label={t('desp.title')}>
        <div className="sheet-h">
          <Mark size={30} chip />
          <span className="t">{t('desp.title')}</span>
          <button className="sheet-x" onClick={onFechar} aria-label="fechar">
            <Ico name="close" size={18} />
          </button>
        </div>
        {produtos && produtos.length > 0 && (
          <div className="desp-ord">
            <span className="desp-ord-k">{t('desp.ordenar')}</span>
            {[['data', t('desp.ordData')], ['nome', t('desp.ordNome')], ['validade', t('desp.ordVal')]].map(([k, lbl]) => (
              <button key={k} className={ordem === k ? 'on' : ''} onClick={() => setOrdem(k)}>{lbl}</button>
            ))}
          </div>
        )}
        <div className="despensa-list">
          {produtos === null ? (
            <p className="sheet-vazio">{t('chat.thinking')}</p>
          ) : produtos.length === 0 ? (
            <p className="sheet-vazio">{t('desp.vazio')}</p>
          ) : (
            lista.map((p) => (
              <button key={p.ean} type="button" className="desp-row" onClick={() => onInfo({ id: p.item_id, ean: p.ean, produto: p.nome })}>
                <span className="desp-corpo">
                  <span className="desp-nome">{p.nome}</span>
                  {(() => {
                    const partes = [];
                    for (const x of [limparMarca(p.marca), p.loja]) {
                      const v = (x || '').trim();
                      if (v && !partes.some((y) => y.toLowerCase() === v.toLowerCase())) partes.push(v);
                    }
                    return partes.length ? <span className="desp-sub">{partes.join(' · ')}</span> : null;
                  })()}
                </span>
                {p.validade && <span className="desp-val">{t('desp.val', { data: fmtValidade(p.validade) })}</span>}
              </button>
            ))
          )}
        </div>
      </section>
    </>
  );
}

// Produtos por identificar (precisam de fotos), agrupados por LOJA e ordenados por
// nome dentro de cada loja. Cada produto tem a câmara para abrir a identificação.
function PorIdentificarSheet({ aberto, itens, onFechar, onCapturar, identificados, capturas, enviando, onEnviar }) {
  const pendentes = itens ? itens.filter((it) => !identificados?.[it.item_id]) : null;
  const nCap = capturas ? Object.keys(capturas).length : 0;
  // agrupa por mercado preservando a ordem (a query já vem ORDER BY loja, produto)
  const grupos = [];
  if (pendentes) {
    let atual = null;
    for (const it of pendentes) {
      if (!atual || atual.loja !== it.loja) { atual = { loja: it.loja, itens: [] }; grupos.push(atual); }
      atual.itens.push(it);
    }
  }
  return (
    <>
      <div className={`scrim ${aberto ? 'open' : ''}`} onClick={onFechar} />
      <section className={`sheet ${aberto ? 'open' : ''} cmp`} aria-label={t('menu.porident')}>
        <div className="sheet-h">
          <Mark size={30} chip />
          <span className="t">{t('pid.title')}{pendentes?.length ? ` · ${pendentes.length}` : ''}</span>
          <button className="sheet-x" onClick={onFechar} aria-label="fechar">
            <Ico name="close" size={18} />
          </button>
        </div>
        <div className="cmp-list pid-list">
          {pendentes === null ? (
            <p className="sheet-vazio">{t('chat.thinking')}</p>
          ) : pendentes.length === 0 ? (
            <p className="sheet-vazio">{t('pid.tudo')}</p>
          ) : (
            grupos.map((g) => {
              const tema = lojaTema(g.loja);
              return (
                <div key={g.loja} className="pid-grp" style={{ '--c': tema.c }}>
                  <div className="pid-cab">
                    <span className="cmp-logo"><span className="cmp-mono">{tema.mono}</span></span>
                    <span className="pid-cab-i">
                      <span className="cmp-nm">{g.loja}</span>
                      <span className="pid-cab-n">{t('pid.nPorIdent', { n: g.itens.length })}</span>
                    </span>
                  </div>
                  <div className="pid-card">
                    {g.itens.map((it) => {
                      const cap = capturas?.[it.item_id];
                      const mostraNota = it.descricao && it.descricao !== it.produto;
                      return (
                        <div key={it.item_id} className={`pid-row${cap ? ' on' : ''}`}>
                          <span className="pid-pn">
                            <b>{it.produto}</b>
                            {mostraNota && <span className="pid-nota">{it.descricao}</span>}
                            {cap && (
                              <span className="pid-badge" title={t('pid.badgeTitle')}>
                                {cap.ean ? `#${cap.ean.slice(-4)}` : t('pid.semCod')}{cap.fotos?.length ? ` · ${cap.fotos.length}📷` : ''}
                              </span>
                            )}
                          </span>
                          {it.preco != null && <span className="pid-pp">{eur(it.preco)}</span>}
                          <button
                            type="button"
                            className={`ni-ident${cap ? ' on' : ''}`}
                            onClick={() => onCapturar({ item_id: it.item_id, sku_id: it.sku_id, produto: it.produto })}
                            title={cap ? t('pid.rever') : t('pid.capturar')}
                            aria-label={t('pid.capturar')}
                          >
                            <Ico name="escanear" size={17} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
        {nCap > 0 && (
          <div className="pid-enviar">
            <button type="button" className="pid-enviar-btn" onClick={onEnviar} disabled={!!enviando}>
              <Ico name="send" size={18} /> {enviando || t('pid.enviarN', { n: nCap })}
            </button>
          </div>
        )}
      </section>
    </>
  );
}

// Object URLs estáveis para miniaturas: 1 URL por ficheiro (não por render — antes
// cada re-render criava blob-URLs novos para todas as fotos, nunca libertados =
// fuga de memória no telemóvel). Revoga os removidos e tudo ao desmontar.
function useObjectUrls(files) {
  const ref = useRef(new Map());
  const lista = files || [];
  const urls = lista.map((f) => {
    let u = ref.current.get(f);
    if (!u) { u = URL.createObjectURL(f); ref.current.set(f, u); }
    return u;
  });
  useEffect(() => {
    const atuais = new Set(lista);
    for (const [f, u] of ref.current) if (!atuais.has(f)) { URL.revokeObjectURL(u); ref.current.delete(f); }
  });
  useEffect(() => () => { for (const u of ref.current.values()) URL.revokeObjectURL(u); ref.current.clear(); }, []);
  return urls;
}

// Captura por item da lista "por identificar": lê o código de barras (scanner ao
// vivo) + fotos opcionais do rótulo, e GUARDA localmente (IndexedDB). Acumula até
// o "Enviar" da lista mandar tudo ao servidor. Reabrir um item já capturado mostra
// o que tem (rever / refazer).
function CapturaIdentSheet({ item, capturaExistente, onGuardado, onFechar }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const trackRef = useRef(null);
  const fotoRef = useRef(null);
  const [fase, setFase] = useState('scan'); // scan | fotos | erro
  const [ean, setEan] = useState('');
  const [fotos, setFotos] = useState([]);
  const fotoUrls = useObjectUrls(fotos);
  const [manual, setManual] = useState('');
  const [temLuz, setTemLuz] = useState(false);
  const [luz, setLuz] = useState(false);

  useEffect(() => {
    if (!item) return;
    if (capturaExistente) {
      setEan(capturaExistente.ean || '');
      setFotos(capturaExistente.fotos || []);
      setFase('fotos'); // já tem dados → vai direto à revisão
    } else {
      setEan('');
      setFotos([]);
      setFase('scan');
    }
    setManual('');
    setLuz(false);
    setTemLuz(false);
  }, [item]);

  // scanner ao vivo só enquanto na fase 'scan'
  useEffect(() => {
    if (!item || fase !== 'scan') return undefined;
    let controls;
    let parado = false;
    (async () => {
      try {
        const [{ BrowserMultiFormatReader }, lib] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
        const hints = new Map();
        hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [lib.BarcodeFormat.EAN_13, lib.BarcodeFormat.EAN_8, lib.BarcodeFormat.UPC_A, lib.BarcodeFormat.UPC_E]);
        hints.set(lib.DecodeHintType.TRY_HARDER, true);
        const reader = new BrowserMultiFormatReader(hints);
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
          videoRef.current,
          (result) => {
            if (!result || parado) return;
            const cod = result.getText().replace(/\D/g, '');
            if (cod.length < 8) return;
            parado = true;
            controls?.stop();
            try { navigator.vibrate?.(60); } catch { /* noop */ }
            setEan(cod);
            setFase('fotos');
          },
        );
        controlsRef.current = controls;
        const track = videoRef.current?.srcObject?.getVideoTracks?.()[0];
        if (track) {
          try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { /* noop */ }
          const caps = track.getCapabilities?.() || {};
          if (caps.torch) { trackRef.current = track; setTemLuz(true); }
        }
      } catch { setFase('erro'); }
    })();
    return () => { parado = true; controls?.stop(); controlsRef.current = null; trackRef.current = null; };
  }, [item, fase]);

  if (!item) return null;

  async function alternarLuz() {
    const tr = trackRef.current;
    if (!tr) return;
    const novo = !luz;
    try { await tr.applyConstraints({ advanced: [{ torch: novo }] }); setLuz(novo); } catch { /* noop */ }
  }

  async function guardar() {
    const e = String(ean || '').replace(/\D/g, '');
    if (!e && !fotos.length) return;
    try {
      await guardarCaptura({ item_id: item.id, ean: e || null, nome: item.produto, fotos, ts: Date.now() });
      onGuardado?.(item.id);
    } catch { /* noop */ }
    onFechar?.();
  }

  const podeGuardar = String(ean || '').replace(/\D/g, '').length >= 8 || fotos.length > 0;

  return (
    <>
      <div className="scrim open" onClick={onFechar} />
      <section className="sheet open" aria-label={t('capt.title')}>
        <div className="sheet-h">
          <Mark size={30} chip />
          <span className="t">{t('capt.title')}</span>
          <button className="sheet-x" onClick={onFechar} aria-label="fechar"><Ico name="close" size={18} /></button>
        </div>
        <div className="scan-body">
          <div className="ident-prod">{item.produto}</div>
          {fase === 'erro' ? (
            <>
              <p className="sheet-vazio">{t('capt.semCamera')}</p>
              <div className="scan-manual">
                <input inputMode="numeric" placeholder={t('capt.codigoPh')} value={manual} onChange={(e) => setManual(e.target.value.replace(/\D/g, ''))} />
                <button type="button" disabled={manual.length < 8} onClick={() => { setEan(manual); setFase('fotos'); }}>{t('capt.usar')}</button>
              </div>
              <button type="button" className="scan-foto" onClick={() => { setEan(''); setFase('fotos'); }}>{t('capt.soFotos')}</button>
            </>
          ) : fase === 'scan' ? (
            <>
              <div className="scan-cam">
                <video ref={videoRef} className="scan-video" playsInline muted />
                <div className="scan-mira" />
                {temLuz && (
                  <button type="button" className={`scan-luz ${luz ? 'on' : ''}`} onClick={alternarLuz} aria-label="lanterna"><Ico name="luz" size={20} /></button>
                )}
              </div>
              <p className="scan-hint">{t('capt.aponte')}</p>
              <div className="scan-manual">
                <input inputMode="numeric" placeholder={t('scanner.placeholderEan')} value={manual} onChange={(e) => setManual(e.target.value.replace(/\D/g, ''))} />
                <button type="button" disabled={manual.length < 8} onClick={() => { setEan(manual); setFase('fotos'); }}>{t('capt.usar')}</button>
              </div>
              <button type="button" className="scan-foto" onClick={() => { setEan(''); setFase('fotos'); }}>{t('capt.semCodBtn')}</button>
            </>
          ) : (
            <>
              <div className="capt-ean">
                {ean ? <span><b>{t('capt.codigo')}</b> {ean}</span> : <span className="capt-semcod">{t('capt.semCodigo')}</span>}
                <button type="button" className="capt-reler" onClick={() => setFase('scan')}>{t('capt.reler')}</button>
              </div>
              <input
                ref={fotoRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setFotos((x) => (x.length >= MAX_FOTOS ? x : [...x, f])); e.target.value = ''; }}
              />
              <button type="button" className="ident-add" onClick={() => fotoRef.current?.click()} disabled={fotos.length >= MAX_FOTOS}>
                <Ico name="camera" size={18} />{' '}
                {fotos.length >= MAX_FOTOS ? t('capt.maxFotos', { n: MAX_FOTOS }) : fotos.length ? t('capt.maisFoto', { i: fotos.length, n: MAX_FOTOS }) : t('capt.addFoto')}
              </button>
              {fotos.length > 0 && (
                <div className="ident-fotos">
                  {fotos.map((f, i) => (
                    <span key={i} className="ident-thumb">
                      <img src={fotoUrls[i]} alt="" />
                      <button type="button" onClick={() => setFotos((x) => x.filter((_, j) => j !== i))} aria-label="remover">×</button>
                    </span>
                  ))}
                </div>
              )}
              <button type="button" className="ident-go" onClick={guardar} disabled={!podeGuardar}>{t('capt.salvar')}</button>
            </>
          )}
        </div>
      </section>
    </>
  );
}

// Gastos: análise dos gastos de mercado (mês atual, anterior, média, por mês e
// por loja) em cards, para acompanhar as despesas domésticas.
function GastosSheet({ aberto, dados, onFechar }) {
  const d = dados;
  const nomeMes = (m) => MESES[(m || 1) - 1];
  const [todas, setTodas] = useState(null); // todas as notas (carregadas à 1.ª drill)
  const [mesSel, setMesSel] = useState(null); // { ano, mes } do card aberto
  const abrirMes = (ano, mes) => {
    setMesSel((cur) => (cur && cur.ano === ano && cur.mes === mes ? null : { ano, mes }));
    if (!todas) listarNotas().then(setTodas).catch(() => setTodas([]));
  };
  const selecionado = (ano, mes) => mesSel && mesSel.ano === ano && mesSel.mes === mes;
  const comprasMes =
    mesSel && todas
      ? todas.filter((n) => +String(n.data).slice(0, 4) === mesSel.ano && +String(n.data).slice(5, 7) === mesSel.mes)
      : null;
  return (
    <>
      <div className={`scrim ${aberto ? 'open' : ''}`} onClick={onFechar} />
      <section className={`sheet ${aberto ? 'open' : ''}`} aria-label={t('gastos.title')}>
        <div className="sheet-h">
          <Mark size={30} chip />
          <span className="t">{t('gastos.title')}</span>
          <button className="sheet-x" onClick={onFechar} aria-label="fechar">
            <Ico name="close" size={18} />
          </button>
        </div>
        <div className="gastos-body">
          {d === null ? (
            <p className="sheet-vazio">{t('chat.thinking')}</p>
          ) : d.erro ? (
            <p className="sheet-vazio">{t('gastos.falha')}</p>
          ) : (
            <>
              <div className="g-cards">
                <button
                  type="button"
                  className={`g-card destaque clic ${selecionado(d.atual.ano, d.atual.mes) ? 'sel' : ''}`}
                  onClick={() => abrirMes(d.atual.ano, d.atual.mes)}
                >
                  <span className="g-lbl">{t('gastos.esteMes', { mes: nomeMes(d.atual.mes) })}</span>
                  <span className="g-val">{eur(d.atual.total)}</span>
                  <span className="g-sub">{t('cmp.nCompras', { n: d.atual.n })} ›</span>
                </button>
                <button
                  type="button"
                  className={`g-card clic ${selecionado(d.anterior.ano, d.anterior.mes) ? 'sel' : ''}`}
                  onClick={() => abrirMes(d.anterior.ano, d.anterior.mes)}
                >
                  <span className="g-lbl">{t('gastos.mesAnterior', { mes: nomeMes(d.anterior.mes) })}</span>
                  <span className="g-val">{eur(d.anterior.total)}</span>
                  <span className="g-sub">{t('cmp.nCompras', { n: d.anterior.n })} ›</span>
                </button>
                <div className="g-card">
                  <span className="g-lbl">{t('gastos.media')}</span>
                  <span className="g-val">{eur(d.media)}</span>
                  <span className="g-sub">{t('gastos.nMeses', { n: d.serie.length })}</span>
                </div>
                <div className="g-card">
                  <span className="g-lbl">{t('gastos.vs')}</span>
                  {d.variacao == null ? (
                    <span className="g-val">—</span>
                  ) : (
                    <span className={`g-val ${d.variacao > 0 ? 'sobe' : 'desce'}`}>
                      {d.variacao > 0 ? '▲' : '▼'} {Math.abs(d.variacao)}%
                    </span>
                  )}
                  <span className="g-sub">{d.variacao == null ? t('gastos.semRef') : d.variacao > 0 ? t('gastos.mais') : t('gastos.menos')}</span>
                </div>
              </div>

              {mesSel && (
                <div className="g-compras">
                  <div className="g-bloco-t">{t('gastos.comprasDe', { mes: nomeMes(mesSel.mes), ano: mesSel.ano })}</div>
                  {comprasMes === null ? (
                    <p className="sheet-vazio">{t('chat.thinking')}</p>
                  ) : comprasMes.length === 0 ? (
                    <p className="g-vazio">{t('gastos.semMes')}</p>
                  ) : (
                    comprasMes.map((n) => (
                      <div key={n.id} className="g-compra">
                        <span className="g-compra-d">{String(n.data).slice(8, 10)}</span>
                        <span className="g-compra-l">{n.loja}</span>
                        <span className="g-compra-i">{t('cmp.nItens', { n: n.n_itens })}</span>
                        <span className="g-compra-v">{eur(n.total)}</span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {d.serie?.length > 1 && (
                <div className="g-graf">
                  <div className="g-bloco-t">{t('gastos.porMes')}</div>
                  <div className="g-barras">
                    {(() => {
                      const max = Math.max(...d.serie.map((s) => Number(s.total)), 1);
                      return d.serie.map((s) => (
                        <div key={`${s.ano}-${s.mes}`} className="g-barra">
                          <span className="g-barra-v">{Math.round(s.total)}</span>
                          <span className="g-barra-c" style={{ height: `${Math.max(4, (Number(s.total) / max) * 90)}px` }} />
                          <span className="g-barra-m">{MESES[s.mes - 1].slice(0, 3)}</span>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              )}

              {d.por_loja?.length > 0 && (
                <div className="g-lojas">
                  <div className="g-bloco-t">{t('gastos.onde')}</div>
                  {(() => {
                    const max = Math.max(...d.por_loja.map((l) => Number(l.total)), 1);
                    return d.por_loja.map((l) => (
                      <div key={l.loja} className="g-loja">
                        <span className="g-loja-n">{l.loja}</span>
                        <span className="g-loja-bar"><span style={{ width: `${(Number(l.total) / max) * 100}%` }} /></span>
                        <span className="g-loja-v">{eur(l.total)}</span>
                      </div>
                    ));
                  })()}
                </div>
              )}

              <p className="g-total">{t('gastos.total')} <b>{eur(d.total_geral)}</b></p>
            </>
          )}
        </div>
      </section>
    </>
  );
}

// COMPARAR PRODUTOS (na prateleira): scan CONTÍNUO de 2-6 códigos → bandeja de
// chips (nome instantâneo via base local; desconhecidos resolvem-se em fundo e
// acumulam conhecimento no servidor) → "Comparar" → ranking personalizado pelo
// perfil ativo (ou factual, sem perfil). Alergénio do perfil = "evitar" (regra dura).
const MAX_COMPARAR = 6;
function CompararSheet({ aberto, onFechar }) {
  const videoRef = useRef(null);
  const trackRef = useRef(null);
  const [fase, setFase] = useState('scan'); // scan | comparando | resultado
  const [itens, setItens] = useState([]); // [{ean, nome|null}]
  const [res, setRes] = useState(null);
  const [manual, setManual] = useState('');
  const [aviso, setAviso] = useState('');
  const [temLuz, setTemLuz] = useState(false);
  const [luz, setLuz] = useState(false);
  const itensRef = useRef(itens);
  itensRef.current = itens;

  function adicionar(cod) {
    const c = String(cod).replace(/\D/g, '');
    if (c.length < 8) return;
    if (itensRef.current.some((x) => x.ean === c)) return; // contínuo relê o mesmo código — ignora
    if (itensRef.current.length >= MAX_COMPARAR) { setAviso(t('comp.max', { n: MAX_COMPARAR })); return; }
    try { navigator.vibrate?.(50); } catch { /* noop */ }
    setItens((xs) => [...xs, { ean: c, nome: null }]);
    setAviso('');
    (async () => {
      const local = (await fichaLocal(c).catch(() => null)) || (await catalogoLocal(c).catch(() => null));
      if (local?.nome) { setItens((xs) => xs.map((x) => (x.ean === c ? { ...x, nome: local.nome } : x))); return; }
      try {
        const r = await consultarProdutoEan(c); // resolve E acumula no servidor
        if (r?.nome) setItens((xs) => xs.map((x) => (x.ean === c ? { ...x, nome: r.nome } : x)));
      } catch { /* offline → fica o EAN no chip */ }
    })();
  }

  // reset ao fechar
  useEffect(() => {
    if (!aberto) { setFase('scan'); setItens([]); setRes(null); setManual(''); setAviso(''); setLuz(false); setTemLuz(false); }
  }, [aberto]);

  // scanner CONTÍNUO enquanto na fase 'scan' (não para no 1.º código)
  useEffect(() => {
    if (!aberto || fase !== 'scan') return undefined;
    let controls;
    let parado = false;
    (async () => {
      try {
        const [{ BrowserMultiFormatReader }, lib] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
        const hints = new Map();
        hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [lib.BarcodeFormat.EAN_13, lib.BarcodeFormat.EAN_8, lib.BarcodeFormat.UPC_A, lib.BarcodeFormat.UPC_E]);
        hints.set(lib.DecodeHintType.TRY_HARDER, true);
        const reader = new BrowserMultiFormatReader(hints);
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
          videoRef.current,
          (result) => { if (!result || parado) return; adicionar(result.getText()); },
        );
        const track2 = videoRef.current?.srcObject?.getVideoTracks?.()[0];
        if (track2) {
          try { await track2.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { /* noop */ }
          const caps = track2.getCapabilities?.() || {};
          if (caps.torch) { trackRef.current = track2; setTemLuz(true); }
        }
      } catch { setAviso(t('scanner.semCamera')); }
    })();
    return () => { parado = true; controls?.stop(); trackRef.current = null; };
  }, [aberto, fase]);

  async function alternarLuz() {
    const tr = trackRef.current;
    if (!tr) return;
    const novo = !luz;
    try { await tr.applyConstraints({ advanced: [{ torch: novo }] }); setLuz(novo); } catch { /* noop */ }
  }

  async function comparar() {
    if (itens.length < 2 || fase === 'comparando') return;
    setFase('comparando');
    try {
      const r = await compararProdutos(itens.map((x) => x.ean));
      setRes(r);
      setFase('resultado');
    } catch {
      setAviso(t('comp.falha'));
      setFase('scan');
    }
  }

  if (!aberto) return null;
  const nomeDe = (ean) => res?.produtos?.find((p) => p.ean === ean)?.nome || itens.find((x) => x.ean === ean)?.nome || ean;
  const medalha = (pos) => (pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : `${pos}º`);

  return (
    <>
      <div className="scrim open" onClick={onFechar} />
      <section className="sheet open" aria-label={t('comp.title')}>
        <div className="sheet-h">
          <Mark size={30} chip />
          <span className="t">{t('comp.title')}</span>
          <button className="sheet-x" onClick={onFechar} aria-label="fechar"><Ico name="close" size={18} /></button>
        </div>
        <div className="scan-body">
          {fase === 'resultado' && res ? (
            <div className="comp-res">
              {res.perfil
                ? <div className="comp-perfil">✨ {t('comp.paraPerfil', { nome: res.perfil })}</div>
                : <div className="comp-semperfil">{t('comp.semPerfil')}</div>}
              {res.resumo && <p className="comp-resumo">{res.resumo}</p>}
              {(res.ranking || []).map((r) => (
                <div key={r.ean} className={`comp-card v-${r.veredicto || 'atencao'}`}>
                  <div className="comp-card-h">
                    <span className="comp-medal">{medalha(r.posicao)}</span>
                    <span className="comp-nome">{nomeDe(String(r.ean))}</span>
                    <span className={`comp-verd v-${r.veredicto || 'atencao'}`}>{r.veredicto}</span>
                  </div>
                  {r.motivo && <p className="comp-motivo">{r.motivo}</p>}
                  {r.alertas?.length > 0 && <p className="comp-alerta">⚠ {r.alertas.join(' · ')}</p>}
                  {(r.a_favor?.length > 0 || r.contra?.length > 0) && (
                    <div className="comp-pontos">
                      {(r.a_favor || []).map((x, i) => <span key={`f${i}`} className="comp-pt ok">✓ {x}</span>)}
                      {(r.contra || []).map((x, i) => <span key={`c${i}`} className="comp-pt mau">✗ {x}</span>)}
                    </div>
                  )}
                </div>
              ))}
              <button type="button" className="ident-go" onClick={() => { setRes(null); setItens([]); setFase('scan'); }}>{t('comp.nova')}</button>
            </div>
          ) : (
            <>
              <div className="scan-cam">
                <video ref={videoRef} className="scan-video" playsInline muted />
                <div className="scan-mira" />
                {temLuz && fase === 'scan' && (
                  <button type="button" className={`scan-luz ${luz ? 'on' : ''}`} onClick={alternarLuz} aria-label="lanterna"><Ico name="luz" size={20} /></button>
                )}
                {fase === 'comparando' && <div className="scan-overlay">{t('comp.comparando')}</div>}
              </div>
              <p className="scan-hint">{t('comp.hint')}</p>
              {itens.length === 0 ? (
                <p className="comp-vazio">{t('comp.vazio')}</p>
              ) : (
                <div className="comp-tray">
                  {itens.map((x) => (
                    <button key={x.ean} type="button" className="comp-chip" title={t('comp.removerT')}
                      onClick={() => setItens((xs) => xs.filter((y) => y.ean !== x.ean))}>
                      {x.nome || `…${x.ean.slice(-6)}`} <span className="comp-x">×</span>
                    </button>
                  ))}
                </div>
              )}
              {aviso && <p className="comp-aviso">{aviso}</p>}
              <div className="scan-manual">
                <input inputMode="numeric" placeholder={t('comp.placeholderEan')} value={manual} onChange={(e) => setManual(e.target.value.replace(/\D/g, ''))} />
                <button type="button" disabled={manual.length < 8} onClick={() => { adicionar(manual); setManual(''); }}>{t('comp.add')}</button>
              </div>
              <button type="button" className="ident-go" onClick={comparar} disabled={itens.length < 2 || fase === 'comparando'}>
                {fase === 'comparando' ? t('comp.comparando') : t('comp.comparar', { n: itens.length })}
              </button>
            </>
          )}
        </div>
      </section>
    </>
  );
}

// Scanner de código de barras: consulta um produto no mercado (sem ligação a nota).
// Lê o EAN com a câmara (zxing, carregado on-demand), consulta a base → OFF, e
// abre a ficha do produto (que também guarda os dados para uso futuro).
function ScannerSheet({ aberto, onFechar, onEncontrado }) {
  const videoRef = useRef(null);
  const trackRef = useRef(null);
  const controlsRef = useRef(null);
  const fotoRef = useRef(null);
  const [fase, setFase] = useState('scan'); // scan | foto | consulta | naoencontrado | semcodigo | erro
  const [ean, setEan] = useState(null);
  const [tentativa, setTentativa] = useState(0);
  const [temLuz, setTemLuz] = useState(false);
  const [luz, setLuz] = useState(false);
  const [manual, setManual] = useState('');
  const [nomeQ, setNomeQ] = useState('');

  // Consulta por NOME (texto/voz): frescos sem código (figo, fraldinha). Abre a ficha
  // pela nutrição-por-nome; embalados → mensagem a pedir o código/rótulo.
  async function consultarNome(nome) {
    const q = String(nome || '').trim();
    if (q.length < 2) return;
    setEan(null);
    setFase('consulta');
    try {
      const r = await consultarProdutoNome(q);
      if (r.encontrado && r.sku_id) onEncontrado({ sku_id: r.sku_id, nome: r.nome });
      else setFase('embalado');
    } catch {
      setFase('embalado');
    }
  }

  // Foto do código (fallback): tenta descodificar a foto com zxing (exato) e, se
  // falhar, o VLM lê o número (validado pelo dígito verificador no backend).
  async function lerFoto(file) {
    if (!file) return;
    controlsRef.current?.stop();
    setFase('foto');
    const url = URL.createObjectURL(file);
    try {
      const [{ BrowserMultiFormatReader }, lib] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
      const hints = new Map();
      hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [lib.BarcodeFormat.EAN_13, lib.BarcodeFormat.EAN_8, lib.BarcodeFormat.UPC_A, lib.BarcodeFormat.UPC_E]);
      hints.set(lib.DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints);
      const res = await reader.decodeFromImageUrl(url);
      const cod = res.getText().replace(/\D/g, '');
      URL.revokeObjectURL(url);
      if (cod.length >= 8) return consultarCod(cod);
    } catch {
      URL.revokeObjectURL(url);
    }
    try {
      const r = await lerEanFoto(file);
      if (r.ean) return consultarCod(r.ean);
      setFase('semcodigo');
    } catch {
      setFase('semcodigo');
    }
  }

  async function consultarCod(cod) {
    const c = String(cod).replace(/\D/g, '');
    if (c.length < 8) return;
    setEan(c);
    setFase('consulta');
    // LOCAL-FIRST: produto já na base local → ficha instantânea (e offline); a
    // consulta ao servidor segue em fundo (acumula p/ a próxima sincronização).
    const local = await fichaLocal(c).catch(() => null);
    if (local) {
      onEncontrado({ ean: c, nome: local.nome, local });
      consultarProdutoEan(c).catch(() => {});
      return;
    }
    const cat = await catalogoLocal(c).catch(() => null);
    if (cat) {
      onEncontrado({ ean: c, nome: cat.nome, local: { ...cat, soCatalogo: true } });
      consultarProdutoEan(c).catch(() => {});
      return;
    }
    try {
      const r = await consultarProdutoEan(c);
      if (r.encontrado) onEncontrado({ ean: r.ean, nome: r.nome });
      else setFase('naoencontrado');
    } catch {
      setFase('naoencontrado');
    }
  }

  useEffect(() => {
    if (!aberto) return undefined;
    setFase('scan');
    setEan(null);
    setTemLuz(false);
    setLuz(false);
    let controls;
    let parado = false;
    (async () => {
      try {
        const [{ BrowserMultiFormatReader }, lib] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
        const hints = new Map();
        hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [lib.BarcodeFormat.EAN_13, lib.BarcodeFormat.EAN_8, lib.BarcodeFormat.UPC_A, lib.BarcodeFormat.UPC_E]);
        hints.set(lib.DecodeHintType.TRY_HARDER, true);
        const reader = new BrowserMultiFormatReader(hints);
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
          videoRef.current,
          (result) => {
            if (!result || parado) return;
            const cod = result.getText().replace(/\D/g, '');
            if (cod.length < 8) return;
            parado = true;
            controls?.stop();
            consultarCod(cod);
          },
        );
        controlsRef.current = controls;
        // foco contínuo + deteção de lanterna (torch), quando suportados
        const track = videoRef.current?.srcObject?.getVideoTracks?.()[0];
        if (track) {
          try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { /* ignora */ }
          const caps = track.getCapabilities?.() || {};
          if (caps.torch) { trackRef.current = track; setTemLuz(true); }
        }
      } catch {
        setFase('erro');
      }
    })();
    return () => {
      parado = true;
      controls?.stop();
      controlsRef.current = null;
      trackRef.current = null;
    };
  }, [aberto, tentativa]);

  async function alternarLuz() {
    const tr = trackRef.current;
    if (!tr) return;
    const novo = !luz;
    try { await tr.applyConstraints({ advanced: [{ torch: novo }] }); setLuz(novo); } catch { /* ignora */ }
  }

  if (!aberto) return null;
  return (
    <>
      <div className="scrim open" onClick={onFechar} />
      <section className="sheet open" aria-label={t('scanner.title')}>
        <div className="sheet-h">
          <Mark size={30} chip />
          <span className="t">{t('scanner.title')}</span>
          <button className="sheet-x" onClick={onFechar} aria-label="fechar">
            <Ico name="close" size={18} />
          </button>
        </div>
        <div className="scan-body">
          {fase === 'erro' ? (
            <p className="sheet-vazio">{t('scanner.semCamera')}</p>
          ) : (
            <>
              <div className="scan-cam">
                <video ref={videoRef} className="scan-video" playsInline muted />
                <div className="scan-mira" />
                {temLuz && fase === 'scan' && (
                  <button type="button" className={`scan-luz ${luz ? 'on' : ''}`} onClick={alternarLuz} aria-label="lanterna">
                    <Ico name="luz" size={20} />
                  </button>
                )}
                {fase === 'foto' && <div className="scan-overlay">{t('scanner.lendoFoto')}</div>}
                {fase === 'consulta' && <div className="scan-overlay">{t('scanner.consultando', { q: ean || 'produto' })}</div>}
                {fase === 'embalado' && (
                  <div className="scan-overlay">
                    <p>{t('scanner.embalado')}</p>
                    <button className="scan-retry" onClick={() => setTentativa((x) => x + 1)}>{t('scanner.voltarCamera')}</button>
                  </div>
                )}
                {fase === 'naoencontrado' && (
                  <div className="scan-overlay">
                    <p>{t('scanner.naoEncontrado', { ean })}</p>
                    <button className="scan-retry" onClick={() => setTentativa((x) => x + 1)}>{t('scanner.lerOutro')}</button>
                  </div>
                )}
                {fase === 'semcodigo' && (
                  <div className="scan-overlay">
                    <p>{t('scanner.semCodigo')}</p>
                    <button className="scan-retry" onClick={() => setTentativa((x) => x + 1)}>{t('scanner.voltarCamera')}</button>
                  </div>
                )}
              </div>
              <p className="scan-hint">{t('scanner.aproxime')}</p>
              <input ref={fotoRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { lerFoto(e.target.files?.[0]); e.target.value = ''; }} />
              <button type="button" className="scan-foto" onClick={() => fotoRef.current?.click()}>
                <Ico name="camera" size={18} /> {t('scanner.tirarFoto')}
              </button>
              <div className="scan-manual">
                <input inputMode="numeric" placeholder={t('scanner.placeholderEan')} value={manual} onChange={(e) => setManual(e.target.value.replace(/\D/g, ''))} />
                <button type="button" disabled={manual.length < 8} onClick={() => consultarCod(manual)}>{t('scanner.consultar')}</button>
              </div>
              <div className="scan-manual">
                <input placeholder={t('scanner.placeholderNome')} value={nomeQ}
                  onChange={(e) => setNomeQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') consultarNome(nomeQ); }} />
                <button type="button" disabled={nomeQ.trim().length < 2} onClick={() => consultarNome(nomeQ)}>{t('scanner.consultar')}</button>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}

// Perfil nutricional por membro: carrega o ficheiro (gerado por LLM), extrai o
// resumo e ativa-o para as avaliações personalizadas.
function PerfilSheet({ aberto, onFechar }) {
  const [perfis, setPerfis] = useState(null);
  const [nome, setNome] = useState('Sue');
  const [texto, setTexto] = useState('');
  const [a, setA] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef(null);
  const recarregar = () => listarPerfis().then(setPerfis).catch(() => setPerfis([]));
  useEffect(() => {
    if (aberto) recarregar();
  }, [aberto]);

  async function salvar(conteudo) {
    if (!conteudo?.trim()) return;
    setA(true);
    setMsg('a extrair o perfil…');
    try {
      const r = await carregarPerfil({ nome: nome.trim(), texto: conteudo });
      setMsg(`✓ perfil de ${r.nome} carregado e ativo`);
      setTexto('');
      await recarregar();
    } catch {
      setMsg('falha a carregar o perfil');
    } finally {
      setA(false);
    }
  }
  async function carregar(file) {
    if (!file) return;
    setMsg('a ler o ficheiro…');
    salvar(await file.text());
  }

  if (!aberto) return null;
  return (
    <>
      <div className="scrim open" onClick={onFechar} />
      <section className="sheet open" aria-label="Perfil nutricional">
        <div className="sheet-h">
          <Mark size={30} chip />
          <span className="t">Perfil nutricional</span>
          <button className="sheet-x" onClick={onFechar} aria-label="fechar"><Ico name="close" size={18} /></button>
        </div>
        <div className="perfil-body">
          <p className="perfil-intro">Carrega o ficheiro do perfil (gerado pelo LLM) de um membro. Fica ativo para as avaliações personalizadas dos produtos.</p>
          <label className="perfil-lbl">Membro</label>
          <input className="perfil-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: Sue" />
          <input ref={fileRef} type="file" accept=".txt,.md,.json,text/plain" hidden onChange={(e) => { carregar(e.target.files?.[0]); e.target.value = ''; }} />
          <button type="button" className="perfil-add" disabled={a || !nome.trim()} onClick={() => fileRef.current?.click()}>
            <Ico name="ficheiro" size={18} /> {a ? 'a processar…' : 'Carregar ficheiro do perfil'}
          </button>

          <div className="perfil-ou">ou cola o texto do perfil</div>
          <textarea
            className="perfil-texto"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Cola aqui o conteúdo do perfil (o texto que a Sue gerou)…"
            rows={6}
          />
          <button type="button" className="perfil-add solido" disabled={a || !nome.trim() || !texto.trim()} onClick={() => salvar(texto)}>
            {a ? 'a processar…' : 'Guardar perfil (texto colado)'}
          </button>
          {msg && <p className="perfil-msg">{msg}</p>}

          {perfis === null ? (
            <p className="sheet-vazio">{t('chat.thinking')}</p>
          ) : perfis.length === 0 ? (
            <p className="sheet-vazio">Ainda sem perfis.</p>
          ) : (
            <div className="perfil-lista">
              {perfis.map((p) => (
                <div key={p.id} className={`perfil-card ${p.ativo ? 'on' : ''}`}>
                  <div className="perfil-card-h">
                    <b>{p.nome}</b>
                    {p.ativo ? <span className="perfil-ativo">ativo</span> : <button className="perfil-usar" onClick={async () => { await ativarPerfil(p.id); recarregar(); }}>usar</button>}
                  </div>
                  <ResumoPerfil r={p.resumo} />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function ResumoPerfil({ r }) {
  if (!r) return null;
  const chips = (lst) => (lst || []).map((x, i) => <span key={i} className="pf-chip">{x}</span>);
  return (
    <div className="pf-resumo">
      {r.alergias?.length > 0 && <div className="pf-linha"><b>Alergias:</b> {chips(r.alergias)}</div>}
      {r.intolerancias?.length > 0 && <div className="pf-linha"><b>Intolerâncias:</b> {chips(r.intolerancias)}</div>}
      {r.objetivos?.length > 0 && <div className="pf-linha"><b>Objetivos:</b> {chips(r.objetivos)}</div>}
      {r.restricoes?.length > 0 && <div className="pf-linha"><b>Restrições:</b> {chips(r.restricoes)}</div>}
      {r.evitar?.length > 0 && <div className="pf-linha"><b>Evitar:</b> {chips(r.evitar)}</div>}
    </div>
  );
}

// Limite de fotos por identificação (acompanha o limite do backend). Mudável.
const MAX_FOTOS = 10;

// Identificar produto: EAN + fotos → VLM (rótulos) e OFF (EAN). Mostra ambos.
function ProdutoIdentSheet({ item, onFechar, onIdentificado }) {
  const [ean, setEan] = useState('');
  const [fotos, setFotos] = useState([]);
  const fotoUrls = useObjectUrls(fotos);
  const [res, setRes] = useState(null);
  const [a, setA] = useState(false);
  const fotoRef = useRef(null);
  useEffect(() => {
    setEan('');
    setFotos([]);
    setRes(null);
    setA(false);
  }, [item]);
  if (!item) return null;
  async function analisar() {
    if (a || (!ean.trim() && !fotos.length)) return;
    setA(true);
    setRes(null);
    try {
      const r = await identificarProduto({ ean: ean.trim() || undefined, skuId: item.sku_id || undefined, itemId: item.id || undefined, fotos });
      setRes(r);
      if (r && !r.erro && r.ean && item?.id) onIdentificado?.(item.id, r.ean); // remove o ícone/pendência sem refresh
    } catch (e) {
      setRes({ erro: true, msg: e.message });
    } finally {
      setA(false);
    }
  }
  return (
    <>
      <div className="scrim open" onClick={onFechar} />
      <section className="sheet open ident" aria-label={t('ident.title')}>
        <div className="sheet-h">
          <Mark size={30} chip />
          <span className="t">{t('ident.title')}</span>
          <button className="sheet-x" onClick={onFechar} aria-label="fechar">
            <Ico name="close" size={18} />
          </button>
        </div>
        <div className="ident-body">
          <div className="ident-prod">{item.produto}</div>
          <label className="ident-lbl">{t('ident.eanLbl')}</label>
          <input className="ident-ean" inputMode="numeric" placeholder="ex.: 5601234567890" value={ean} onChange={(e) => setEan(e.target.value)} />
          {/* capture SEM multiple (a combinação devolve 0 ficheiros em iOS); uma foto
              por toque, acumula. Tocar de novo para a próxima (frente · rótulo · ingredientes). */}
          <input
            ref={fotoRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setFotos((x) => (x.length >= MAX_FOTOS ? x : [...x, f]));
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="ident-add"
            onClick={() => fotoRef.current?.click()}
            disabled={fotos.length >= MAX_FOTOS}
          >
            <Ico name="camera" size={18} />{' '}
            {fotos.length >= MAX_FOTOS
              ? t('capt.maxFotos', { n: MAX_FOTOS })
              : fotos.length
                ? t('capt.maisFoto', { i: fotos.length, n: MAX_FOTOS })
                : t('ident.addFoto')}
          </button>
          {fotos.length > 0 && (
            <div className="ident-fotos">
              {fotos.map((f, i) => (
                <span key={i} className="ident-thumb">
                  <img src={fotoUrls[i]} alt="" />
                  <button type="button" onClick={() => setFotos((x) => x.filter((_, j) => j !== i))} aria-label="remover">×</button>
                </span>
              ))}
            </div>
          )}
          <button type="button" className="ident-go" onClick={analisar} disabled={a || (!ean.trim() && !fotos.length)}>
            {a ? t('ident.analisando') : t('ident.analisar')}
          </button>
          {res && <ResultadoIdent res={res} />}
        </div>
      </section>
    </>
  );
}

// Toda a info que TEMOS de um produto (item da nota que já tem EAN). Reusa o
// display do resultado de identificação + mostra as fotos guardadas do produto.
// Constrói o objeto de info da ficha a partir da BASE LOCAL (mesma forma do
// consolidarProduto do servidor) — para a ficha abrir instantânea/offline.
function infoDeLocal(l, ean) {
  if (l.soCatalogo) {
    return { ean, nome: l.nome, fonte: 'catalogo', vlm: null, off: null, fotos: [], existe: true, local: true,
      base: { nome: l.nome, marca: l.marca, quantidade: l.quantidade, fonte: 'catalogo' } };
  }
  return { ean, nome: l.nome, fonte: l.fonte || 'off', vlm: null, base: null, fotos: [], existe: true, local: true,
    off: { nome: l.nome, marca: l.marca, quantidade: l.quantidade, categoria: l.categoria,
      ingredientes: l.ingredientes, alergenios: l.alergenios, nutricao_100g: l.nutricao_100g } };
}

function ProdutoInfoSheet({ item, onFechar }) {
  const [info, setInfo] = useState(null); // null = a carregar
  const [analise, setAnalise] = useState(null); // null = a carregar · {erro} em falha
  const [aval, setAval] = useState(null); // avaliação personalizada (perfil ativo)
  useEffect(() => {
    if (!item) return;
    // SEED da base local: mostra já o que temos no telefone (instantâneo/offline);
    // a rede enriquece por trás e, se falhar, o local fica (não vira "erro").
    const seed = item.local ? infoDeLocal(item.local, item.ean) : null;
    setInfo(seed);
    setAnalise(item.local?.analise || null);
    setAval(null);
    infoProduto({ itemId: item.id, ean: item.ean, skuId: item.sku_id })
      .then(setInfo)
      .catch(() => setInfo((cur) => cur ?? { erro: true }));
    // a análise corre por item/EAN OU por SKU (fresco genérico, foto solta — o
    // /analise gera o parecer da nutrição típica). A avaliação personalizada só
    // por item/EAN (precisa do perfil ativo).
    if (item.id || item.ean || item.sku_id) {
      analiseProduto({ itemId: item.id, ean: item.ean, skuId: item.sku_id })
        .then((r) => setAnalise(r.analise || { erro: true }))
        .catch(() => setAnalise((cur) => cur ?? { erro: true }));
      avaliacaoPersonalizada({ itemId: item.id, ean: item.ean, skuId: item.sku_id })
        .then((r) => setAval(r?.perfil ? r : null))
        .catch(() => setAval(null));
    } else {
      setAnalise({ erro: true });
      setAval(null);
    }
  }, [item]);
  if (!item) return null;
  return (
    <>
      <div className="scrim open" onClick={onFechar} />
      <section className="sheet open ident" aria-label={t('info.title')}>
        <div className="sheet-h">
          <Mark size={30} chip />
          <span className="t">{t('info.title')}</span>
          <button className="sheet-x" onClick={onFechar} aria-label="fechar">
            <Ico name="close" size={18} />
          </button>
        </div>
        <div className="ident-body">
          <div className="ident-prod">{item.produto}</div>
          {info === null ? (
            <p className="sheet-vazio">{t('chat.thinking')}</p>
          ) : info.erro ? (
            <p className="sheet-vazio">Falha a carregar a informação.</p>
          ) : (
            <>
              {aval && <AvaliacaoPessoal aval={aval} />}
              {info.fonte === 'generico' && (
                <p className="info-generico">{t('info.generico')}</p>
              )}
              {info.fonte === 'catalogo' && info.base && (
                <div className="info-catalogo">
                  <div className="info-cat-linha">
                    {info.base.marca && <span className="info-cat-marca">{limparMarca(info.base.marca)}</span>}
                    {info.base.quantidade && <span className="info-cat-tam">{info.base.quantidade}</span>}
                  </div>
                  {info.base.categoria && <div className="info-cat-cat">{info.base.categoria}</div>}
                  <p className="info-generico">{t('info.catalogo')}</p>
                </div>
              )}
              <AnaliseProduto a={analise} n={info.off?.nutricao_100g || info.vlm?.nutricao_100g || info.generico?.nutricao_100g} />
              {info.fotos?.length > 0 && (
                <div className="info-fotos">
                  {info.fotos.map((f) => (
                    <AuthImg key={f.id} id={f.id} />
                  ))}
                </div>
              )}
              <details className="info-bruto">
                <summary>Dados em bruto (VLM · Open Food Facts)</summary>
                <ResultadoIdent res={info} />
              </details>
            </>
          )}
        </div>
      </section>
    </>
  );
}

// <img> para rotas protegidas: o <img src> não envia o header de auth, por isso
// buscamos o blob com fetch (com auth) e mostramo-lo via object URL.
function AuthImg({ id }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let vivo = true;
    let u;
    fotoProdutoUrl(id)
      .then((x) => {
        if (vivo) {
          u = x;
          setUrl(x);
        } else URL.revokeObjectURL(x);
      })
      .catch(() => {});
    return () => {
      vivo = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  return url ? <img className="info-foto" src={url} alt="" loading="lazy" /> : <span className="info-foto ph" />;
}

// Selo Nutri-Score no formato oficial: escala A B C D E com a letra ativa em
// destaque (maior, com contorno). Cores oficiais do rótulo.
const NS_CORES = { A: '#038141', B: '#85bb2f', C: '#fecb02', D: '#ef8200', E: '#e63e11' };
function NutriSelo({ grau }) {
  const g = String(grau || '').toUpperCase();
  if (!['A', 'B', 'C', 'D', 'E'].includes(g)) return null;
  return (
    <span className="nutri-selo" role="img" aria-label={`Nutri-Score ${g}`}>
      <span className="ns-cap">NUTRI-SCORE</span>
      <span className="ns-escala">
        {['A', 'B', 'C', 'D', 'E'].map((l) => (
          <span key={l} className={`ns-cel${l === g ? ' on' : ''}`} style={{ background: NS_CORES[l] }}>
            {l}
          </span>
        ))}
      </span>
    </span>
  );
}

// Semáforo nutricional (UK FSA / "traffic light"): cor por nutriente segundo os
// limiares oficiais por 100 g (sólidos), + % da dose de referência do adulto.
const RI_ADULTO = { energia_kcal: 2000, gordura: 70, gordura_saturada: 20, acucares: 90, sal: 6 };
const SF_LIMIARES = { gordura: [3.0, 17.5], gordura_saturada: [1.5, 5.0], acucares: [5.0, 22.5], sal: [0.3, 1.5] };
const SF_COR = { baixo: '#3a9b3a', medio: '#e8a000', alto: '#d6271f' };
const SF_TXT = { baixo: 'BAIXO', medio: 'MÉDIO', alto: 'ALTO' };
function sfNivel(key, v) {
  const [lo, hi] = SF_LIMIARES[key];
  return v <= lo ? 'baixo' : v <= hi ? 'medio' : 'alto';
}
function SemaforoNutri({ n }) {
  if (!n) return null;
  const cols = [
    { key: 'gordura', rotulo: 'Gordura' },
    { key: 'gordura_saturada', rotulo: 'Saturados' },
    { key: 'acucares', rotulo: 'Açúcares' },
    { key: 'sal', rotulo: 'Sal' },
  ].filter((c) => n[c.key] != null);
  if (!cols.length) return null;
  const pct = (v, ri) => Math.round((v / ri) * 100);
  return (
    <div className="semaforo">
      <div className="sf-titulo">Cada 100 g contém</div>
      <div className="sf-linha">
        {n.energia_kcal != null && (
          <div className="sf-cel energia">
            <div className="sf-rot">Energia</div>
            <div className="sf-val">{Math.round(n.energia_kcal)}<span>kcal</span></div>
            <div className="sf-pct">{pct(n.energia_kcal, RI_ADULTO.energia_kcal)}%</div>
          </div>
        )}
        {cols.map((c) => {
          const v = n[c.key];
          const nv = sfNivel(c.key, v);
          return (
            <div key={c.key} className="sf-cel" style={{ background: SF_COR[nv] }}>
              <div className="sf-rot">{c.rotulo}</div>
              <div className="sf-val">{v}<span>g</span></div>
              <div className="sf-tag">{SF_TXT[nv]}</div>
              <div className="sf-pct">{pct(v, RI_ADULTO[c.key])}%</div>
            </div>
          );
        })}
      </div>
      <div className="sf-rodape">% da dose de referência de um adulto (8400 kJ / 2000 kcal)</div>
    </div>
  );
}

// Tabela de informação nutricional, estilo "Nutrition Facts" (por 100 g).
function NutritionFacts({ n }) {
  if (!n) return null;
  const g = (x) => (x != null ? `${x} g` : null);
  const linhas = [
    ['Energia', n.energia_kcal != null ? `${Math.round(n.energia_kcal)} kcal` : null, false, true],
    ['Gordura', g(n.gordura), false, false],
    ['dos quais saturados', g(n.gordura_saturada), true, false],
    ['Hidratos de carbono', g(n.hidratos), false, false],
    ['dos quais açúcares', g(n.acucares), true, false],
    ['Fibra', g(n.fibra), false, false],
    ['Proteína', g(n.proteina), false, false],
    ['Sal', g(n.sal), false, false],
  ].filter(([, v]) => v != null);
  if (!linhas.length) return null;
  return (
    <div className="nfacts">
      <div className="nf-titulo">Informação Nutricional</div>
      <div className="nf-sub">Valores por 100 g</div>
      {linhas.map(([k, v, ind, forte], i) => (
        <div key={i} className={`nf-row${ind ? ' ind' : ''}${forte ? ' forte' : ''}`}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
    </div>
  );
}

// Faixa de AVISOS no topo (estilo Chile "ALTO EM" + alergénio). Derivada dos
// limiares do semáforo: o que é "alto" (vermelho) vira octógono de aviso.
function FaixaAvisos({ n, alergenios }) {
  const avisos = [];
  if (n) {
    const mapa = { gordura_saturada: 'GORDURA SATURADA', gordura: 'GORDURA', acucares: 'AÇÚCAR', sal: 'SAL' };
    for (const k of ['gordura_saturada', 'gordura', 'acucares', 'sal']) {
      if (n[k] != null && sfNivel(k, n[k]) === 'alto') avisos.push(mapa[k]);
    }
  }
  const alerg = (alergenios || []).filter(Boolean);
  if (!avisos.length && !alerg.length) return null;
  return (
    <div className="avisos">
      {avisos.map((tx) => (
        <span key={tx} className="aviso-oct" role="img" aria-label={`Alto em ${tx}`}>
          <b>ALTO EM</b>
          <span>{tx}</span>
        </span>
      ))}
      {alerg.length > 0 && (
        <span className="aviso-alerg">
          Contém
          <b>{alerg.join(', ').toUpperCase()}</b>
        </span>
      )}
    </div>
  );
}

// Rodapé de transparência: de onde vem cada classificação + aviso factual.
function RodapeFontes() {
  return (
    <div className="an-rodape">
      <p className="rod-fontes">
        Fontes: dados nutricionais e Nutri-Score do Open Food Facts; ingredientes lidos do rótulo por IA; nível NOVA e limiares do semáforo segundo a FSA (Reino Unido), por 100 g.
      </p>
      <p className="rod-aviso">Informação factual sobre o produto. Não é aconselhamento de saúde nem substitui um profissional.</p>
    </div>
  );
}

// Avaliação PERSONALIZADA do produto para o perfil ativo (no topo da ficha):
// alertas determinísticos (alergias/evitar) + veredicto e parecer do LLM.
function AvaliacaoPessoal({ aval }) {
  const v = aval.avaliacao || {};
  const cls = v.veredicto === 'evitar' ? 'evitar' : v.veredicto === 'atencao' ? 'atencao' : 'adequado';
  const rotulo = v.veredicto === 'evitar' ? 'Evitar' : v.veredicto === 'atencao' ? 'Atenção' : 'Adequado';
  return (
    <div className={`ap ap-${cls}`}>
      <div className="ap-h">
        <span className="ap-quem">Para {aval.perfil}</span>
        {v.veredicto && <span className={`ap-vd ap-vd-${cls}`}>{rotulo}</span>}
      </div>
      {aval.alertas?.length > 0 && (
        <div className="ap-alertas">
          {aval.alertas.map((al, i) => <div key={i} className="ap-alerta">⚠ {al.texto}</div>)}
        </div>
      )}
      {v.resumo && <p className="ap-resumo">{v.resumo}</p>}
      {(v.a_favor?.length > 0 || v.contra?.length > 0) && (
        <div className="ap-listas">
          {v.a_favor?.length > 0 && (
            <ul className="ap-favor">{v.a_favor.map((x, i) => <li key={i}>{x}</li>)}</ul>
          )}
          {v.contra?.length > 0 && (
            <ul className="ap-contra">{v.contra.map((x, i) => <li key={i}>{x}</li>)}</ul>
          )}
        </div>
      )}
    </div>
  );
}

// Análise factual (não clínica) do produto: avisos, Nutri-Score + NOVA, semáforo,
// tabela, parecer (LLM), destaques, aditivos e ingredientes explicados.
function AnaliseProduto({ a, n }) {
  if (a === null) return <p className="sheet-vazio">a analisar…</p>;
  if (a.erro) return <p className="sheet-vazio">Não foi possível analisar este produto.</p>;
  const ns = a.nutriscore?.grau;
  const nova = a.nivel_processamento?.nova;
  const aditivos = (a.ingredientes || []).filter((i) => i.e_numero);
  return (
    <div className="analise">
      <FaixaAvisos n={n} alergenios={a.alergenios} />
      {a.resumo && <p className="an-resumo">{a.resumo}</p>}
      {(ns || nova) && (
        <div className="an-badges">
          {ns && <NutriSelo grau={ns} />}
          {nova && <span className="nova">NOVA {nova}{a.nivel_processamento?.rotulo ? ` · ${a.nivel_processamento.rotulo}` : ''}</span>}
        </div>
      )}
      <SemaforoNutri n={n} />
      <NutritionFacts n={n} />
      {a.parecer && (
        <div className="an-parecer">
          <h4>Parecer</h4>
          <p>{a.parecer}</p>
        </div>
      )}
      {(a.nutriscore?.porque || a.nivel_processamento?.porque) && (
        <div className="an-porques">
          {a.nutriscore?.porque && <p><b>Nutri-Score:</b> {a.nutriscore.porque}</p>}
          {a.nivel_processamento?.porque && <p><b>Processamento:</b> {a.nivel_processamento.porque}</p>}
        </div>
      )}
      {a.destaques?.length > 0 && (
        <div className="an-destaques">
          {a.destaques.map((d, i) => (
            <span key={i} className={`an-tag t-${d.tom || 'neutro'}`}>{d.texto}</span>
          ))}
        </div>
      )}
      {aditivos.length > 0 && (
        <div className="an-aditivos">
          <h4>Aditivos · {aditivos.length}</h4>
          {aditivos.map((i, idx) => (
            <div key={idx} className="adt-item">
              {i.e_numero && <span className="adt-e">{i.e_numero}</span>}
              <span className="adt-corpo">
                <span className="adt-nome">{i.nome}</span>
                {i.funcao && <span className="adt-f">{i.funcao}</span>}
                {i.nota && <span className="adt-nota">{i.nota}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      {a.ingredientes?.length > 0 && (
        <div className="an-ings">
          <h4>Ingredientes · {a.ingredientes.length}</h4>
          {a.ingredientes.map((ing, i) => (
            <div key={i} className="an-ing">
              <div className="an-ing-h">
                <span className="an-ing-nome">{ing.nome}</span>
                {ing.e_numero && <span className="an-e">{ing.e_numero}</span>}
                {ing.tipo && <span className="an-tipo">{ing.tipo}</span>}
              </div>
              {ing.funcao && (
                <div className="an-ing-f">
                  {ing.funcao}
                  {ing.origem ? ` · origem: ${ing.origem}` : ''}
                </div>
              )}
              {ing.nota && <div className="an-ing-nota">{ing.nota}</div>}
            </div>
          ))}
        </div>
      )}
      {a.alergenios?.length > 0 && (
        <div className="an-alerg">
          <b>Alergénios:</b> {a.alergenios.join(', ')}
        </div>
      )}
      <RodapeFontes />
    </div>
  );
}

function ResultadoIdent({ res }) {
  if (res.erro) return <p className="sheet-vazio">{res.msg || 'Falha a analisar.'}</p>;
  return (
    <div className="ident-res">
      {res.ean_rejeitado && !res.ean && (
        <div className="ident-aviso">⚠ O código de barras lido não passou na validação (dígito verificador) — provavelmente foi mal lido. Tira uma foto mais nítida do código, ou escreve o EAN à mão.</div>
      )}
      {res.ean && <div className="ident-eanok">EAN usado: <b>{res.ean}</b></div>}
      <FonteIdent titulo="📷 Lido das fotos (VLM)" d={res.vlm} vazio="sem fotos analisadas" />
      <FonteIdent titulo="🌐 Open Food Facts (pelo EAN)" d={res.off} nutri={res.off?.nutriscore} nova={res.off?.nova} vazio="este EAN não está no Open Food Facts" />
    </div>
  );
}

function FonteIdent({ titulo, d, nutri, nova, vazio }) {
  return (
    <div className="ident-fonte">
      <h4>{titulo}</h4>
      {!d || d.erro ? (
        <p className="ident-na">{vazio}</p>
      ) : (
        <>
          {d.nome && (
            <div className="ident-nome">
              <b>{d.nome}</b>
              {d.marca ? ` · ${limparMarca(d.marca)}` : ''}
              {d.quantidade ? ` · ${d.quantidade}` : ''}
            </div>
          )}
          {(nutri || nova) && (
            <div className="ident-badges">
              {nutri && <NutriSelo grau={nutri} />}
              {nova && <span className="nova">NOVA {nova}</span>}
            </div>
          )}
          <TabNut n={d.nutricao_100g} />
          {d.ingredientes && <div className="ident-txt"><span className="k">Ingredientes:</span> {d.ingredientes}</div>}
          {d.alergenios && <div className="ident-txt"><span className="k">Alergénios:</span> {d.alergenios}</div>}
          {d.validade && <div className="ident-txt"><span className="k">Validade:</span> {d.validade}</div>}
        </>
      )}
    </div>
  );
}

function TabNut({ n }) {
  if (!n) return null;
  const linhas = [
    ['Energia', n.energia_kcal, 'kcal'], ['Gordura', n.gordura, 'g'], ['— saturada', n.gordura_saturada, 'g'],
    ['Hidratos', n.hidratos, 'g'], ['— açúcares', n.acucares, 'g'], ['Fibra', n.fibra, 'g'], ['Proteína', n.proteina, 'g'], ['Sal', n.sal, 'g'],
  ].filter(([, v]) => v != null);
  if (!linhas.length) return null;
  return (
    <table className="ident-nut">
      <tbody>
        {linhas.map(([k, v, u]) => (
          <tr key={k}>
            <td>{k}</td>
            <td>{v} {u}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Linha do carrinho: arrasta para a DIREITA para apagar (revela 🗑).
function ItemCarrinho({ it, onRemover }) {
  const [dx, setDx] = useState(0);
  const [hist, setHist] = useState(null); // null = fechado; array = aberto
  const [carregando, setCarregando] = useState(false);
  const g = useRef({ x0: 0, y0: 0, horiz: false, mov: false, dx: 0 });
  async function alternarHist(e) {
    e.stopPropagation();
    if (hist) return setHist(null); // fechar
    setCarregando(true);
    try {
      setHist(await historicoProduto(it.nome));
    } catch {
      setHist([]);
    } finally {
      setCarregando(false);
    }
  }
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
        <button
          type="button"
          className={`cp-hist ${hist ? 'on' : ''}`}
          onClick={alternarHist}
          aria-label={t('cart.hist')}
        >
          <Ico name="receipt" size={15} />
        </button>
        {it.preco != null && <span className="cp">{eur(it.preco)}</span>}
      </div>
      {hist && (
        <div className="crow-hist">
          {carregando ? (
            <div className="ch-vazio">{t('cart.histLoad')}</div>
          ) : hist.length === 0 ? (
            <div className="ch-vazio">{t('cart.histEmpty')}</div>
          ) : (
            hist.map((h, i) => (
              <div key={i} className="ch-row">
                <span className="ch-data">{h.data}</span>
                <span className="ch-loja">{h.cadeia || h.loja}</span>
                <span className="ch-preco">
                  {eur(h.preco_por_base)}
                  <span className="ch-un">/{h.unidade_base || 'un'}</span>
                  {Math.abs(Number(h.preco_por_base) - Number(h.preco)) > 0.01 && (
                    <span className="ch-pago"> · {eur(h.preco)}</span>
                  )}
                  {h.is_clearance ? <span className="ch-promo"> ⚡</span> : null}
                </span>
              </div>
            ))
          )}
        </div>
      )}
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
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const SVG_GAL = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="M5 17l4.5-4.5a2 2 0 0 1 2.8 0L19 19" />
  </svg>
);
const SVG_FILE = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 16V7" /><path d="M8.5 10.5L12 7l3.5 3.5" /><path d="M5 16v1.5A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5V16" />
  </svg>
);
const SVG_SEARCH = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
  </svg>
);
const PILL_IC = { searching: SVG_SEARCH, near: <Ico name="chart" size={16} />, locked: <Ico name="check" size={16} /> };

// Digitalização guiada (handoff "Captura"): feed + deteção ao vivo (jscanify) →
// cantos branco→amarelo→verde + contorno real; captura → pré-visualização.
function Camera({ aberto, onCapturar, onFicheiro, onFechar }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const overlayRef = useRef(null); // canvas do contorno verde ao vivo
  const flashRef = useRef(null);
  const [erro, setErro] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [preview, setPreview] = useState(null); // { url, file, info, importado }
  const [lock, setLock] = useState('searching'); // searching | near | locked

  // Câmara
  useEffect(() => {
    if (!aberto) {
      setPreview((p) => {
        if (p?.url) URL.revokeObjectURL(p.url);
        return null;
      });
      setProcessando(false);
      setLock('searching');
      return;
    }
    let cancelado = false;
    setErro(false);
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
          audio: false,
        });
        if (cancelado) return stream.getTracks().forEach((tr) => tr.stop());
        streamRef.current = stream;
        try {
          const track = stream.getVideoTracks()[0];
          const caps = track.getCapabilities?.() || {};
          if (caps.focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
        } catch {
          /* noop */
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        if (!cancelado) setErro(true);
      }
    })();
    return () => {
      cancelado = true;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, [aberto]);

  // Re-liga o stream ao voltar da pré-visualização.
  useEffect(() => {
    if (aberto && !preview && !erro && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [preview, aberto, erro]);

  // Deteção ao vivo: corre o jscanify a ~3 fps sobre um frame reduzido, define o
  // estado (searching/near/locked) e desenha o contorno real sobre o feed.
  useEffect(() => {
    if (!aberto || preview || erro) return;
    let parar = false;
    let ocupado = false;
    const small = document.createElement('canvas');
    const sctx = small.getContext('2d');
    const LARG = 720;
    const id = setInterval(async () => {
      const v = videoRef.current;
      const ov = overlayRef.current;
      if (!v || !v.videoWidth || ocupado || parar) return;
      ocupado = true;
      try {
        const esc = LARG / v.videoWidth;
        small.width = LARG;
        small.height = Math.round(v.videoHeight * esc);
        sctx.drawImage(v, 0, 0, small.width, small.height);
        // race com timeout: se a deteção pendurar, não bloqueia o loop (ocupado liberta no finally)
        const c = await Promise.race([
          detectarPapel(small),
          new Promise((r) => setTimeout(() => r('TIMEOUT'), 1800)),
        ]);
        if (parar) return;
        if (c === 'TIMEOUT') return;
        let novo = 'searching';
        if (c) {
          const pts = [c.topLeftCorner, c.topRightCorner, c.bottomRightCorner, c.bottomLeftCorner];
          const xs = pts.map((p) => p.x);
          const ys = pts.map((p) => p.y);
          const cov = ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))) / (small.width * small.height);
          const top = dist2(c.topLeftCorner, c.topRightCorner);
          const bot = dist2(c.bottomLeftCorner, c.bottomRightCorner);
          const lft = dist2(c.topLeftCorner, c.bottomLeftCorner);
          const rgt = dist2(c.topRightCorner, c.bottomRightCorner);
          const skew = Math.max(top / bot, bot / top, lft / rgt, rgt / lft);
          const m = 0.03;
          const naBorda = (p) => (p.x < small.width * m || p.x > small.width * (1 - m)) && (p.y < small.height * m || p.y > small.height * (1 - m));
          const moldura = pts.filter(naBorda).length >= 3 || cov > 0.85;
          novo = cov >= 0.25 && cov <= 0.82 && skew <= 1.9 && !moldura ? 'locked' : 'near';
        }
        setLock(novo);
        if (ov.width !== v.videoWidth || ov.height !== v.videoHeight) {
          ov.width = v.videoWidth;
          ov.height = v.videoHeight;
        }
        const ctx = ov.getContext('2d');
        ctx.clearRect(0, 0, ov.width, ov.height);
        if (c && novo !== 'searching') {
          const f = v.videoWidth / small.width;
          const pts = [c.topLeftCorner, c.topRightCorner, c.bottomRightCorner, c.bottomLeftCorner];
          ctx.beginPath();
          ctx.moveTo(pts[0].x * f, pts[0].y * f);
          for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x * f, pts[i].y * f);
          ctx.closePath();
          ctx.lineWidth = Math.max(3, v.videoWidth / 150);
          ctx.strokeStyle = novo === 'locked' ? '#46d488' : '#f0b53c';
          ctx.shadowColor = novo === 'locked' ? 'rgba(70,212,136,.6)' : 'rgba(240,181,60,.45)';
          ctx.shadowBlur = 16;
          ctx.stroke();
          if (novo === 'locked') {
            ctx.fillStyle = 'rgba(70,212,136,.12)';
            ctx.fill();
          }
        }
      } catch {
        /* noop */
      } finally {
        ocupado = false;
      }
    }, 350);
    return () => {
      parar = true;
      clearInterval(id);
    };
  }, [aberto, preview, erro]);

  if (!aberto) return null;

  async function capturar() {
    const v = videoRef.current;
    if (!v || !v.videoWidth || processando) return;
    const fl = flashRef.current;
    if (fl) {
      fl.classList.remove('go');
      void fl.offsetWidth;
      fl.classList.add('go');
    }
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
    setPreview({ url: URL.createObjectURL(file), file, info, importado: false });
  }

  function enviar() {
    if (!preview) return;
    const f = preview.file;
    URL.revokeObjectURL(preview.url);
    setPreview(null);
    onCapturar(f);
  }
  function repetir() {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  const estado = preview ? 'preview' : erro ? 'error' : 'live';
  const chip = preview?.importado
    ? t('preview.imported')
    : preview?.info?.dewarped || preview?.info?.recortado
    ? t('preview.ok')
    : t('preview.foto');

  return (
    <div className={`cap st-${estado} lock-${lock}`}>
      {/* ── LIVE ── */}
      <video ref={videoRef} className="cap-feed" playsInline muted autoPlay />
      <canvas ref={overlayRef} className="cap-overlay" />
      <div className="cap-stage">
        <div className="cap-hole" />
        <div className="cap-frame">
          <div className="cap-scan" />
          <span className="cnr tl" /><span className="cnr tr" /><span className="cnr bl" /><span className="cnr br" />
        </div>
      </div>
      <div className="cap-top">
        <div className="cap-ttl">
          <b>{t('scan.title')}</b>
          <span>{t('scan.subtitle')}</span>
        </div>
        <button className="cap-x" onClick={onFechar} aria-label="fechar">
          <Ico name="close" size={22} />
        </button>
      </div>
      <div className="cap-guide">
        <div className="cap-pill">
          <span className="dot" />
          <span className="pic">{PILL_IC[lock]}</span>
          <span>{t(`scan.status.${lock}`)}</span>
        </div>
        <p className="cap-helper">
          {processando ? t('cam.processando') : t('scan.hint')}
          {!processando && <span className="sub">{t('scan.hintSub')}</span>}
        </p>
      </div>
      <div className="cap-bottom">
        <button className="cap-gal" onClick={onFicheiro}>
          <span className="box">{SVG_GAL}</span>
          <span>{t('scan.gallery')}</span>
        </button>
        <button className="cap-shutter" onClick={capturar} disabled={processando} aria-label={t('cam.capture')}>
          <span className="ring" />
          <span className="core" />
        </button>
        <span className="cap-tips" aria-hidden="true">
          <Ico name="spark" size={21} />
        </span>
      </div>
      <div ref={flashRef} className="cap-flash" />

      {/* ── PREVIEW ── */}
      {preview && (
        <div className="cap-pv">
          <div className="cap-pv-top">
            <span className="cap-pv-chip">
              <Ico name="check" size={16} /> {chip}
            </span>
            <button className="cap-pv-x" onClick={onFechar} aria-label="fechar">
              <Ico name="close" size={20} />
            </button>
          </div>
          <div className="cap-pv-stage">
            <div className="cap-pv-card">
              <img src={preview.url} alt="pré-visualização da nota" />
              <span className="corner c1" /><span className="corner c2" /><span className="corner c3" /><span className="corner c4" />
            </div>
          </div>
          <p className="cap-pv-meta">{t('preview.meta')}</p>
          <div className="cap-pv-actions">
            <button className="cap-pv-btn retry" onClick={repetir}>
              <Ico name="sync" size={20} /> {t('cam.repetir')}
            </button>
            <button className="cap-pv-btn send" onClick={enviar}>
              <Ico name="check" size={20} /> {t('cam.enviar')}
            </button>
          </div>
        </div>
      )}

      {/* ── ERROR ── */}
      {erro && (
        <div className="cap-err">
          <div className="cap-err-ic">
            <Ico name="camera" size={38} />
          </div>
          <h2>{t('error.title')}</h2>
          <p>{t('error.body')}</p>
          <button className="cap-err-btn" onClick={onFicheiro}>
            {SVG_FILE} {t('error.choose')}
          </button>
        </div>
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

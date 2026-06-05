import { useEffect, useRef, useState } from 'react';
import { verificarSessao, setAuth, clearAuth, consultar, enviarFatura, enviarVoz, carregarConversa, carregarHabituais } from './api.js';
import { t, detetarLocale } from './i18n.js';

detetarLocale('pt-BR'); // default; usa o idioma do browser se houver dicionário

const eur = (v) => (v == null ? '—' : `${Number(v).toFixed(2).replace('.', ',')} €`);
const hora = () => new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
const dataCurta = (iso) => {
  const s = String(iso || '').slice(0, 10);
  return s ? s.slice(8, 10) + '/' + s.slice(5, 7) : '';
};

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
  const fimRef = useRef(null);
  const fileRef = useRef(null);
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

  async function fatura(file) {
    if (!file || ocupado) return;
    add({ lado: 'user', tipo: 'ficheiro', nome: file.name });
    setOcupado(true);
    add({ lado: 'bot', tipo: 'pensar', texto: t('nota.reading') });
    try {
      const out = await enviarFatura(file);
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
        <strong>🛍️ Bigbag</strong>
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
        <button type="button" className="icone" onClick={() => fileRef.current?.click()} disabled={ocupado} aria-label="fatura">
          📷
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            fatura(f);
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
  const itens = d.itens || [];
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
            <span>{it.descricao_original}</span>
            <b>{eur(it.preco_unitario ?? it.preco_liquido)}</b>
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

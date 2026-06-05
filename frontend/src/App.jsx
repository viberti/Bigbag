import { useEffect, useRef, useState } from 'react';
import { verificarSessao, setAuth, clearAuth, consultar, enviarFatura, enviarVoz } from './api.js';

const eur = (v) => (v == null ? '—' : `${Number(v).toFixed(2).replace('.', ',')} €`);

export default function App() {
  const [sessao, setSessao] = useState(undefined); // undefined=a carregar, null=fora, {user}=dentro
  const [aba, setAba] = useState('perguntar');

  useEffect(() => {
    verificarSessao()
      .then(setSessao)
      .catch(() => setSessao(null));
  }, []);

  if (sessao === undefined) return <div className="centro">a carregar…</div>;
  if (!sessao) return <Login onEntrar={setSessao} />;

  return (
    <div className="app">
      <header>
        <strong>🛍️ Bigbag</strong>
        <span className="utilizador">
          {sessao.user?.id}
          <button
            className="link"
            onClick={() => {
              clearAuth();
              setSessao(null);
            }}
          >
            sair
          </button>
        </span>
      </header>

      <nav className="abas">
        <button className={aba === 'perguntar' ? 'ativo' : ''} onClick={() => setAba('perguntar')}>
          Perguntar
        </button>
        <button className={aba === 'voz' ? 'ativo' : ''} onClick={() => setAba('voz')}>
          Voz
        </button>
        <button className={aba === 'fatura' ? 'ativo' : ''} onClick={() => setAba('fatura')}>
          Nova fatura
        </button>
      </nav>

      <main>
        {aba === 'perguntar' && <Perguntar />}
        {aba === 'voz' && <Voz />}
        {aba === 'fatura' && <Fatura />}
      </main>
    </div>
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
      const s = await verificarSessao();
      onEntrar(s);
    } catch {
      clearAuth();
      setErro('Credenciais inválidas.');
    } finally {
      setAEntrar(false);
    }
  }

  return (
    <form className="login" onSubmit={submeter}>
      <h1>🛍️ Bigbag</h1>
      <p className="subtitulo">Histórico de preços de compras</p>
      <input placeholder="utilizador" value={user} onChange={(e) => setUser(e.target.value)} autoCapitalize="none" />
      <input placeholder="password" type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
      {erro && <div className="erro">{erro}</div>}
      <button disabled={aEntrar || !user || !pass}>{aEntrar ? '…' : 'Entrar'}</button>
    </form>
  );
}

function Perguntar() {
  const [pergunta, setPergunta] = useState('');
  const [resposta, setResposta] = useState(null);
  const [tools, setTools] = useState([]);
  const [aPensar, setAPensar] = useState(false);
  const [erro, setErro] = useState('');

  const exemplos = [
    'quanto gastei em fruta este mês?',
    'qual o preço da banana ao longo do tempo?',
    'onde comprei salmão da última vez?',
  ];

  async function enviar(p) {
    const q = (p ?? pergunta).trim();
    if (!q) return;
    setPergunta(q);
    setAPensar(true);
    setErro('');
    setResposta(null);
    try {
      const out = await consultar(q);
      setResposta(out.resposta);
      setTools((out.chamadas || []).map((c) => c.nome));
    } catch {
      setErro('Falha na consulta.');
    } finally {
      setAPensar(false);
    }
  }

  return (
    <div className="cartao">
      <textarea
        rows={3}
        placeholder="Pergunta sobre as tuas compras…"
        value={pergunta}
        onChange={(e) => setPergunta(e.target.value)}
      />
      <button onClick={() => enviar()} disabled={aPensar || !pergunta.trim()}>
        {aPensar ? 'a pensar…' : 'Perguntar'}
      </button>

      {!resposta && !aPensar && (
        <div className="exemplos">
          {exemplos.map((ex) => (
            <button key={ex} className="chip" onClick={() => enviar(ex)}>
              {ex}
            </button>
          ))}
        </div>
      )}

      {erro && <div className="erro">{erro}</div>}
      {resposta && (
        <div className="resposta">
          <p style={{ whiteSpace: 'pre-wrap' }}>{resposta}</p>
          {tools.length > 0 && <div className="meta">via {tools.join(', ')}</div>}
        </div>
      )}
    </div>
  );
}

function Voz() {
  const [estado, setEstado] = useState('idle'); // idle | a-gravar | a-processar
  const [res, setRes] = useState(null);
  const [erro, setErro] = useState('');
  const mrRef = useRef(null);
  const chunksRef = useRef([]);

  async function iniciar() {
    setErro('');
    setRes(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        setEstado('a-processar');
        try {
          const out = await enviarVoz(blob);
          if (out.erro) setErro(out.detalhe || out.erro);
          else setRes(out);
        } catch {
          setErro('Falha na consulta por voz.');
        } finally {
          setEstado('idle');
        }
      };
      mrRef.current = mr;
      mr.start();
      setEstado('a-gravar');
    } catch {
      setErro('Sem acesso ao microfone.');
    }
  }

  const parar = () => mrRef.current?.stop();

  return (
    <div className="cartao">
      <button
        className={estado === 'a-gravar' ? 'gravar ativo' : 'gravar'}
        onClick={estado === 'a-gravar' ? parar : iniciar}
        disabled={estado === 'a-processar'}
      >
        {estado === 'a-gravar' ? '⏹️ Parar e perguntar' : estado === 'a-processar' ? '…a ouvir' : '🎤 Gravar pergunta'}
      </button>

      {erro && <div className="erro">{erro}</div>}

      {res && (
        <div className="resposta">
          <div className="meta">disseste: “{res.transcricao}”</div>
          <p style={{ whiteSpace: 'pre-wrap' }}>{res.resposta}</p>
          {(res.chamadas || []).length > 0 && <div className="meta">via {res.chamadas.map((c) => c.nome).join(', ')}</div>}
        </div>
      )}
    </div>
  );
}

function Fatura() {
  const [res, setRes] = useState(null);
  const [aProcessar, setAProcessar] = useState(false);
  const [erro, setErro] = useState('');

  async function escolher(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAProcessar(true);
    setErro('');
    setRes(null);
    try {
      const out = await enviarFatura(file);
      if (out.erro) setErro(out.detalhe || out.erro);
      else setRes(out);
    } catch {
      setErro('Falha ao enviar a fatura.');
    } finally {
      setAProcessar(false);
      e.target.value = '';
    }
  }

  return (
    <div className="cartao">
      <label className="botao-foto">
        {aProcessar ? 'a ler a fatura…' : '📷 Foto ou 📄 PDF da fatura'}
        <input
          type="file"
          accept="image/*,application/pdf"
          onChange={escolher}
          disabled={aProcessar}
          hidden
        />
      </label>

      {erro && <div className="erro">{erro}</div>}

      {res && (
        <div className="resultado">
          <div className="cabecalho-fatura">
            <strong>{res.loja?.nome || res.loja?.cadeia}</strong>
            <span>{(res.data_compra || '').slice(0, 10)}</span>
          </div>
          <div className={`selo ${res.extracao_bate ? 'ok' : 'aviso'}`}>
            {res.extracao_bate ? '✓ reconciliação certa' : `⚠ revisão (Δ ${eur(res.discrepancia)})`}
            {' · '}
            total {eur(res.total_impresso)} · {res.n_itens} itens
          </div>
          <ul className="itens">
            {(res.itens || []).map((it, i) => (
              <li key={i} className={it.is_clearance ? 'clearance' : ''}>
                <span className="desc">{it.descricao_original}</span>
                <span className="preco">
                  {eur(it.preco_liquido)}
                  {it.preco_por_base != null && <em> · {eur(it.preco_por_base)}/base</em>}
                </span>
                {it.is_clearance && <span className="tag">fim validade</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

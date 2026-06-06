// Interface administrativa (operador) — layout desktop, duas abas:
//  • Produtos: gerir SKUs canónicos (renomear, associar/dissociar descrições, fundir).
//  • Notas: rever a leitura de cada nota (imagem + itens) e marcar certa/errada.
import { useEffect, useRef, useState } from 'react';
import { verificarSessao, setAuth, clearAuth } from './api.js';
import * as adm from './adminApi.js';

const eur = (v) => (v == null ? '—' : `${Number(v).toFixed(2).replace('.', ',')} €`);
const dataCurta = (iso) => String(iso || '').slice(0, 10);

export default function Admin() {
  const [sessao, setSessao] = useState(undefined);
  const [aba, setAba] = useState('produtos');
  useEffect(() => {
    verificarSessao().then(setSessao).catch(() => setSessao(null));
  }, []);
  if (sessao === undefined) return <div className="adm-centro">carregando…</div>;
  if (!sessao) return <AdminLogin onEntrar={setSessao} />;
  return (
    <div className="adm">
      <header className="adm-top">
        <strong>🛠️ Bigbag · Operador</strong>
        <nav className="adm-tabs">
          <button className={aba === 'produtos' ? 'on' : ''} onClick={() => setAba('produtos')}>
            Produtos
          </button>
          <button className={aba === 'fusoes' ? 'on' : ''} onClick={() => setAba('fusoes')}>
            Fusões
          </button>
          <button className={aba === 'notas' ? 'on' : ''} onClick={() => setAba('notas')}>
            Notas
          </button>
          <button className={aba === 'revisao' ? 'on' : ''} onClick={() => setAba('revisao')}>
            Revisão
          </button>
          <button className={aba === 'qualidade' ? 'on' : ''} onClick={() => setAba('qualidade')}>
            Qualidade
          </button>
          <button className={aba === 'precos' ? 'on' : ''} onClick={() => setAba('precos')}>
            Preços
          </button>
        </nav>
        <a className="adm-link" href="/">
          ← app
        </a>
      </header>
      {aba === 'produtos' ? (
        <TabProdutos />
      ) : aba === 'fusoes' ? (
        <TabFusoes />
      ) : aba === 'revisao' ? (
        <TabRevisao />
      ) : aba === 'qualidade' ? (
        <TabQualidade />
      ) : aba === 'precos' ? (
        <TabPrecos />
      ) : (
        <TabNotas />
      )}
    </div>
  );
}

function AdminLogin({ onEntrar }) {
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
    <form className="adm-login" onSubmit={submeter}>
      <h1>🛠️ Operador</h1>
      <input placeholder="usuário" value={u} onChange={(e) => setU(e.target.value)} autoCapitalize="none" />
      <input placeholder="senha" type="password" value={p} onChange={(e) => setP(e.target.value)} />
      {erro && <div className="adm-erro">{erro}</div>}
      <button>Entrar</button>
    </form>
  );
}

// ───────────────────────────── Produtos ─────────────────────────────
function TabProdutos() {
  const [q, setQ] = useState('');
  const [skus, setSkus] = useState([]);
  const [sel, setSel] = useState(null);
  const [det, setDet] = useState(null);
  const [nome, setNome] = useState('');
  const [simplificado, setSimplificado] = useState('');
  const [novaDesc, setNovaDesc] = useState('');
  const [alvoMerge, setAlvoMerge] = useState('');
  const [msg, setMsg] = useState('');
  const [criando, setCriando] = useState(false);
  const [novoNome, setNovoNome] = useState('');
  const [novaUnidade, setNovaUnidade] = useState('un');
  const [descLivres, setDescLivres] = useState([]);
  const [nota, setNota] = useState(null); // { url, pdf } da imagem/PDF da nota
  const notaRef = useRef('');

  const recarregarLista = (busca = q) => adm.listarSkus(busca).then((r) => setSkus(r.skus)).catch(() => {});
  useEffect(() => {
    recarregarLista('');
  }, []);
  useEffect(
    () => () => {
      if (notaRef.current) URL.revokeObjectURL(notaRef.current);
    },
    [],
  );

  async function verNota(faturaId) {
    if (!faturaId) return;
    if (notaRef.current) URL.revokeObjectURL(notaRef.current);
    try {
      const f = await adm.carregarFicheiro(faturaId);
      notaRef.current = f.url;
      setNota(f);
    } catch {
      setNota(null);
    }
  }
  function fecharNota() {
    if (notaRef.current) URL.revokeObjectURL(notaRef.current);
    notaRef.current = '';
    setNota(null);
  }

  async function abrir(id) {
    setSel(id);
    setMsg('');
    setAlvoMerge('');
    const d = await adm.carregarSku(id);
    setDet(d);
    setNome(d.sku.nome_canonico);
    setSimplificado(d.sku.nome_simplificado || '');
  }
  const recarregarDet = async () => {
    if (!sel) return;
    const d = await adm.carregarSku(sel);
    setDet(d);
    setNome(d.sku.nome_canonico);
    setSimplificado(d.sku.nome_simplificado || '');
  };

  async function salvarNome() {
    await adm.renomearSku(sel, { nome_canonico: nome.trim() });
    setMsg('✓ nome salvo');
    recarregarLista();
  }
  async function salvarSimplificado() {
    await adm.renomearSku(sel, { nome_canonico: det.sku.nome_canonico, nome_simplificado: simplificado.trim() });
    setMsg('✓ nome simplificado salvo');
    recarregarLista();
  }
  async function salvarUnidade(u) {
    if (!det || u === det.sku.unidade_base) return;
    const r = await adm.renomearSku(sel, { nome_canonico: det.sku.nome_canonico, unidade_base: u });
    setMsg(`✓ unidade → ${u} · ${r?.recomputados || 0} preços recalculados`);
    await recarregarDet();
  }
  async function dissociar(desc) {
    await adm.dissociar(sel, desc);
    await recarregarDet();
    recarregarLista();
  }
  async function associar() {
    const d = novaDesc.trim();
    if (!d) return;
    await adm.associar(sel, d);
    setNovaDesc('');
    await recarregarDet();
    recarregarLista();
    setMsg('✓ associado');
  }
  async function criar() {
    const nome2 = novoNome.trim();
    if (!nome2) return;
    const r = await adm.criarSku({ nome_canonico: nome2, unidade_base: novaUnidade });
    setNovoNome('');
    setCriando(false);
    await recarregarLista();
    if (r?.id) await abrir(r.id); // seleciona o novo → operador associa as descrições
    setMsg('✓ produto criado — associe abaixo as descrições das lojas');
  }
  const carregarLivres = () => adm.descricoesLivres(novaDesc).then((r) => setDescLivres(r.descricoes || [])).catch(() => {});
  async function fundir() {
    const para = Number(alvoMerge);
    if (!para || para === sel) return;
    await adm.fundirSkus(sel, para);
    setSel(null);
    setDet(null);
    recarregarLista();
    setMsg('✓ produtos fundidos');
  }

  return (
    <div className="adm-2col">
      <aside className="adm-lista">
        <form
          className="adm-busca"
          onSubmit={(e) => {
            e.preventDefault();
            recarregarLista();
          }}
        >
          <input placeholder="procurar produto…" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <div className="adm-novo-bar">
          <button type="button" className="adm-novo-btn" onClick={() => setCriando((c) => !c)}>
            {criando ? '× cancelar' : '+ Novo produto'}
          </button>
        </div>
        {criando && (
          <div className="adm-novo-form">
            <input
              autoFocus
              placeholder="nome do produto (ex.: Mamão)"
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && criar()}
            />
            <div className="adm-linha">
              <select value={novaUnidade} onChange={(e) => setNovaUnidade(e.target.value)}>
                <option value="un">un — contado</option>
                <option value="kg">kg — peso</option>
                <option value="L">L — líquido</option>
              </select>
              <button onClick={criar} disabled={!novoNome.trim()}>
                Criar
              </button>
            </div>
          </div>
        )}
        <ul>
          {skus.map((s) => (
            <li key={s.id} className={s.id === sel ? 'on' : ''} onClick={() => abrir(s.id)}>
              <span>{s.nome_canonico}</span>
              <em title={`${s.n_itens} compra(s)`}>{s.n_itens}×</em>
            </li>
          ))}
        </ul>
      </aside>

      <section className="adm-det">
        {!det ? (
          <p className="adm-vazio">Escolha um produto à esquerda.</p>
        ) : (
          <>
            <h2>Nome normalizado</h2>
            <div className="adm-linha">
              <input value={nome} onChange={(e) => setNome(e.target.value)} />
              <button onClick={salvarNome} disabled={!nome.trim() || nome.trim() === det.sku.nome_canonico}>
                Salvar
              </button>
            </div>
            <div className="adm-meta">
              {det.sku.marca ? `marca: ${det.sku.marca} · ` : ''}
              {det.sku.categoria || '—'} · {det.descricoes.reduce((a, d) => a + d.n, 0)} compra(s)
            </div>

            <h3>Unidade de comparação</h3>
            <div className="adm-linha">
              <select value={det.sku.unidade_base} onChange={(e) => salvarUnidade(e.target.value)}>
                <option value="un">un — contado (ovos, latas, iogurtes)</option>
                <option value="kg">kg — peso (café, queijo, fruta, carne)</option>
                <option value="L">L — líquido (leite, sumo, azeite)</option>
              </select>
              <span className="adm-vazio2">recalcula o €/base de todas as compras deste produto</span>
            </div>

            <h3>Nome simplificado (lista de compras)</h3>
            <div className="adm-linha">
              <input
                list="adm-simplificados"
                placeholder="ex.: Leite, Pera, Iogurte Grego…"
                value={simplificado}
                onChange={(e) => setSimplificado(e.target.value)}
              />
              <button onClick={salvarSimplificado} disabled={simplificado.trim() === (det.sku.nome_simplificado || '')}>
                Salvar
              </button>
            </div>
            <datalist id="adm-simplificados">
              {[...new Set(skus.map((s) => s.nome_simplificado).filter(Boolean))].sort().map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <p className="adm-aviso">Agrupa variantes numa lista de compras (vários canónicos → um simplificado).</p>

            <h3>Nomes de produto associados</h3>
            <ul className="adm-descs">
              {det.descricoes.length === 0 && <li className="adm-vazio2">nenhuma compra com este produto</li>}
              {det.descricoes.map((d) => (
                <li key={d.descricao}>
                  <span>
                    {d.descricao} <em>×{d.n}</em>
                  </span>
                  <button className="adm-vernota" title="ver a nota" onClick={() => verNota(d.fatura_id)}>
                    🧾
                  </button>
                  <button className="adm-x" title="dissociar" onClick={() => dissociar(d.descricao)}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>

            <div className="adm-linha">
              <input
                list="adm-descs-livres"
                placeholder="associar descrição de loja (digite ou escolha)…"
                value={novaDesc}
                onFocus={carregarLivres}
                onChange={(e) => {
                  setNovaDesc(e.target.value);
                  carregarLivres();
                }}
              />
              <button onClick={associar} disabled={!novaDesc.trim()}>
                Associar
              </button>
            </div>
            <datalist id="adm-descs-livres">
              {descLivres.map((d) => (
                <option key={d.descricao} value={d.descricao}>
                  {d.atual ? `→ ${d.atual} · ${d.n}×` : `sem produto · ${d.n}×`}
                </option>
              ))}
            </datalist>

            <h3>Fundir com outro produto</h3>
            <div className="adm-linha">
              <select value={alvoMerge} onChange={(e) => setAlvoMerge(e.target.value)}>
                <option value="">escolher destino…</option>
                {skus
                  .filter((s) => s.id !== sel)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nome_canonico}
                    </option>
                  ))}
              </select>
              <button onClick={fundir} disabled={!alvoMerge}>
                Fundir “{det.sku.nome_canonico}” →
              </button>
            </div>
            <p className="adm-aviso">
              Fundir move todas as compras e aliases de “{det.sku.nome_canonico}” para o destino e apaga este.
            </p>
            {msg && <div className="adm-ok">{msg}</div>}
          </>
        )}
      </section>

      {nota && (
        <div className="adm-zoom" onClick={fecharNota}>
          <button className="adm-zoom-x" onClick={fecharNota} aria-label="fechar">
            ✕
          </button>
          {nota.pdf ? (
            <iframe className="adm-zoom-pdf" src={nota.url} title="nota (PDF)" onClick={(e) => e.stopPropagation()} />
          ) : (
            <img src={nota.url} alt="nota" onClick={(e) => e.stopPropagation()} />
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────── Fusões ──────────────────────────────
function TabFusoes() {
  const [limiar, setLimiar] = useState(0.6);
  const [pares, setPares] = useState(null);
  const [msg, setMsg] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const recarregar = (l = limiar) =>
    adm.sugestoesMerge(l).then((r) => setPares(r.pares)).catch(() => setPares([]));
  useEffect(() => {
    recarregar();
  }, [limiar]);

  async function fundir(par) {
    setOcupado(true);
    try {
      await adm.fundirSkus(par.fundir.id, par.manter.id);
      setMsg(`✓ "${par.fundir.nome_canonico}" → "${par.manter.nome_canonico}"`);
      await recarregar();
    } finally {
      setOcupado(false);
    }
  }

  async function autoFundir() {
    setOcupado(true);
    try {
      const r = await adm.autoMergeIdenticos();
      setMsg(`✓ ${r.skus_removidos} SKU(s) idêntico(s) fundido(s) em ${r.grupos} grupo(s)`);
      await recarregar();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="adm-fusoes">
      <div className="adm-auto">
        <button className="adm-auto-btn" onClick={autoFundir} disabled={ocupado}>
          ⚡ Fundir nomes idênticos automaticamente
        </button>
        <span className="adm-sug-dica">junta de uma vez todos os SKUs com o mesmo nome canónico.</span>
      </div>
      <div className="adm-sug-top">
        <span>Sensibilidade:</span>
        {[0.5, 0.6, 0.7, 0.8].map((l) => (
          <button key={l} className={limiar === l ? 'on' : ''} onClick={() => setLimiar(l)}>
            {l}
          </button>
        ))}
        <span className="adm-sug-dica">menor = mais sugestões (e mais ruído)</span>
        {msg && <span className="adm-ok">{msg}</span>}
      </div>
      {pares === null ? (
        <p className="adm-vazio">a calcular…</p>
      ) : pares.length === 0 ? (
        <p className="adm-vazio">Nenhum par parecido nesta sensibilidade. 👍</p>
      ) : (
        <ul className="adm-pares">
          {pares.map((par, i) => (
            <li key={i}>
              <span className="adm-par-score">{Math.round(par.score * 100)}%</span>
              <span className="adm-par-nomes">
                <b>{par.manter.nome_canonico}</b> <em>({par.manter.n_itens})</em>
                <span className="adm-par-seta">⟵</span>
                <span>{par.fundir.nome_canonico}</span> <em>({par.fundir.n_itens})</em>
              </span>
              <button onClick={() => fundir(par)} disabled={ocupado}>
                Fundir
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="adm-aviso">Mantém o nome com mais compras (em negrito); o outro é absorvido.</p>
    </div>
  );
}

// ────────────────────────── Revisão por confiança ──────────────────────────
// Worklist: o que mais provavelmente está mal, primeiro. Itens sem SKU e
// mapeamentos de baixa confiança. O operador corrige na aba Produtos.
function Conf({ v }) {
  if (v == null) return <span className="adm-conf adm-conf-na">novo</span>;
  const cls = v < 50 ? 'adm-conf-ruim' : v < 70 ? 'adm-conf-medio' : 'adm-conf-bom';
  return <span className={`adm-conf ${cls}`}>{v}</span>;
}

function TabRevisao() {
  const [limiar, setLimiar] = useState(70);
  const [dados, setDados] = useState(null);
  useEffect(() => {
    adm.baixaConfianca(limiar).then(setDados).catch(() => setDados({ naoResolvidos: [], baixaConfianca: [] }));
  }, [limiar]);

  const nr = dados?.naoResolvidos || [];
  const bc = dados?.baixaConfianca || [];
  return (
    <div className="adm-revisao">
      <div className="adm-sug-top">
        <span>Mostrar até confiança:</span>
        {[50, 70, 90].map((l) => (
          <button key={l} className={limiar === l ? 'on' : ''} onClick={() => setLimiar(l)}>
            &lt;{l}
          </button>
        ))}
        <span className="adm-sug-dica">do pior para o melhor — corrige na aba Produtos (renomear/associar/fundir)</span>
      </div>
      {dados?.semPontuacao > 0 && (
        <p className="adm-sug-dica">
          {dados.semPontuacao} mapeamento(s) legado(s) ainda sem pontuação — serão pontuados ao reprocessar a nota.
        </p>
      )}

      {dados === null ? (
        <p className="adm-vazio">a calcular…</p>
      ) : (
        <>
          <div className="adm-qtab">
            <h3>Sem produto canónico ({nr.length})</h3>
            {nr.length === 0 ? (
              <p className="adm-vazio">Nenhum item por resolver. 👍</p>
            ) : (
              <table className="adm-tabela">
                <thead>
                  <tr>
                    <th>conf.</th>
                    <th>descrição na nota</th>
                    <th>nº</th>
                    <th>loja</th>
                  </tr>
                </thead>
                <tbody>
                  {nr.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <span className="adm-conf adm-conf-ruim">0</span>
                      </td>
                      <td>{r.descricao}</td>
                      <td>{r.n_itens}</td>
                      <td>{r.cadeia || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="adm-qtab">
            <h3>Mapeamentos de baixa confiança ({bc.length})</h3>
            {bc.length === 0 ? (
              <p className="adm-vazio">Nada abaixo de {limiar}. 👍</p>
            ) : (
              <table className="adm-tabela">
                <thead>
                  <tr>
                    <th>conf.</th>
                    <th>descrição na nota</th>
                    <th>→ produto canónico</th>
                    <th>nº</th>
                    <th>loja</th>
                  </tr>
                </thead>
                <tbody>
                  {bc.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <Conf v={r.confianca} />
                      </td>
                      <td>{r.descricao}</td>
                      <td>
                        {r.sku} <em className="adm-un">({r.unidade_base})</em>
                      </td>
                      <td>{r.n_itens}</td>
                      <td>{r.cadeia || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ────────────────────────────── Qualidade ─────────────────────────────
function pct(num, den) {
  if (!den) return '—';
  return Math.round((num / den) * 100) + '%';
}

function TabelaQualidade({ titulo, linhas }) {
  return (
    <div className="adm-qtab">
      <h3>{titulo}</h3>
      <table className="adm-tabela">
        <thead>
          <tr>
            <th>{titulo}</th>
            <th>Notas</th>
            <th>Reconcilia</th>
            <th>Disc. média</th>
            <th>Revisão (✓/✕)</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            const taxa = (l.reconciliam / l.n) * 100;
            return (
              <tr key={l.chave}>
                <td>{l.chave}</td>
                <td>{l.n}</td>
                <td>
                  <span className={taxa >= 80 ? 'q-bom' : taxa >= 50 ? 'q-medio' : 'q-mau'}>
                    {l.reconciliam}/{l.n} · {pct(l.reconciliam, l.n)}
                  </span>
                </td>
                <td>{l.disc_media != null ? Number(l.disc_media).toFixed(2).replace('.', ',') : '—'}</td>
                <td>
                  {l.revistas > 0 ? (
                    <span>
                      <b className="q-bom">{l.rev_ok}</b> / <b className="q-mau">{l.rev_erro}</b>
                      <em> ({l.revistas} de {l.n})</em>
                    </span>
                  ) : (
                    <em>—</em>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Rótulos legíveis do método de extração (e lembra que método = tipo de input).
const ROTULO_METODO = { vlm: 'VLM (imagem)', ocr_llm: 'OCR+LLM (PDF)' };
const rotularMetodo = (linhas = []) =>
  linhas.map((l) => ({ ...l, chave: ROTULO_METODO[l.chave] || l.chave }));

function TabQualidade() {
  const [dados, setDados] = useState(null);
  useEffect(() => {
    adm.qualidade().then(setDados).catch(() => setDados({ cadeias: [], origens: [], metodos: [] }));
  }, []);
  if (!dados) return <p className="adm-vazio">a calcular…</p>;
  return (
    <div className="adm-qualidade">
      <p className="adm-aviso">
        «Reconcilia» = soma dos itens bate com o total impresso (sinal automático). «Revisão» = vereditos teus na
        aba Notas. Onde a reconciliação cai, vale a pena olhar a leitura dessa cadeia/caminho.
      </p>
      <TabelaQualidade titulo="Método" linhas={rotularMetodo(dados.metodos)} />
      <p className="adm-aviso adm-aviso-fraco">
        ⚠️ O método está ligado ao tipo de input (VLM = imagem, OCR+LLM = PDF). Esta tabela compara sobretudo
        «foto vs PDF», não «VLM vs OCR+LLM» de forma justa — para isso é preciso correr os dois métodos sobre a
        MESMA nota (experiência par-a-par).
      </p>
      <TabelaQualidade titulo="Cadeia" linhas={dados.cadeias} />
      <TabelaQualidade titulo="Origem" linhas={dados.origens} />
    </div>
  );
}

// ───────────────────────────── Qualidade de preço ─────────────────────────────
function TabPrecos() {
  const [dados, setDados] = useState(null);
  const [reproc, setReproc] = useState(null);
  const carregar = () => adm.qualidadePreco().then(setDados).catch(() => setDados({ grupos: [] }));
  useEffect(() => {
    carregar();
  }, []);

  async function reprocessar(faturaId) {
    if (reproc) return;
    if (!window.confirm('Reprocessar a nota deste item (re-lê do ficheiro e substitui os itens)?')) return;
    setReproc(faturaId);
    try {
      await adm.reprocessarNota(faturaId);
      await carregar();
    } catch {
      /* fica como está */
    } finally {
      setReproc(null);
    }
  }

  if (!dados) return <p className="adm-vazio">a calcular…</p>;
  return (
    <div className="adm-qualidade">
      <p className="adm-aviso">
        Itens cujo preço por unidade-base se afasta muito da mediana do produto — provável erro de
        unidade/quantidade/formato (ex.: ovos per-caixa vs per-ovo, café per-pacote vs per-kg, leitura garbled).
        Corrige a quantidade na aba Notas, ou reprocessa a nota aqui (🔄).
      </p>
      {dados.grupos.length === 0 ? (
        <p className="adm-vazio2">Sem outliers de preço. 🎉</p>
      ) : (
        dados.grupos.map((g) => (
          <div className="adm-qtab" key={g.sku_id}>
            <h3>
              {g.nome}{' '}
              <em>
                · mediana {eur(g.mediana)}/{g.unidade_base} · {g.n} compras
              </em>
            </h3>
            <table className="adm-tabela">
              <thead>
                <tr>
                  <th>Item lido</th>
                  <th>Loja · data</th>
                  <th>preço/base</th>
                  <th>desvio</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {g.outliers.map((o) => (
                  <tr key={o.item_id}>
                    <td>
                      {o.descricao} <em>(q={o.quantidade}, pago {eur(o.preco_liquido)})</em>
                    </td>
                    <td>
                      {o.cadeia} · {o.data}
                    </td>
                    <td className="q-mau">
                      {eur(o.preco_por_base)}/{g.unidade_base}
                    </td>
                    <td>{o.desvio}×</td>
                    <td>
                      <button
                        className="adm-reproc"
                        disabled={reproc === o.fatura_id}
                        onClick={() => reprocessar(o.fatura_id)}
                        title="reprocessar a nota deste item"
                      >
                        {reproc === o.fatura_id ? '…' : '🔄'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}

// ─────────────────────────────── Notas ───────────────────────────────
function TabNotas() {
  const [status, setStatus] = useState('pendente');
  const [notas, setNotas] = useState([]);
  const [sel, setSel] = useState(null);
  const [det, setDet] = useState(null);
  const [img, setImg] = useState('');
  const [coment, setComent] = useState('');
  const [erroForm, setErroForm] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [reprocessando, setReprocessando] = useState(false);
  const imgRef = useRef('');

  const recarregar = () => adm.listarNotas(status).then((r) => setNotas(r.faturas)).catch(() => {});
  useEffect(() => {
    recarregar();
  }, [status]);
  useEffect(
    () => () => {
      if (imgRef.current) URL.revokeObjectURL(imgRef.current);
    },
    [],
  );

  async function abrir(id) {
    setSel(id);
    setDet(null);
    setComent('');
    setErroForm(false);
    setZoom(false);
    setImg('');
    const d = await adm.carregarNota(id);
    setDet(d);
    if (imgRef.current) URL.revokeObjectURL(imgRef.current);
    try {
      const u = await adm.carregarImagem(id);
      imgRef.current = u;
      setImg(u);
    } catch {
      setImg('');
    }
  }

  async function revisar(veredicto) {
    if (veredicto === 'erro' && !erroForm) {
      setErroForm(true);
      return;
    }
    await adm.revisarNota(sel, veredicto, veredicto === 'erro' ? coment.trim() : null);
    setErroForm(false);
    setComent('');
    recarregar();
  }

  async function reprocessar() {
    if (!sel || reprocessando) return;
    if (!window.confirm('Reprocessar re-lê a nota do ficheiro com a extração atual e SUBSTITUI os itens (perde edições manuais nesta nota). Continuar?'))
      return;
    setReprocessando(true);
    try {
      await adm.reprocessarNota(sel);
      await abrir(sel);
      recarregar();
    } catch {
      /* erro silencioso — a nota fica como estava */
    } finally {
      setReprocessando(false);
    }
  }

  async function apagar() {
    if (!sel || reprocessando) return;
    if (!window.confirm('Apagar esta nota DEFINITIVAMENTE (itens + ficheiro)? Útil para notas com foto má — depois digitaliza de novo no app.'))
      return;
    setReprocessando(true);
    try {
      await adm.apagarNota(sel);
      setSel(null);
      setDet(null);
      recarregar();
    } catch {
      /* erro silencioso */
    } finally {
      setReprocessando(false);
    }
  }

  async function salvarQtd(itemId, valor, atual) {
    const q = Number(String(valor).replace(',', '.'));
    if (!(q > 0) || q === Number(atual)) return;
    const r = await adm.atualizarItem(itemId, q);
    setDet((d) => ({
      ...d,
      itens: d.itens.map((it) => (it.id === itemId ? { ...it, quantidade: q, preco_por_base: r.preco_por_base } : it)),
    }));
  }

  const badge = (n) =>
    n.veredicto === 'ok' ? '✓' : n.veredicto === 'erro' ? '✕' : n.needs_review ? '⚠' : '·';

  return (
    <div className="adm-2col">
      <aside className="adm-lista">
        <div className="adm-filtro">
          {['pendente', 'erro', 'ok', 'all'].map((s) => (
            <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
              {s === 'all' ? 'todas' : s}
            </button>
          ))}
        </div>
        <ul>
          {notas.map((n) => (
            <li key={n.id} className={n.id === sel ? 'on' : ''} onClick={() => abrir(n.id)}>
              <span>
                {badge(n)} {n.cadeia} · {dataCurta(n.data_compra)}
              </span>
              <em>{n.n_itens}</em>
            </li>
          ))}
        </ul>
      </aside>

      <section className="adm-nota">
        {!det ? (
          <p className="adm-vazio">Escolha uma nota à esquerda.</p>
        ) : (
          <div className="adm-nota-grid">
            <div className="adm-img">
              {!img ? (
                <div className="adm-semimg">sem imagem</div>
              ) : det.tipo_ficheiro === 'pdf' ? (
                <iframe className="adm-pdf" src={img} title="nota (PDF)" />
              ) : (
                <img src={img} alt="nota" onClick={() => setZoom(true)} title="clique para ampliar" />
              )}
            </div>
            <div className="adm-nota-info">
              <h2>
                {det.fatura.cadeia} · {dataCurta(det.fatura.data_compra)}
              </h2>
              <div className="adm-meta">
                total {eur(det.fatura.total_impresso)} · {det.itens.length} itens ·{' '}
                {det.fatura.needs_review ? '⚠ em revisão' : 'reconcilia'} · origem {det.fatura.origem_captura || '—'}
                <button className="adm-reproc" onClick={reprocessar} disabled={reprocessando} title="re-lê a nota do ficheiro com a extração atual">
                  {reprocessando ? 'a reprocessar…' : '🔄 Reprocessar'}
                </button>
                <button className="adm-apagar" onClick={apagar} disabled={reprocessando} title="apagar a nota (para re-digitalizar)">
                  🗑 Apagar
                </button>
              </div>
              {det.diagnostico && (
                <div className="adm-diag">
                  <div className="adm-diag-h">
                    ⚠ Diagnóstico
                    {det.diagnostico.discrepancia ? ` · diferença no total ${eur(det.diagnostico.discrepancia)}` : ''}
                  </div>
                  {det.diagnostico.pista && <div className="adm-diag-l">{det.diagnostico.pista}</div>}
                  {det.diagnostico.linhas_inconsistentes?.map((l, i) => (
                    <div className="adm-diag-l" key={i}>
                      Linha <b>{l.descricao}</b>: {l.quantidade} × {eur(l.preco_unitario)} = {eur(l.esperado)}, mas o valor
                      lido foi {eur(l.valor)}.
                    </div>
                  ))}
                </div>
              )}
              <ul className="adm-itens">
                {det.itens.map((it) => (
                  <li key={it.id}>
                    <b>{eur(it.preco_liquido)}</b>
                    <span className="adm-prod">{it.descricao_original}</span>
                    {!it.is_non_product && (
                      <span className="adm-item-qtd">
                        <input
                          type="text"
                          inputMode="decimal"
                          defaultValue={it.quantidade ?? 1}
                          onBlur={(e) => salvarQtd(it.id, e.target.value, it.quantidade)}
                          onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                          title="quantidade/peso — corrige aqui se a leitura errou"
                        />
                        <em>{it.unidade_base || 'un'}</em>
                        {it.preco_por_base != null ? (
                          <span className="adm-ppb">
                            {eur(it.preco_por_base)}/{it.unidade_base || 'un'}
                          </span>
                        ) : it.unidade_base === 'kg' || it.unidade_base === 'L' ? (
                          <span className="adm-ppb adm-sempeso">
                            sem peso na nota — escreve o peso ({it.unidade_base}) p/ obter €/{it.unidade_base}
                          </span>
                        ) : null}
                      </span>
                    )}
                    {it.nome_canonico && it.nome_canonico !== it.descricao_original && (
                      <span className="adm-cru">→ {it.nome_canonico}</span>
                    )}
                  </li>
                ))}
              </ul>

              {det.revisao && (
                <div className="adm-revprev">
                  Última revisão: <b>{det.revisao.veredicto}</b>
                  {det.revisao.comentario ? ` — “${det.revisao.comentario}”` : ''}
                </div>
              )}

              {erroForm && (
                <textarea
                  className="adm-coment"
                  placeholder="O que está errado? (ex.: mamão foi lido como manteiga; faltou um item)"
                  value={coment}
                  onChange={(e) => setComent(e.target.value)}
                  autoFocus
                />
              )}
              <div className="adm-acoes">
                <button className="adm-certa" onClick={() => revisar('ok')}>
                  ✓ Certa
                </button>
                <button className="adm-errada" onClick={() => revisar('erro')} disabled={erroForm && !coment.trim()}>
                  ✕ {erroForm ? 'Confirmar erro' : 'Errada'}
                </button>
                {erroForm && (
                  <button className="adm-cancelar" onClick={() => setErroForm(false)}>
                    cancelar
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {zoom && img && (
        <div className="adm-zoom" onClick={() => setZoom(false)}>
          <button className="adm-zoom-x" onClick={() => setZoom(false)} aria-label="fechar">
            ✕
          </button>
          <img src={img} alt="nota ampliada" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

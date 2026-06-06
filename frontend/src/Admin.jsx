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
          <button className={aba === 'qualidade' ? 'on' : ''} onClick={() => setAba('qualidade')}>
            Qualidade
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
      ) : aba === 'qualidade' ? (
        <TabQualidade />
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
              {det.sku.categoria || '—'} · {det.sku.unidade_base} ·{' '}
              {det.descricoes.reduce((a, d) => a + d.n, 0)} compra(s)
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
                placeholder="associar outra descrição (texto exato do talão)…"
                value={novaDesc}
                onChange={(e) => setNovaDesc(e.target.value)}
              />
              <button onClick={associar} disabled={!novaDesc.trim()}>
                Associar
              </button>
            </div>

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
                        {it.preco_por_base != null && (
                          <span className="adm-ppb">
                            {eur(it.preco_por_base)}/{it.unidade_base || 'un'}
                          </span>
                        )}
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

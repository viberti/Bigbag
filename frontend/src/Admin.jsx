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
  const [aba, setAba] = useState('painel');
  const [notaAlvo, setNotaAlvo] = useState(null); // fatura a abrir na aba Notas (vindo de Produtos)
  const abrirNota = (faturaId) => {
    setNotaAlvo(faturaId);
    setAba('notas');
  };
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
          <button className={aba === 'painel' ? 'on' : ''} onClick={() => setAba('painel')}>
            Painel
          </button>
          <button className={aba === 'produtos' ? 'on' : ''} onClick={() => setAba('produtos')}>
            Produtos
          </button>
          <button className={aba === 'mestres' ? 'on' : ''} onClick={() => setAba('mestres')}>
            Mestres
          </button>
          <button className={aba === 'ligar' ? 'on' : ''} onClick={() => setAba('ligar')}>
            Ligar nomes
          </button>
          <button className={aba === 'fusoes' ? 'on' : ''} onClick={() => setAba('fusoes')}>
            Fusões
          </button>
          <button className={aba === 'nomes' ? 'on' : ''} onClick={() => setAba('nomes')}>
            Nomes
          </button>
          <button className={aba === 'eans' ? 'on' : ''} onClick={() => setAba('eans')}>
            EANs
          </button>
          <button className={aba === 'mercadona' ? 'on' : ''} onClick={() => setAba('mercadona')}>
            Mercadona
          </button>
          <button className={aba === 'notas' ? 'on' : ''} onClick={() => setAba('notas')}>
            Notas
          </button>
          <button className={aba === 'itens' ? 'on' : ''} onClick={() => setAba('itens')}>
            Itens
          </button>
          <button className={aba === 'fichas' ? 'on' : ''} onClick={() => setAba('fichas')}>
            Fichas
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
          <button className={aba === 'saude' ? 'on' : ''} onClick={() => setAba('saude')}>
            Saúde
          </button>
          <button className={aba === 'uso' ? 'on' : ''} onClick={() => setAba('uso')}>
            Uso
          </button>
          <button className={aba === 'custos' ? 'on' : ''} onClick={() => setAba('custos')}>
            Custos
          </button>
        </nav>
        <a className="adm-link" href="/">
          ← app
        </a>
      </header>
      {aba === 'painel' ? (
        <TabPainel />
      ) : aba === 'mestres' ? (
        <TabMestres />
      ) : aba === 'produtos' ? (
        <TabProdutos onAbrirNota={abrirNota} />
      ) : aba === 'ligar' ? (
        <TabLigar />
      ) : aba === 'fusoes' ? (
        <TabFusoes />
      ) : aba === 'nomes' ? (
        <TabNomes />
      ) : aba === 'eans' ? (
        <TabEans />
      ) : aba === 'mercadona' ? (
        <TabMercadona />
      ) : aba === 'itens' ? (
        <TabItens onAbrirNota={abrirNota} />
      ) : aba === 'fichas' ? (
        <TabFichas />
      ) : aba === 'revisao' ? (
        <TabRevisao />
      ) : aba === 'qualidade' ? (
        <TabQualidade />
      ) : aba === 'precos' ? (
        <TabPrecos />
      ) : aba === 'saude' ? (
        <TabSaude />
      ) : aba === 'uso' ? (
        <TabUso />
      ) : aba === 'custos' ? (
        <TabCustos />
      ) : (
        <TabNotas notaAlvo={notaAlvo} onConsumir={() => setNotaAlvo(null)} />
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

// ───────────────────────────── Painel ─────────────────────────────
function TabPainel() {
  const [p, setP] = useState(null);
  const [q, setQ] = useState('');
  const [caps, setCaps] = useState([]);
  useEffect(() => {
    adm.painel().then(setP).catch(() => setP(null));
  }, []);
  useEffect(() => {
    adm.capturas(q).then((r) => setCaps(r.capturas || [])).catch(() => setCaps([]));
  }, [q]);

  return (
    <div className="adm-painel">
      <div className="adm-cards">
        <div className="adm-card">
          <span className="adm-card-n">{p?.n_notas ?? '—'}</span>
          <span className="adm-card-l">notas digitalizadas</span>
        </div>
        <div className="adm-card">
          <span className="adm-card-n">{p?.n_produtos_crus ?? '—'}</span>
          <span className="adm-card-l">produtos capturados (crus)</span>
        </div>
        <div className="adm-card">
          <span className="adm-card-n">{p?.n_skus ?? '—'}</span>
          <span className="adm-card-l">produtos canónicos (SKU)</span>
        </div>
        <div className="adm-card">
          <span className="adm-card-n">{p?.n_mestres ?? '—'}</span>
          <span className="adm-card-l">Produtos Mestre</span>
        </div>
        <div className="adm-card">
          <span className="adm-card-n">{p?.n_skus_sem_mestre ?? '—'}</span>
          <span className="adm-card-l">SKUs por classificar</span>
        </div>
        <div className="adm-card">
          <span className="adm-card-n">{p?.n_eans_unicos ?? '—'}</span>
          <span className="adm-card-l">EANs únicos</span>
        </div>
      </div>

      <div className="adm-card-merc">
        <h3>Notas por mercado</h3>
        <ul className="adm-merc">
          {(p?.por_mercado || []).map((m) => (
            <li key={m.cadeia}>
              <span>{m.cadeia || '—'}</span>
              <span className="adm-merc-bar" style={{ width: barW(m.n, p.por_mercado) }} />
              <em>{m.n}</em>
            </li>
          ))}
        </ul>
      </div>

      <div className="adm-qtab">
        <h3>Captura crua — o que foi lido das notas (antes da normalização)</h3>
        <input
          className="adm-lig-busca"
          placeholder="procurar na captura crua…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <table className="adm-tabela">
          <thead>
            <tr>
              <th>descrição na nota</th>
              <th>nº</th>
              <th>mercado</th>
              <th>→ produto canónico</th>
              <th>→ Produto Mestre</th>
            </tr>
          </thead>
          <tbody>
            {caps.length === 0 ? (
              <tr><td colSpan={5} className="adm-vazio2">sem resultados</td></tr>
            ) : (
              caps.map((c) => (
                <tr key={c.descricao}>
                  <td>{c.descricao}</td>
                  <td>{c.n}</td>
                  <td>{c.cadeia || '—'}</td>
                  <td>{c.sku || <span className="adm-conf adm-conf-ruim">sem SKU</span>}</td>
                  <td>{c.mestre || <span className="adm-conf adm-conf-na">—</span>}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function barW(n, arr) {
  const max = Math.max(...arr.map((x) => x.n), 1);
  return Math.round((n / max) * 100) + '%';
}

// ───────────────────────────── Mestres ─────────────────────────────
function TabMestres() {
  const [dados, setDados] = useState(null);
  const [msg, setMsg] = useState('');
  const recarregar = () => adm.mestres().then(setDados).catch(() => setDados({ mestres: [], n_singletons: 0 }));
  useEffect(() => {
    recarregar();
  }, []);

  async function desligar(skuId, nome) {
    await adm.desligarMestre(skuId);
    setMsg(`✓ "${nome}" separado do Mestre`);
    await recarregar();
  }

  const ms = dados?.mestres || [];
  const nSusp = ms.filter((m) => m.suspeito).length;
  return (
    <div className="adm-mestres">
      <p className="adm-sug-dica">
        Produtos Mestre que <b>reúnem ≥2 SKUs</b> ({ms.length}) — {nSusp} com <b>suspeitos</b> dos validadores ·{' '}
        {dados?.n_singletons ?? '—'} Mestres com 1 só SKU (não mostrados). Os suspeitos vêm primeiro.
      </p>
      {msg && <p className="adm-ok">{msg}</p>}
      {dados === null ? (
        <p className="adm-vazio">a calcular…</p>
      ) : (
        ms.map((m) => (
          <div key={m.id} className={'adm-mestre' + (m.suspeito ? ' susp' : '')}>
            <div className="adm-mestre-h">
              <b>{m.categoria || m.nome || '(sem categoria)'}</b>
              <code className="adm-mestre-k">{m.chave}</code>
              {m.suspeito && <span className="adm-conf adm-conf-ruim">suspeito</span>}
            </div>
            <ul className="adm-mestre-skus">
              {m.skus.map((s) => (
                <li key={s.id} className={s.suspeito ? 'susp' : ''}>
                  <span className="adm-lig-desc">
                    {s.nome} <em className="adm-lig-marca">· {s.marca || '—'} · {s.un}</em>
                    {s.suspeito && <em className="adm-mestre-motivo"> ⚠ {s.motivos.join('; ')}</em>}
                  </span>
                  <button className="adm-x" title="separar deste Mestre" onClick={() => desligar(s.id, s.nome)}>
                    ✕ separar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}

// ───────────────────────────── Produtos ─────────────────────────────
function TabProdutos({ onAbrirNota }) {
  const [q, setQ] = useState('');
  const [ordem, setOrdem] = useState('nome'); // nome · desc (nº descrições das notas) · itens
  const [skus, setSkus] = useState([]);
  const [total, setTotal] = useState(0); // total de produtos com nome canónico (respeita a busca)
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

  const recarregarLista = (busca = q, ord = ordem) =>
    adm
      .listarSkus(busca, ord)
      .then((r) => {
        setSkus(r.skus);
        setTotal(r.total ?? r.skus.length);
      })
      .catch(() => {});
  useEffect(() => {
    recarregarLista('');
  }, []);

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
  async function associar(desc) {
    const d = (typeof desc === 'string' ? desc : novaDesc).trim();
    if (!d) return;
    await adm.associar(sel, d);
    if (typeof desc !== 'string') setNovaDesc(''); // limpa só quando veio do input
    await recarregarDet();
    recarregarLista();
    carregarLivres(); // atualiza a lista de candidatos (badges/mapeamento)
    setMsg(`✓ "${d}" associado`);
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
  const carregarLivres = (q = novaDesc) =>
    adm.descricoesLivres(q).then((r) => setDescLivres(r.descricoes || [])).catch(() => {});
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
        <div className="adm-ordenar">
          <label>ordenar:</label>
          <select
            value={ordem}
            onChange={(e) => {
              setOrdem(e.target.value);
              recarregarLista(q, e.target.value);
            }}
          >
            <option value="nome">nome (A→Z)</option>
            <option value="desc">descrições das notas (mais→menos)</option>
            <option value="itens">compras (mais→menos)</option>
          </select>
        </div>
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
        <div className="adm-total">
          {total} {total === 1 ? 'produto' : 'produtos'} com nome canónico{q ? ' (filtro)' : ''}
        </div>
        <ul>
          {skus.map((s) => (
            <li key={s.id} className={s.id === sel ? 'on' : ''} onClick={() => abrir(s.id)}>
              <span>{s.nome_canonico}</span>
              <em title={`${s.n_desc} descrição(ões) das notas · ${s.n_itens} compra(s)`}>
                {s.n_desc}📝 · {s.n_itens}×
              </em>
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
                  <button
                    className="adm-vernota"
                    title="abrir esta nota (aba Notas: imagem + interpretação)"
                    onClick={() => d.fatura_id && onAbrirNota(d.fatura_id)}
                  >
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
                placeholder="procurar descrição de loja para associar…"
                value={novaDesc}
                onFocus={() => carregarLivres()}
                onChange={(e) => {
                  setNovaDesc(e.target.value);
                  carregarLivres(e.target.value);
                }}
              />
              <button onClick={() => associar()} disabled={!novaDesc.trim()}>
                Associar texto
              </button>
            </div>
            <ul className="adm-lig-lista adm-assoc-lista">
              {descLivres.length === 0 ? (
                <li className="adm-vazio2">escreva acima para procurar descrições…</li>
              ) : (
                descLivres.map((d) => {
                  const jaAqui = d.atual_id === det.sku.id;
                  return (
                    <li key={d.descricao}>
                      <span className="adm-lig-desc">
                        {d.descricao} <em>×{d.n}</em>
                        {d.cadeia ? <em className="adm-lig-marca"> · {d.cadeia}</em> : null}
                      </span>
                      <span className="adm-lig-meta">
                        {d.atual ? (
                          <span className={`adm-conf ${jaAqui ? 'adm-conf-bom' : 'adm-conf-medio'}`}>{d.atual}</span>
                        ) : (
                          <span className="adm-conf adm-conf-ruim">sem produto</span>
                        )}
                        <button onClick={() => associar(d.descricao)} disabled={jaAqui}>
                          {jaAqui ? 'aqui' : 'Associar'}
                        </button>
                      </span>
                    </li>
                  );
                })
              )}
            </ul>

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
    </div>
  );
}

// ─────────────────────────────── Fusões ──────────────────────────────
// ───────────── Ligar nomes (descrição da nota → produto canónico) ─────────────
// Tela centrada na DESCRIÇÃO do talão: procura uma descrição, vê a que produto
// canónico está ligada (ou não), e liga-a a um SKU pesquisável. Inverso da aba
// Produtos (que parte do SKU). Usa associar/dissociar (alias manual, conf. 100).
function TabLigar() {
  const [qDesc, setQDesc] = useState('');
  const [descricoes, setDescricoes] = useState([]);
  const [sel, setSel] = useState(null); // descrição selecionada
  const [qSku, setQSku] = useState('');
  const [skus, setSkus] = useState([]);
  const [msg, setMsg] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const recarregarDesc = (q = qDesc) =>
    adm.descricoesLivres(q).then((r) => setDescricoes(r.descricoes || [])).catch(() => setDescricoes([]));
  useEffect(() => {
    recarregarDesc();
  }, [qDesc]);
  useEffect(() => {
    adm.listarSkus(qSku).then((r) => setSkus(r.skus || [])).catch(() => setSkus([]));
  }, [qSku]);

  async function ligar(sku) {
    if (!sel) return;
    setOcupado(true);
    try {
      const r = await adm.associar(sku.id, sel.descricao);
      setMsg(`✓ "${sel.descricao}" → ${sku.nome_canonico} (${r.itens_atualizados} item(s))`);
      const novo = { ...sel, atual_id: sku.id, atual: sku.nome_canonico, atual_unidade: sku.unidade_base };
      setSel(novo);
      await recarregarDesc();
    } finally {
      setOcupado(false);
    }
  }

  async function desligar() {
    if (!sel?.atual_id) return;
    setOcupado(true);
    try {
      await adm.dissociar(sel.atual_id, sel.descricao);
      setMsg(`✓ "${sel.descricao}" desligado de ${sel.atual}`);
      const novo = { ...sel, atual_id: null, atual: null, atual_unidade: null };
      setSel(novo);
      await recarregarDesc();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="adm-ligar">
      <div className="adm-lig-col">
        <h3>Nome na nota</h3>
        <input
          className="adm-lig-busca"
          placeholder="procurar descrição do talão…"
          value={qDesc}
          onChange={(e) => setQDesc(e.target.value)}
        />
        <ul className="adm-lig-lista">
          {descricoes.length === 0 ? (
            <li className="adm-vazio">sem resultados</li>
          ) : (
            descricoes.map((d) => (
              <li
                key={d.descricao}
                className={sel?.descricao === d.descricao ? 'on' : ''}
                onClick={() => setSel(d)}
              >
                <span className="adm-lig-desc">{d.descricao}</span>
                <span className="adm-lig-meta">
                  <em>×{d.n}</em>
                  {d.atual ? (
                    <span className="adm-conf adm-conf-bom">{d.atual}</span>
                  ) : (
                    <span className="adm-conf adm-conf-ruim">sem produto</span>
                  )}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>

      <div className="adm-lig-col">
        {!sel ? (
          <p className="adm-vazio">← escolhe uma descrição à esquerda</p>
        ) : (
          <>
            <h3>Ligar a um produto canónico</h3>
            <div className="adm-lig-sel">
              <b>{sel.descricao}</b> <em>({sel.cadeia || '—'})</em>
              <div className="adm-lig-atual">
                {sel.atual ? (
                  <>
                    ligado a <b>{sel.atual}</b> <em className="adm-un">({sel.atual_unidade})</em>
                    <button className="adm-x" onClick={desligar} disabled={ocupado} title="desligar">
                      ✕ desligar
                    </button>
                  </>
                ) : (
                  <span className="adm-conf adm-conf-ruim">sem produto canónico</span>
                )}
              </div>
            </div>
            {msg && <p className="adm-ok">{msg}</p>}
            <input
              className="adm-lig-busca"
              placeholder="procurar produto canónico…"
              value={qSku}
              onChange={(e) => setQSku(e.target.value)}
            />
            <ul className="adm-lig-lista">
              {skus.length === 0 ? (
                <li className="adm-vazio">sem produtos — procura por outro nome</li>
              ) : (
                skus.map((s) => (
                  <li key={s.id}>
                    <span className="adm-lig-desc">
                      {s.nome_canonico} <em className="adm-un">({s.unidade_base})</em>
                      {s.marca ? <em className="adm-lig-marca"> · {s.marca}</em> : null}
                    </span>
                    <span className="adm-lig-meta">
                      <em>{s.n_itens} compra(s)</em>
                      <button
                        onClick={() => ligar(s)}
                        disabled={ocupado || s.id === sel.atual_id}
                      >
                        {s.id === sel.atual_id ? 'ligado' : 'Ligar'}
                      </button>
                    </span>
                  </li>
                ))
              )}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

// Sugestões de nome canónico (das variantes guardadas) — rever e aplicar/rejeitar.
function TabNomes() {
  const [sugestoes, setSugestoes] = useState(null);
  const [msg, setMsg] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const recarregar = () => adm.nomesSugeridos().then((r) => setSugestoes(r.sugestoes)).catch(() => setSugestoes([]));
  useEffect(() => {
    recarregar();
  }, []);

  async function gerar() {
    setOcupado(true);
    setMsg('a gerar sugestões…');
    try {
      const r = await adm.gerarNomes();
      setMsg(`✓ ${r.novas} nova(s) de ${r.analisados} produto(s) · ~$${(r.custo || 0).toFixed(4)}`);
      await recarregar();
    } catch {
      setMsg('falha a gerar');
    } finally {
      setOcupado(false);
    }
  }
  async function aplicar(s) {
    setOcupado(true);
    try {
      await adm.aplicarNome(s.sku_id);
      setMsg(`✓ "${s.atual}" → "${s.sugerido}"`);
      setSugestoes((l) => l.filter((x) => x.sku_id !== s.sku_id));
    } catch (e) {
      setMsg(e.status === 409 ? '⚠ colisão: já existe um produto com esse nome' : 'falha a aplicar');
    } finally {
      setOcupado(false);
    }
  }
  async function rejeitar(s) {
    setOcupado(true);
    try {
      await adm.rejeitarNome(s.sku_id);
      setSugestoes((l) => l.filter((x) => x.sku_id !== s.sku_id));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="adm-fusoes">
      <div className="adm-auto">
        <button className="adm-auto-btn" onClick={gerar} disabled={ocupado}>
          ✨ Gerar sugestões de nome
        </button>
        <span className="adm-sug-dica">analisa os produtos com variantes de nome (talão · rótulo · Open Food Facts) e propõe o melhor nome canónico em português.</span>
        {msg && <span className="adm-ok">{msg}</span>}
      </div>
      {sugestoes === null ? (
        <p className="adm-vazio">a carregar…</p>
      ) : sugestoes.length === 0 ? (
        <p className="adm-vazio">Sem sugestões pendentes. Carrega em "Gerar sugestões". 👍</p>
      ) : (
        <ul className="adm-pares adm-nomes">
          {sugestoes.map((s) => (
            <li key={s.sku_id} className="adm-nome-li">
              <span className="adm-par-nomes">
                <span className="adm-nome-atual">{s.atual}</span>
                <span className="adm-par-seta">→</span>
                <b>{s.sugerido}</b>
              </span>
              {s.variantes?.length > 0 && <span className="adm-nome-vars">{s.variantes.join(' · ')}</span>}
              <span className="adm-nome-acoes">
                <button onClick={() => aplicar(s)} disabled={ocupado}>Aplicar</button>
                <button className="adm-rej" onClick={() => rejeitar(s)} disabled={ocupado}>Rejeitar</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Aba MERCADONA: foco no match dos talões PT contra o catálogo Mercadona (ES).
// Os produtos Hacendado são iguais nos dois países, mas o catálogo é espanhol —
// mostra só os candidatos do PRÓPRIO Mercadona, com tamanhos, p/ o operador casar.
function TabMercadona() {
  const [itens, setItens] = useState(null);
  const [msg, setMsg] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [feito, setFeito] = useState(() => new Set());

  const recarregar = () => adm.mercadonaMatch().then((r) => setItens(r.itens)).catch(() => setItens([]));
  useEffect(() => { recarregar(); }, []);

  async function casar(descricao, ean) {
    setOcupado(true);
    try {
      const r = await adm.mercadonaEan(descricao, ean);
      setMsg(`✓ "${descricao}" → EAN ${r.ean} (${r.n_itens} compra(s))`);
      setFeito((s) => new Set(s).add(descricao));
    } catch (e) { setMsg('✗ ' + (e.message || 'falhou')); }
    setOcupado(false);
  }

  const pend = (itens || []).filter((x) => !feito.has(x.descricao));
  const comCand = pend.filter((x) => x.candidatos.length);
  return (
    <div className="adm-fusoes">
      <div className="adm-auto">
        <span className="adm-merc-titulo">🛒 Talões Mercadona × catálogo Mercadona (Espanha)</span>
        <span className="adm-sug-dica">Os produtos Hacendado são iguais em PT e ES — aqui só aparecem candidatos do PRÓPRIO catálogo Mercadona, com o tamanho. Confirma o que bate; o item ganha ficha (nutrição via Open Food Facts) e sai da lista.</span>
        {msg && <span className="adm-ok">{msg}</span>}
      </div>
      {itens === null ? (
        <p className="adm-vazio">a carregar…</p>
      ) : pend.length === 0 ? (
        <p className="adm-vazio">Sem itens Mercadona por identificar. 👍</p>
      ) : (
        <>
          <p className="adm-aviso">{pend.length} itens · {comCand.length} com candidato no catálogo Mercadona</p>
          <ul className="adm-pares adm-eans">
            {pend.map((it) => (
              <li key={it.descricao} className="adm-ean-li">
                <div className="adm-ean-top">
                  <span className="adm-ean-talao">{it.descricao}</span>
                  {it.formato_pago && <span className="adm-ean-alt-fmt">{it.formato_pago}</span>}
                  {it.preco_pago != null && <span className="adm-ean-compras">€{it.preco_pago.toFixed(2)}</span>}
                  {it.compras > 1 && <span className="adm-ean-compras">{it.compras}×</span>}
                </div>
                {it.candidatos.length === 0 ? (
                  <div className="adm-ean-cand"><span className="adm-vazio2">sem candidato no catálogo Mercadona</span></div>
                ) : (
                  <div className="adm-merc-cands">
                    {it.candidatos.map((c) => (
                      <button key={c.ean} className="adm-merc-cand" disabled={ocupado}
                        title={`gravar EAN ${c.ean}`} onClick={() => casar(it.descricao, c.ean)}>
                        {c.imagem && <img className="adm-cand-img" src={c.imagem} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                        <b>{c.nome}</b>
                        {c.formato && <em className="adm-ean-alt-fmt">{c.formato}</em>}
                        <small>{Math.round(c.score * 100)}%</small>
                        <code className="adm-ean-cod">{c.ean}</code>
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// Matching de EAN: o resolvedor propõe um EAN (do catálogo Auchan/Continente)
// para cada nome de produto sem EAN; o operador aprova (→ ganha ficha+nutrição),
// corrige (escolhe uma alternativa) ou rejeita.
function TabEans() {
  const [sugestoes, setSugestoes] = useState(null);
  const [msg, setMsg] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [cadeiaSel, setCadeiaSel] = useState('');

  const recarregar = () => adm.matchEans().then((r) => setSugestoes(r.sugestoes)).catch(() => setSugestoes([]));
  useEffect(() => { recarregar(); }, []);

  async function gerar() {
    setOcupado(true);
    setMsg('a procurar candidatos no catálogo…');
    try {
      const r = await adm.gerarMatchEans(60);
      setMsg(`✓ ${r.novas} proposta(s) de ${r.analisados} produto(s) · ${r.sem_candidato} sem candidato`);
      await recarregar();
    } catch {
      setMsg('falha a gerar');
    } finally {
      setOcupado(false);
    }
  }
  async function aprovar(s, ean) {
    setOcupado(true);
    try {
      const r = await adm.aprovarMatchEan(s.id, ean);
      setMsg(`✓ "${s.descricao}" → EAN ${r.ean}${r.com_nutricao ? ' · com nutrição' : ''}`);
      setSugestoes((l) => l.filter((x) => x.id !== s.id));
    } catch {
      setMsg('falha a aprovar');
    } finally {
      setOcupado(false);
    }
  }
  async function rejeitar(s) {
    setOcupado(true);
    try {
      await adm.rejeitarMatchEan(s.id);
      setSugestoes((l) => l.filter((x) => x.id !== s.id));
    } finally {
      setOcupado(false);
    }
  }

  const banda = (c) => (c >= 0.8 ? 'forte' : c >= 0.6 ? 'media' : 'fraca');
  // o candidato veio da MESMA cadeia do item? (fonte 'lidl-fr'/'pingodoce' vs
  // cadeia 'Lidl'/'Pingo Doce'; fonte pode ser combinada 'mercadona+auchan').
  const mesmaLoja = (cadeiaItem, fonte) => {
    if (!cadeiaItem || !fonte) return false;
    const f = String(fonte).toLowerCase();
    return String(cadeiaItem).split(',').some((c) => {
      const t = c.trim().toLowerCase().replace(/\s+/g, '');
      return t && f.includes(t.slice(0, 6));
    });
  };

  return (
    <div className="adm-fusoes">
      <div className="adm-auto">
        <button className="adm-auto-btn" onClick={gerar} disabled={ocupado}>
          🔗 Gerar propostas de EAN
        </button>
        <span className="adm-sug-dica">procura cada produto SEM EAN no catálogo (Auchan · Continente · Mercadona · Lidl) e propõe o código de barras. Tu confirmas; ao aprovar, o produto ganha a ficha (Nutri-Score / nutrição via Open Food Facts).</span>
        {msg && <span className="adm-ok">{msg}</span>}
      </div>
      {(() => {
        if (!sugestoes || !sugestoes.length) return null;
        const cont = {};
        for (const s of sugestoes) for (const c of String(s.cadeia_item || '—').split(',').map((x) => x.trim()))
          cont[c] = (cont[c] || 0) + 1;
        const cadeias = Object.keys(cont).sort();
        if (cadeias.length < 2) return null;
        return (
          <div className="adm-ean-filtro">
            <button className={cadeiaSel === '' ? 'on' : ''} onClick={() => setCadeiaSel('')}>todas ({sugestoes.length})</button>
            {cadeias.map((c) => (
              <button key={c} className={cadeiaSel === c ? 'on' : ''} onClick={() => setCadeiaSel(c)}>{c} ({cont[c]})</button>
            ))}
          </div>
        );
      })()}
      {sugestoes === null ? (
        <p className="adm-vazio">a carregar…</p>
      ) : sugestoes.length === 0 ? (
        <p className="adm-vazio">Sem propostas pendentes. Carrega em "Gerar propostas de EAN". 👍</p>
      ) : (
        <ul className="adm-pares adm-eans">
          {sugestoes.filter((s) => !cadeiaSel || String(s.cadeia_item || '—').split(',').map((x) => x.trim()).includes(cadeiaSel)).map((s) => (
            <li key={s.id} className="adm-ean-li">
              <div className="adm-ean-top">
                <span className={`adm-ean-conf ${banda(s.confianca)}`}>{Math.round(s.confianca * 100)}%</span>
                {s.cadeia_item && <span className="adm-ean-cadeia" title="cadeia onde o item foi comprado">{s.cadeia_item}</span>}
                <span className="adm-ean-talao">{s.descricao}</span>
                {s.compras > 1 && <span className="adm-ean-compras">{s.compras}×</span>}
              </div>
              <div className="adm-ean-cand">
                <span className="adm-par-seta">→</span>
                {s.imagem && <img className="adm-cand-img" src={s.imagem} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                <b>{s.nome_cand}</b>
                {s.marca && <span className="adm-ean-marca">{s.marca}</span>}
                <code className="adm-ean-cod">{s.ean}</code>
                <span className={`adm-ean-fonte${mesmaLoja(s.cadeia_item, s.fonte) ? ' f-mesma' : ' f-outra'}`}
                  title={mesmaLoja(s.cadeia_item, s.fonte) ? 'candidato da MESMA cadeia do item' : 'candidato de OUTRA cadeia (ok p/ marca nacional; suspeito p/ marca-própria)'}>
                  {s.fonte}
                </span>
              </div>
              {(s.formato_pago || s.preco_pago != null || s.formato_cand || s.preco_cand != null) && (
                <div className="adm-ean-metr">
                  <span className="adm-ean-metr-lado">
                    <i>talão</i> {s.formato_pago || '—'}{s.preco_pago != null ? ` · €${s.preco_pago.toFixed(2)}` : ''}
                  </span>
                  <span className="adm-ean-metr-vs">vs</span>
                  <span className="adm-ean-metr-lado">
                    <i>catálogo</i> {s.formato_cand || '—'}{s.preco_cand != null ? ` · €${s.preco_cand.toFixed(2)}` : ''}
                  </span>
                  {s.preco_pago != null && s.preco_cand != null && (
                    Math.abs(Math.log(s.preco_pago / s.preco_cand)) < 0.12
                      ? <span className="adm-ean-metr-ok">💶 preço bate</span>
                      : <span className="adm-ean-metr-warn">⚠ tamanho?</span>
                  )}
                </div>
              )}
              {s.alternativas?.length > 0 && (
                <div className="adm-ean-alts">
                  <span className="adm-ean-alts-lbl">ou:</span>
                  {s.alternativas.map((a) => (
                    <button key={a.ean} className="adm-ean-alt" disabled={ocupado}
                      title={`usar este EAN (${a.ean})`} onClick={() => aprovar(s, a.ean)}>
                      {a.nome} {a.formato && <em className="adm-ean-alt-fmt">{a.formato}</em>} <small>{Math.round(a.score * 100)}%</small>
                    </button>
                  ))}
                </div>
              )}
              <div className="adm-ean-acoes">
                <button onClick={() => aprovar(s)} disabled={ocupado}>Aprovar</button>
                <button className="adm-rej" onClick={() => rejeitar(s)} disabled={ocupado}>Rejeitar</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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

// Mapa de USO (telemetria self-hosted): que funcionalidades são usadas, quantas
// vezes, última vez e por quem. Mostra o que é central e o que ninguém usa. 'api' =
// endpoint tocado; 'ui' = ação só-frontend (trocar de vista, abrir menu/carrinho).
function TabUso() {
  const [dias, setDias] = useState(30);
  const [dados, setDados] = useState(null);
  useEffect(() => {
    setDados(null);
    adm.uso(dias).then(setDados).catch(() => setDados({ eventos: [], resumo: {} }));
  }, [dias]);

  const r = dados?.resumo || {};
  const evs = dados?.eventos || [];
  return (
    <div className="adm-itens">
      <div className="adm-cards adm-it-cards">
        <div className="adm-card"><span className="adm-card-n">{r.total ?? '—'}</span><span className="adm-card-l">eventos</span></div>
        <div className="adm-card"><span className="adm-card-n">{r.n_sessoes ?? '—'}</span><span className="adm-card-l">sessões (visitas)</span></div>
        <div className="adm-card"><span className="adm-card-n">{r.n_users ?? '—'}</span><span className="adm-card-l">utilizadores</span></div>
      </div>
      <div className="adm-sug-top">
        <span className="adm-it-ord">janela:</span>
        {[7, 30, 0].map((d) => (
          <button key={d} className={dias === d ? 'on' : ''} onClick={() => setDias(d)}>{d === 0 ? 'tudo' : `${d} dias`}</button>
        ))}
        <span className="adm-sug-dica">funcionalidade → usos · última vez · quem · ('api' = endpoint, 'ui' = ação só-frontend)</span>
      </div>
      {dados === null ? (
        <p className="adm-vazio">a carregar…</p>
      ) : evs.length === 0 ? (
        <p className="adm-vazio">Ainda sem eventos nesta janela.</p>
      ) : (
        <div className="adm-itens-wrap">
          <table className="adm-tabela">
            <thead><tr><th>fonte</th><th>funcionalidade (evento)</th><th>usos</th><th>última vez</th><th>utilizadores</th></tr></thead>
            <tbody>
              {evs.map((e, i) => (
                <tr key={i}>
                  <td><span className={`adm-flag ${e.fonte === 'api' ? 'f-pi' : 'f-pend'}`}>{e.fonte}</span></td>
                  <td className="adm-it-nome">{e.evento}</td>
                  <td>{e.n}</td>
                  <td>{dataCurta(e.ultima)} {String(e.ultima || '').slice(11, 16)}</td>
                  <td className="adm-it-peso">{e.users || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// CUSTOS OpenRouter: quanto gastamos em LLM/VLM, por contexto (que função),
// por modelo e por dia. Os dados vêm de custo_chamada (registado a cada chamada).
function TabCustos() {
  const [dias, setDias] = useState(30);
  const [d, setD] = useState(null);
  useEffect(() => { setD(null); adm.custos(dias).then(setD).catch(() => setD(false)); }, [dias]);

  const usd = (v) => (v == null ? '—' : '$' + Number(v).toFixed(v < 0.01 ? 5 : v < 1 ? 4 : 2));
  const maxDia = Math.max(1, ...((d?.por_dia || []).map((x) => Number(x.usd) || 0)));
  const t = d?.total || {};
  return (
    <div className="adm-itens">
      <div className="adm-cards adm-it-cards">
        <div className="adm-card"><span className="adm-card-n">{usd(t.usd)}</span><span className="adm-card-l">gasto na janela</span></div>
        <div className="adm-card"><span className="adm-card-n">{t.chamadas ?? '—'}</span><span className="adm-card-l">chamadas</span></div>
        <div className="adm-card"><span className="adm-card-n">{usd(d?.geral?.usd)}</span><span className="adm-card-l">total desde sempre</span></div>
        <div className="adm-card"><span className="adm-card-n">{t.tin != null ? ((Number(t.tin) + Number(t.tout || 0)) / 1e6).toFixed(2) + 'M' : '—'}</span><span className="adm-card-l">tokens (in+out)</span></div>
      </div>
      <div className="adm-sug-top">
        <span className="adm-it-ord">janela:</span>
        {[7, 30, 365].map((dd) => (
          <button key={dd} className={dias === dd ? 'on' : ''} onClick={() => setDias(dd)}>{dd === 365 ? 'ano' : `${dd} dias`}</button>
        ))}
        <span className="adm-sug-dica">contexto = a função que chamou o LLM/VLM (extração, consulta, verificar nomes, comparar…). Custo em USD do OpenRouter.</span>
      </div>
      {d === null ? (
        <p className="adm-vazio">a carregar…</p>
      ) : d === false ? (
        <p className="adm-vazio">Falha a carregar.</p>
      ) : (
        <div className="adm-custos-grid">
          <div className="adm-custos-col">
            <h3>Por função (contexto)</h3>
            <table className="adm-tabela">
              <thead><tr><th>contexto</th><th>chamadas</th><th>custo</th><th>média/chamada</th></tr></thead>
              <tbody>
                {(d.por_contexto || []).map((c) => (
                  <tr key={c.contexto}>
                    <td className="adm-it-nome">{c.contexto}</td>
                    <td>{c.chamadas}</td>
                    <td className="adm-custo-usd">{usd(c.usd)}</td>
                    <td className="adm-it-peso">{usd(c.media)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Por modelo</h3>
            <table className="adm-tabela">
              <thead><tr><th>modelo</th><th>chamadas</th><th>custo</th></tr></thead>
              <tbody>
                {(d.por_modelo || []).map((m) => (
                  <tr key={m.modelo || '—'}>
                    <td className="adm-it-nome">{m.modelo || '—'}</td>
                    <td>{m.chamadas}</td>
                    <td className="adm-custo-usd">{usd(m.usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="adm-custos-col">
            <h3>Por dia</h3>
            <div className="adm-custos-dias">
              {(d.por_dia || []).slice().reverse().map((x) => (
                <div key={x.dia} className="adm-custo-dia">
                  <span className="adm-custo-dia-data">{dataCurta(x.dia)}</span>
                  <span className="adm-custo-dia-barra"><i style={{ width: `${Math.round(100 * (Number(x.usd) / maxDia))}%` }} /></span>
                  <span className="adm-custo-dia-usd">{usd(x.usd)}</span>
                  <span className="adm-custo-dia-n">{x.chamadas}×</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// FICHAS de produto (por EAN): pesquisar e editar TODAS as características do
// PRODUTO (nome/marca/tamanho/categoria/ingredientes/alergénios/nutrição) — o
// nível certo para corrigir dados do produto; a aba Itens trata a linha do talão.
const NUTRI_CAMPOS = [
  ['energia_kcal', 'kcal'], ['gordura', 'gordura g'], ['gordura_saturada', 'saturada g'],
  ['hidratos', 'hidratos g'], ['acucares', 'açúcares g'], ['fibra', 'fibra g'],
  ['proteina', 'proteína g'], ['sal', 'sal g'],
];
function FichaRow({ f, onPatch }) {
  const [edit, setEdit] = useState(false);
  const [d, setD] = useState(null);
  const [saving, setSaving] = useState(false);
  const nut = (() => { try { return f.nutricao ? JSON.parse(f.nutricao) : {}; } catch { return {}; } })();
  function abrir() {
    setD({
      nome: f.nome || '', marca: f.marca || '', quantidade: f.quantidade || '', categoria: f.categoria || '',
      validade: f.validade || '', ingredientes: f.ingredientes || '', alergenios: f.alergenios || '',
      nutricao: Object.fromEntries(NUTRI_CAMPOS.map(([k]) => [k, nut[k] ?? ''])),
    });
    setEdit(true);
  }
  async function salvar() {
    setSaving(true);
    try {
      await adm.atualizarFicha(f.ean, d);
      const novaNut = { ...nut };
      for (const [k, v] of Object.entries(d.nutricao)) {
        if (v === '' || v == null) delete novaNut[k];
        else { const num = Number(String(v).replace(',', '.')); if (Number.isFinite(num)) novaNut[k] = num; }
      }
      onPatch?.({ ...f, ...d, nutricao: JSON.stringify(novaNut) });
      setEdit(false);
    } catch (e) {
      alert('Falha ao salvar: ' + (e.message || e));
    } finally {
      setSaving(false);
    }
  }
  const set = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }));
  const setNut = (k) => (e) => setD((x) => ({ ...x, nutricao: { ...x.nutricao, [k]: e.target.value } }));
  if (!edit) {
    return (
      <div className="adm-ficha">
        <div className="adm-ficha-h">
          <b>{f.nome || <em>sem nome</em>}</b>
          {f.marca && <span className="adm-ficha-marca">{f.marca}</span>}
          {f.quantidade && <span className="adm-ficha-tam">{f.quantidade}</span>}
          <span className="adm-ficha-ean">{f.ean}</span>
          {f.nutricao_confirmada === 0 && Object.keys(nut).length > 0 && (
            <span className="adm-flag f-pf" title="nutrição lida do rótulo por IA, sem fonte independente">nutrição por confirmar</span>
          )}
          <span className="adm-ficha-meta">{f.fonte || '—'} · {f.n_compras} compra(s)</span>
          {f.nutricao_confirmada === 0 && Object.keys(nut).length > 0 && (
            <button
              className="adm-link-min"
              onClick={async () => { await adm.atualizarFicha(f.ean, { nutricao_confirmada: 1 }); onPatch?.({ ...f, nutricao_confirmada: 1 }); }}
            >✓ confirmar</button>
          )}
          <button className="adm-link-min" onClick={abrir}>✎ editar</button>
        </div>
        {(f.categoria || f.alergenios) && (
          <div className="adm-ficha-sub">{[f.categoria, f.alergenios && `alergénios: ${f.alergenios}`].filter(Boolean).join(' · ')}</div>
        )}
        {Object.keys(nut).length > 0 && (
          <div className="adm-ficha-nut">
            {NUTRI_CAMPOS.filter(([k]) => nut[k] != null).map(([k, lbl]) => `${lbl.replace(' g', '')} ${nut[k]}`).join(' · ')}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="adm-ficha edit">
      <div className="adm-ficha-grid">
        <label>nome<input value={d.nome} onChange={set('nome')} /></label>
        <label>marca<input value={d.marca} onChange={set('marca')} /></label>
        <label>tamanho<input value={d.quantidade} onChange={set('quantidade')} placeholder="ex.: 300 g" /></label>
        <label>categoria<input value={d.categoria} onChange={set('categoria')} /></label>
        <label>validade<input value={d.validade} onChange={set('validade')} placeholder="AAAA-MM-DD" /></label>
        <label>alergénios<input value={d.alergenios} onChange={set('alergenios')} /></label>
      </div>
      <label className="adm-ficha-full">ingredientes<textarea rows={2} value={d.ingredientes} onChange={set('ingredientes')} /></label>
      <div className="adm-ficha-nutgrid">
        {NUTRI_CAMPOS.map(([k, lbl]) => (
          <label key={k}>{lbl}<input inputMode="decimal" value={d.nutricao[k]} onChange={setNut(k)} /></label>
        ))}
      </div>
      <div className="adm-ficha-acoes">
        <button className="adm-ean-ok" onClick={salvar} disabled={saving}>{saving ? '…' : '✓ salvar'}</button>
        <button className="adm-link-min" onClick={() => setEdit(false)}>cancelar</button>
      </div>
    </div>
  );
}

function TabFichas() {
  const [q, setQ] = useState('');
  const [busca, setBusca] = useState('');
  const [dados, setDados] = useState(null);
  useEffect(() => {
    setDados(null);
    adm.listarFichas(busca).then((d) => setDados(d.fichas || [])).catch(() => setDados([]));
  }, [busca]);
  return (
    <div className="adm-itens">
      <div className="adm-sug-top">
        <input className="adm-it-busca" placeholder="procurar por EAN, nome ou marca…" value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setBusca(q.trim()); }} />
        <button onClick={() => setBusca(q.trim())}>procurar</button>
        {busca && <button onClick={() => { setQ(''); setBusca(''); }}>limpar</button>}
        <span className="adm-sug-dica">a FICHA do produto (por EAN) — o nível certo para corrigir nome/marca/tamanho/nutrição</span>
      </div>
      {dados === null ? (
        <p className="adm-vazio">a carregar…</p>
      ) : dados.length === 0 ? (
        <p className="adm-vazio">Nenhuma ficha.</p>
      ) : (
        <div className="adm-fichas">
          <p className="adm-sug-dica">{dados.length} ficha(s){dados.length >= 300 ? ' · limite 300 — refina a busca' : ''}</p>
          {dados.map((f) => (
            <FichaRow key={f.ean} f={f} onPatch={(nova) => setDados((ds) => ds.map((x) => (x.ean === f.ean ? nova : x)))} />
          ))}
        </div>
      )}
    </div>
  );
}

// Editor inline do EAN de um item: escrever/colar o código → ✓ grava (valida o
// dígito verificador no servidor e enriquece a ficha por Open Food Facts/catálogo).
// Vazio → limpa o EAN. Mostra o nome do produto encontrado como confirmação.
function EanEdit({ item, onSaved }) {
  const [v, setV] = useState(item.ean || '');
  const [estado, setEstado] = useState(null); // null | 'gravando' | {ok,msg} | {erro}
  useEffect(() => { setV(item.ean || ''); setEstado(null); }, [item.id]);
  const mudou = v.trim() !== (item.ean || '');
  async function gravar() {
    setEstado('gravando');
    try {
      const r = await adm.definirEanItem(item.id, v.trim());
      const msg = v.trim()
        ? (r.ficha?.nome ? '✓ ' + r.ficha.nome : r.ficha?.encontrado ? '✓ guardado' : '✓ sem ficha (OFF/catálogo)')
        : '✓ limpo';
      setEstado({ ok: true, msg });
      onSaved?.(r.ean || null);
    } catch (e) {
      setEstado({ erro: e.message || 'falha' });
    }
  }
  return (
    <span className="adm-ean-edit">
      <input
        inputMode="numeric"
        value={v}
        placeholder="—"
        onChange={(e) => setV(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => { if (e.key === 'Enter' && mudou) gravar(); }}
      />
      {mudou && (
        <button className="adm-ean-ok" onClick={gravar} disabled={estado === 'gravando'} title="gravar EAN">
          {estado === 'gravando' ? '…' : '✓'}
        </button>
      )}
      {estado && estado !== 'gravando' && (
        <span className={`adm-ean-msg ${estado.erro ? 'err' : 'ok'}`}>{estado.erro ? '✗ ' + estado.erro : estado.msg}</span>
      )}
    </span>
  );
}

// Linha da tabela de Itens: modo LEITURA (mostra tudo + flags + marca "por
// identificar") e modo EDIÇÃO (inputs para os campos extraídos → PATCH). O EAN
// edita-se na própria célula (com enriquecimento de ficha) em ambos os modos.
function ItemRow({ it, onAbrirNota, onPatch }) {
  const [edit, setEdit] = useState(false);
  const [d, setD] = useState(it);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setD(it); }, [it.id]);
  const fmt = (v, dec = 2) => (v == null || v === '' ? '—' : Number(v).toFixed(dec).replace('.', ','));
  const set = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }));
  const setChk = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.checked ? 1 : 0 }));
  // ao dar o peso (quantidade), recalcula €/base ao vivo e limpa "peso em falta"
  const setQtd = (e) => {
    const val = e.target.value;
    setD((x) => {
      const q = Number(String(val).replace(',', '.'));
      const pl = Number(x.preco_liquido);
      const next = { ...x, quantidade: val };
      if (q > 0 && Number.isFinite(pl)) {
        next.preco_por_base = Math.round((pl / q) * 10000) / 10000;
        next.peso_em_falta = 0;
      }
      return next;
    });
  };
  const flag = (cond, label, cls) => (Number(cond) ? <span className={`adm-flag ${cls}`}>{label}</span> : null);

  async function salvar() {
    setSaving(true);
    try {
      const campos = ['descricao_original', 'quantidade', 'preco_unitario', 'preco_liquido', 'preco_por_base', 'taxa_iva', 'desconto_direto', 'is_clearance', 'is_non_product', 'peso_em_falta', 'ppb_inferido'];
      const body = {};
      for (const c of campos) body[c] = d[c];
      await adm.atualizarItem(it.id, body);
      onPatch?.({ ...it, ...d });
      setEdit(false);
    } catch (e) {
      alert('Falha ao guardar: ' + (e.message || e));
    } finally {
      setSaving(false);
    }
  }

  if (edit) {
    return (
      <tr className="adm-it-edit">
        <td><input className="adm-it-inp adm-it-inp-nome" value={d.descricao_original || ''} onChange={set('descricao_original')} /></td>
        <td>{it.loja}</td>
        <td>{dataCurta(it.data)}</td>
        <td><input className="adm-it-inp num" value={d.quantidade ?? ''} onChange={setQtd} /></td>
        <td><input className="adm-it-inp num" value={d.preco_unitario ?? ''} onChange={set('preco_unitario')} /></td>
        <td><input className="adm-it-inp num" value={d.preco_liquido ?? ''} onChange={set('preco_liquido')} /></td>
        <td><input className="adm-it-inp num" value={d.preco_por_base ?? ''} onChange={set('preco_por_base')} /></td>
        <td>{it.unidade_base || '—'}</td>
        <td className="adm-it-peso">{it.linha_peso || '—'}</td>
        <td className="adm-it-ean"><EanEdit item={it} onSaved={(ean) => onPatch?.({ ...it, ean })} /></td>
        <td className="adm-it-peso">{it.marca || '—'}</td>
        <td><input className="adm-it-inp num" value={d.taxa_iva ?? ''} onChange={set('taxa_iva')} placeholder="0.06" /></td>
        <td><input className="adm-it-inp num" value={d.desconto_direto ?? ''} onChange={set('desconto_direto')} /></td>
        <td>{it.nome_canonico || <em className="adm-it-semsku">sem SKU</em>}</td>
        <td className="adm-it-flags adm-it-flags-edit">
          <label><input type="checkbox" checked={!!Number(d.is_non_product)} onChange={setChk('is_non_product')} /> não-produto</label>
          <label><input type="checkbox" checked={!!Number(d.is_clearance)} onChange={setChk('is_clearance')} /> liquidação</label>
          <label><input type="checkbox" checked={!!Number(d.peso_em_falta)} onChange={setChk('peso_em_falta')} /> peso falta</label>
          <label><input type="checkbox" checked={!!Number(d.ppb_inferido)} onChange={setChk('ppb_inferido')} /> ppb inf.</label>
        </td>
        <td className="adm-it-acoes">
          <button className="adm-ean-ok" onClick={salvar} disabled={saving}>{saving ? '…' : '✓ guardar'}</button>
          <button className="adm-link-min" onClick={() => { setD(it); setEdit(false); }}>cancelar</button>
        </td>
      </tr>
    );
  }
  return (
    <tr className={Number(it.por_identificar) ? 'adm-it-pend' : ''}>
      <td className="adm-it-nome">
        {it.descricao_original}
        {it.n_iguais > 1 && <span className="adm-it-mult" title={`${it.n_iguais} linhas iguais`}>×{it.n_iguais}</span>}
      </td>
      <td>{it.loja}</td>
      <td>{dataCurta(it.data)}</td>
      <td>{fmt(it.quantidade, 3)}</td>
      <td>{it.preco_unitario == null ? '—' : eur(it.preco_unitario)}</td>
      <td>{eur(it.preco_liquido)}</td>
      <td>{it.preco_por_base == null ? '—' : fmt(it.preco_por_base, 2)}{it.ppb_inferido ? '*' : ''}</td>
      <td>{it.unidade_base || '—'}</td>
      <td className="adm-it-peso">{it.linha_peso || '—'}</td>
      <td className="adm-it-ean"><EanEdit item={it} onSaved={(ean) => onPatch?.({ ...it, ean })} /></td>
      <td className="adm-it-peso">{it.marca || '—'}</td>
      <td>{it.taxa_iva == null ? '—' : `${Math.round(Number(it.taxa_iva) * 100)}%`}</td>
      <td>{Number(it.desconto_direto) ? eur(it.desconto_direto) : '—'}</td>
      <td>{it.nome_canonico || <em className="adm-it-semsku">sem SKU</em>}</td>
      <td className="adm-it-flags">
        {flag(it.por_identificar, 'por identificar', 'f-pend')}
        {flag(it.is_non_product, 'não-produto', 'f-np')}
        {flag(it.is_clearance, 'liquidação', 'f-cl')}
        {flag(it.peso_em_falta, 'peso em falta', 'f-pf')}
        {flag(it.ppb_inferido, 'ppb inferido', 'f-pi')}
      </td>
      <td className="adm-it-acoes">
        <button className="adm-link-min" onClick={() => { setD(it); setEdit(true); }}>✎ editar</button>
        <button className="adm-link-min" onClick={() => onAbrirNota(it.fatura_id)} title="abrir a nota (imagem + leitura)">{it.numero_fatura ? `#${it.numero_fatura}` : `nota ${it.fatura_id}`}</button>
      </td>
    </tr>
  );
}

// Inspeção do item CRU: o nome como aparece no talão da loja + a loja + TODAS as
// propriedades extraídas (qtd, preços, €/base, unidade, EAN, IVA, desconto, flags).
// Busca por nome/loja; clicar na nota abre a imagem+leitura. Para o operador
// diagnosticar e corrigir problemas de extração.
function TabItens({ onAbrirNota }) {
  const [q, setQ] = useState('');
  const [busca, setBusca] = useState('');
  const [ordenar, setOrdenar] = useState('loja'); // loja (loja+alfabético) | recente
  const [todos, setTodos] = useState(false); // false = só com EAN ou a precisar; true = tudo
  const [dados, setDados] = useState(null);
  const [resumo, setResumo] = useState(null);
  const carregarResumo = () => adm.itensResumo().then(setResumo).catch(() => setResumo(null));
  useEffect(() => {
    setDados(null);
    adm.listarItens(busca, ordenar, todos).then((d) => setDados(d.itens || [])).catch(() => setDados([]));
  }, [busca, ordenar, todos]);
  useEffect(() => { carregarResumo(); }, []);

  const fmt = (v, d = 2) => (v == null ? '—' : Number(v).toFixed(d).replace('.', ','));
  const flag = (cond, label, cls) => (cond ? <span className={`adm-flag ${cls}`}>{label}</span> : null);

  return (
    <div className="adm-itens">
      <div className="adm-cards adm-it-cards">
        <div className="adm-card">
          <span className="adm-card-n">{resumo ? resumo.eans : '—'}</span>
          <span className="adm-card-l">EANs diferentes que temos</span>
        </div>
        <div className="adm-card">
          <span className="adm-card-n adm-card-pend">{resumo ? resumo.por_identificar : '—'}</span>
          <span className="adm-card-l">produtos sem EAN (a identificar)</span>
        </div>
      </div>
      <div className="adm-sug-top">
        <input
          className="adm-it-busca"
          placeholder="procurar por nome do talão ou loja…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setBusca(q.trim()); }}
        />
        <button onClick={() => setBusca(q.trim())}>procurar</button>
        {busca && <button onClick={() => { setQ(''); setBusca(''); }}>limpar</button>}
        <span className="adm-it-ord">ordenar:</span>
        <button className={ordenar === 'loja' ? 'on' : ''} onClick={() => setOrdenar('loja')}>loja A-Z</button>
        <button className={ordenar === 'recente' ? 'on' : ''} onClick={() => setOrdenar('recente')}>recente</button>
        <button className={todos ? 'on' : ''} onClick={() => setTodos((t) => !t)} title="incluir frescos, não-produtos e já resolvidos sem EAN">
          {todos ? 'a ver todos' : 'ver todos'}
        </button>
        <span className="adm-sug-dica">{todos ? 'todos os itens' : 'só com EAN ou a precisar de identificação'} — o item como no talão + tudo o que extraímos</span>
      </div>
      {dados === null ? (
        <p className="adm-vazio">a carregar…</p>
      ) : dados.length === 0 ? (
        <p className="adm-vazio">Nenhum item.</p>
      ) : (
        <div className="adm-itens-wrap">
          <p className="adm-sug-dica">{dados.length} item(s){dados.length >= 600 ? ' · limite 600 — refina a busca' : ''}</p>
          <table className="adm-tabela adm-itens-tab">
            <thead>
              <tr>
                <th>nome no talão</th>
                <th>loja</th>
                <th>data</th>
                <th>qtd</th>
                <th>€/un</th>
                <th>€ pago</th>
                <th>€/base</th>
                <th>unid</th>
                <th>linha peso</th>
                <th>EAN</th>
                <th>marca</th>
                <th>IVA</th>
                <th>desc.</th>
                <th>SKU canónico</th>
                <th>flags</th>
                <th>ações</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const linhas = [];
                let lastLoja = null;
                for (const it of dados) {
                  if (ordenar === 'loja' && it.loja !== lastLoja) {
                    lastLoja = it.loja;
                    linhas.push(
                      <tr key={`g-${it.loja}`} className="adm-it-grupo">
                        <td colSpan={16}>{it.loja} · {dados.filter((x) => x.loja === it.loja).length}</td>
                      </tr>,
                    );
                  }
                  linhas.push(
                    <ItemRow
                      key={it.id}
                      it={it}
                      onAbrirNota={onAbrirNota}
                      onPatch={(novo) => { setDados((ds) => ds.map((x) => (x.id === it.id ? novo : x))); carregarResumo(); }}
                    />,
                  );
                }
                return linhas;
              })()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
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
      {dados.classificacao && <QualidadeClassificacao c={dados.classificacao} />}
    </div>
  );
}

// Saúde do CLASSIFICADOR (revisão 2026-06-12, item 1.2): distribuição de grupo
// ('outros'/'sem grupo' é o sinal de alarme), itens sem SKU, aliases por via
// (100=manual 90=match 75=juiz 60=novo — código de via, não probabilidade) e os
// nomes vindos do scan que o classificador-por-nome não resolve.
function QualidadeClassificacao({ c }) {
  const semSku = Number(c.itens?.sem_sku) || 0;
  const alarmes = (c.grupos || []).filter((g) => g.chave === 'outros' || g.chave === '(sem grupo)');
  return (
    <div className="adm-bloco">
      <h3>Classificação</h3>
      <p className="adm-aviso adm-aviso-fraco">
        Golden set de regressão em <code>backend/test/golden_grupos.test.mjs</code> (gate do deploy). Aqui: o estado vivo.
      </p>
      <div className="adm-kpis">
        <span><b>{semSku}</b> de {c.itens?.total} itens sem SKU</span>
        {alarmes.map((g) => <span key={g.chave}><b>{g.n}</b> SKUs em {g.chave}</span>)}
        <span><b>{c.scan?.sem_grupo_pelo_nome}</b> de {c.scan?.total} nomes de scan sem grupo pelo nome</span>
        <span>aliases: <b>{c.alias_por_via?.manual}</b> manual · <b>{c.alias_por_via?.via_match}</b> match · <b>{c.alias_por_via?.via_juiz}</b> juiz · <b>{c.alias_por_via?.via_novo}</b> novo</span>
      </div>
      <table className="adm-tabela adm-tabela-mini">
        <thead><tr><th>Grupo</th><th>SKUs</th></tr></thead>
        <tbody>{(c.grupos || []).map((g) => <tr key={g.chave}><td>{g.chave}</td><td>{g.n}</td></tr>)}</tbody>
      </table>
      {c.scan?.exemplos?.length > 0 && (
        <p className="adm-aviso adm-aviso-fraco">Scan sem grupo (vocabulário não cobre): {c.scan.exemplos.join(' · ')}</p>
      )}
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

// ─────────────────────────────── Saúde do cesto ───────────────────────────────
// Painel: grau de processamento (NOVA), Nutri-Score, ultraprocessados e onde a
// confiança é baixa (scan compensa). Nutrição pendurada na coorte facetada (OFF).
const NOVA_TXT = { 1: 'não processado', 2: 'ingrediente culinário', 3: 'processado', 4: 'ULTRAprocessado' };
const NOVA_CLS = { 1: 'q-bom', 2: 'q-bom', 3: 'q-medio', 4: 'q-mau' };
const NUTRI_CLS = { A: 'ns-a', B: 'ns-b', C: 'ns-c', D: 'ns-d', E: 'ns-e' };
function Barras({ dist, ordem, total, rotulo, classe }) {
  const t = total || Object.values(dist).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="adm-barras">
      {ordem.filter((k) => dist[k]).map((k) => {
        const p = Math.round((100 * dist[k]) / t);
        return (
          <div className="adm-barra-linha" key={k}>
            <span className={`adm-barra-rot ${classe(k)}`}>{rotulo(k)}</span>
            <span className="adm-barra-trilho">
              <span className={`adm-barra-fill ${classe(k)}`} style={{ width: `${p}%` }} />
            </span>
            <span className="adm-barra-pct">{p}% <em>({dist[k]})</em></span>
          </div>
        );
      })}
    </div>
  );
}
function TabSaude() {
  const [d, setD] = useState(null);
  useEffect(() => {
    adm.saude().then(setD).catch(() => setD({ erro: true }));
  }, []);
  if (!d) return <p className="adm-vazio">a calcular…</p>;
  if (d.erro) return <p className="adm-vazio">sem dados de nutrição ainda (povoa a cache categoria_nutricao).</p>;
  const novaT = Object.values(d.nova || {}).reduce((a, b) => a + b, 0);
  return (
    <div className="adm-saude">
      <p className="adm-aviso">
        Retrato nutricional do cesto. A nutrição vem do <b>Open Food Facts</b>, pendurada na <b>classe</b> do produto
        (não no item) — é uma <b>estimativa por categoria</b>, não medição clínica. <b>Factual, não conselho médico.</b>
      </p>
      <div className="adm-saude-cab">
        {d.comNut} de {d.total} compras com nutrição ({Math.round((100 * d.comNut) / (d.total || 1))}%)
      </div>

      <div className="adm-qtab">
        <h3>Grau de processamento (NOVA)</h3>
        <Barras dist={d.nova} ordem={['1', '2', '3', '4']} total={novaT} rotulo={(k) => `NOVA ${k} · ${NOVA_TXT[k]}`} classe={(k) => NOVA_CLS[k]} />
      </div>

      <div className="adm-qtab">
        <h3>Nutri-Score</h3>
        <Barras dist={d.nutri} ordem={['A', 'B', 'C', 'D', 'E']} rotulo={(k) => k} classe={(k) => NUTRI_CLS[k]} />
      </div>

      <div className="adm-saude-2col">
        <div className="adm-qtab">
          <h3>Ultraprocessados (NOVA 4) no cesto</h3>
          {d.ultra.length === 0 ? <p className="adm-vazio2">nenhum 🎉</p> : (
            <ul className="adm-chips">
              {d.ultra.map((x) => <li key={x.rotulo} className="adm-chip q-mau">{x.rotulo} <em>×{x.n}</em></li>)}
            </ul>
          )}
        </div>
        <div className="adm-qtab">
          <h3>Baixa confiança — um scan dá precisão</h3>
          {d.largas.length === 0 ? <p className="adm-vazio2">nenhuma</p> : (
            <ul className="adm-chips">
              {d.largas.map((x) => <li key={x.rotulo} className="adm-chip q-medio">{x.rotulo} <em>×{x.n}</em></li>)}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────── Notas ───────────────────────────────
function TabNotas({ notaAlvo, onConsumir }) {
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
  // Veio um pedido da aba Produtos (clique no 🧾): abre essa nota direto.
  // Põe o filtro em 'todas' para a nota aparecer também na lista à esquerda.
  useEffect(() => {
    if (!notaAlvo) return;
    setStatus('all');
    abrir(notaAlvo);
    onConsumir?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notaAlvo]);

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
    const r = await adm.atualizarItem(itemId, { quantidade: q });
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

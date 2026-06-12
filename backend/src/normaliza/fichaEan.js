// RESOLVEDOR ÚNICO da ficha por EAN (desenho fechado com o dono, 2026-06-13).
// Substitui a fusão "first-wins com remendos" espalhada por 5 módulos: recolhe
// TODAS as fontes locais do EAN e decide CAMPO A CAMPO pela tabela abaixo, com
// proveniência e divergências registadas (produto_ean.fusao, migração 052).
//
// ╔═ TABELA DE PRIORIDADES (a política única — alterações SÓ aqui) ═══════════╗
// ║ marca        catálogo (moda das lojas) > OFF > VLM                        ║
// ║   porquê: catálogo é curado; OFF marca terceiros como marca-própria       ║
// ║   (caso Felicia/Hacendado); compostos OFF ("Continente, Sonae").          ║
// ║ tamanho      VLM (rótulo real) > OFF > catálogo (formato real, não "Nun") ║
// ║ nome         candidatos PT, LIMPOS de marca+formato → colapso → consenso  ║
// ║   de tokens (≥2 fontes) > específico-confirmado; traduzido (nome_pt por   ║
// ║   léxico) vale menos que nativo de loja PT; nunca esvaziar; sem nenhum    ║
// ║   PT → melhor estrangeiro (a tradução LLM corre DEPOIS, fora da fusão).   ║
// ║ categoria    caminho de loja PT (o mais fundo) > OFF > VLM                ║
// ║ nutrição     catálogo-OFICIAL (tabela do fabricante, 047) > OFF > VLM     ║
// ║   plausível (nutricaoPlausivel) — INVERTIDO do legado (decisão do dono:   ║
// ║   OFF é crowdsourced). nutricao_confirmada=1 se catálogo/OFF; 0 se só VLM.║
// ║ ingredientes o MAIS COMPLETO (comprimento + alergénios destacados +       ║
// ║   percentagens), não por fonte — caso Penne: Auchan tinha "Contém glúten" ║
// ║   e o OFF só "sêmola, água".                                              ║
// ║ alergénios   OFF > VLM (campo dedicado; o catálogo embute nos ingredientes)║
// ║ validade     só VLM (vem do rótulo fotografado)                           ║
// ║ MANUAL       proveniência 'manual' NUNCA é sobrescrita pela re-fusão.     ║
// ╚════════════════════════════════════════════════════════════════════════════╝
//
// Sem LLM aqui dentro (determinístico, testável); OFF live e VLM entram como
// `extra` trazidos pelo chamador. Re-fusão barata: fontes_hash no JSON `fusao`.
import { createHash } from 'crypto';
import { norm, normAlfa } from './categoria.js';
import { nutricaoPlausivel } from './validadores.js';
import { tituloProduto } from './titulo.js';

const FONTES_PT = ['continente', 'auchan', 'mercadona-off', 'lidl', 'pingodoce'];

// ── helpers puros (exportados p/ testes) ─────────────────────────────────────

// Remove do nome a marca (tokens) e padrões de formato (500g, 1L, x4, 75cl…).
// Nunca esvazia: se sobrar nada (marca É o nome, ex. "Nutella"), devolve o original.
export function limparNomeProduto(nome, marca) {
  if (!nome) return nome;
  const mt = new Set(normAlfa(marca || '').split(' ').filter(Boolean));
  const FORMATO = /^\d+([.,]\d+)?(g|gr|kg|mg|ml|cl|l|lt|un|uni|x)$|^x?\d+$|^\d+x\d+.*$/i;
  const palavras = String(nome).split(/\s+/).filter(Boolean);
  const limpas = palavras.filter((w) => {
    const t = normAlfa(w).replace(/\s/g, '');
    if (!t) return false;
    if (mt.has(t)) return false;
    if (FORMATO.test(t)) return false;
    return true;
  });
  return (limpas.length ? limpas : palavras).join(' ');
}

// Escolhe o melhor NOME entre candidatos {texto, fonte, traduzido} JÁ limpos.
// Colapso por forma normalizada; consenso de tokens entre fontes distintas;
// especificidade só se confirmada (tokens extra existem noutro candidato).
export function escolherNome(cands) {
  const vivos = cands.filter((c) => c.texto && c.texto.trim());
  if (!vivos.length) return null;
  // agrupar por forma normalizada (colapso pós-limpeza)
  const grupos = new Map();
  for (const c of vivos) {
    const k = norm(c.texto);
    const g = grupos.get(k) || { k, texto: c.texto, fontes: new Set(), traduzido: true };
    g.fontes.add(c.fonte);
    g.traduzido = g.traduzido && !!c.traduzido; // só é "traduzido" se todos forem
    // preferir a grafia de um nativo dentro do grupo
    if (!c.traduzido) g.texto = c.texto;
    grupos.set(k, g);
  }
  const lista = [...grupos.values()];
  if (lista.length === 1) return lista[0].texto;
  // tokens com consenso (aparecem em ≥2 grupos·fontes distintas)
  const contagem = new Map();
  for (const g of lista) for (const t of new Set(norm(g.k).split(' '))) contagem.set(t, (contagem.get(t) || 0) + g.fontes.size);
  const score = (g) => {
    const toks = norm(g.k).split(' ').filter(Boolean);
    let s = 0;
    for (const t of toks) s += (contagem.get(t) || 0) > 1 ? 2 : -1; // consenso premeia, órfão penaliza
    s += Math.min(g.fontes.size, 3);                                // mais fontes = mais confiança
    if (g.traduzido) s -= 1;                                        // nativo > traduzido por léxico
    if (toks.length > 8) s -= (toks.length - 8);                    // verboso
    return s;
  };
  lista.sort((a, b) => score(b) - score(a) || b.fontes.size - a.fontes.size);
  return lista[0].texto;
}

// Ingredientes: o MAIS COMPLETO, não o da fonte mais "forte" — mas completo
// NÃO é só comprido: lixo-OCR e línguas estrangeiras perdem (achados do 1.º
// backfill: "PASTA Dl Wou Dl GRANO DURO… AlliiENTAlRES" vencia por comprimento;
// ES "Puede contener trazas" vencia o PT "Pode conter traços").
export function escolherIngredientes(cands) {
  const vivos = cands.filter((c) => c.texto && c.texto.trim().length >= 3);
  if (!vivos.length) return null;
  const score = (t) => {
    let s = Math.min(t.length, 600) / 10;            // comprimento (limitado)
    if (/[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{4,}/.test(t)) s += 20;     // alergénios destacados (MAIÚSCULAS)
    if (/\d+\s*%/.test(t)) s += 10;                  // percentagens (rótulo a sério)
    if (/cont[eé]m|vest[ií]gios|pode conter/i.test(t)) s += 15; // frases de alergénio
    if (/pode conter|vest[ií]gios|cont[ée]m\b|tra[çc]os de|[ãõ]|água|açúcar|sêmola|óleo|dióxido|enxofre|molho/i.test(t)) s += 25; // PT > estrangeiro
    if (/puede contener|trazas?\b|may contain|peut contenir|pu[òo] contenere|ingredienti\b|huevos?\b|leche|pescado|aceite\b|\beau\b|s[ée]ch[ée]|conservateur|anhydride|farine|di grano|semola di|contiene|habas/i.test(t)) s -= 20;
    s -= (t.match(/\b\w*[a-z][A-Z]\w*\b/g) || []).length * 12; // lixo-OCR: minúscula→MAIÚSCULA dentro da palavra
    const curtos = (t.match(/(^|\s)[A-Z][a-z]?(?=\s|$)/g) || []).length;
    if (curtos > 3) s -= (curtos - 3) * 5;           // excesso de tokens de 1-2 letras = OCR
    return s;
  };
  vivos.sort((a, b) => score(b.texto) - score(a.texto));
  return vivos[0];
}

// Alergénios: alimentam os ALERTAS determinísticos do perfil (que trabalham em
// PT) — preferir texto PT a tags cruas do OFF ('en:milk') ou rótulo estrangeiro
// ('Leche'); o valor 'anterior' (tradução LLM) concorre e vence os crus.
export function escolherAlergenios(cands) {
  const vivos = cands.filter((c) => c.texto && String(c.texto).trim() !== '');
  if (!vivos.length) return null;
  const PT = /leite|gl[úu]ten|soja|ovos?\b|frutos de casca|amendoim|peixe|crust[áa]ceos?|s[ée]samo|gergelim|mostarda|aipo|sulfitos?|cevada|trigo|nozes|avel[ãa]|tremo[çc]o|moluscos?|dióxido/i;
  const score = (t) => {
    let s = 0;
    if (PT.test(t)) s += 10;
    if (/[áéíóúâêôãõç]/i.test(t)) s += 2;                     // desempate: 'glúten' > 'gluten'
    s += Math.min((t.match(/,/g) || []).length, 5);           // mais completo ('leite, soja' > 'LEITE')
    if (/\b[a-z]{2}:/.test(t)) s -= 10;                       // tags cruas 'en:milk'
    if (/milk|leche|huevos?|wheat|barley|cebada|orge|soybeans|eggs|fish\b|nuts\b|sulphur|sulphites|lupin\b/i.test(t)) s -= 8;
    if (/[[\]{}"]/.test(t)) s -= 15;                          // lixo serializado ('[{"value":…')
    return s;
  };
  let melhor = vivos[0];
  for (const c of vivos.slice(1)) if (score(String(c.texto)) > score(String(melhor.texto))) melhor = c;
  return melhor;
}

const moda = (valores) => {
  const c = new Map();
  for (const v of valores) if (v) c.set(v, (c.get(v) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
};

// ── fusão principal ──────────────────────────────────────────────────────────
// Devolve { ficha, fusao } prontos a gravar. `extra`: { off, vlm } trazidos pelo
// chamador (OFF live / leitura de fotos); `atual`: linha produto_ean existente
// (para respeitar campos 'manual' e reaproveitar vlm_json/off_json gravados).
export async function fundirFichaEan(pool, ean, { extra = {}, atual = null } = {}) {
  const [cat] = await pool.query(
    `SELECT fonte, nome, nome_pt, marca, formato, COALESCE(NULLIF(categoria_path,''), categoria) AS categoria,
            nutricao, ingredientes FROM catalogo_produto WHERE ean = ? AND nome IS NOT NULL AND nome <> ''`, [ean]);
  const [[offDump]] = await pool.query('SELECT * FROM off_produto WHERE ean = ?', [ean]);
  const parse = (v) => { try { return v == null ? null : typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };
  // OFF: o resultado LIVE (extra.off ou off_json gravado — já curado, PT quando
  // havia) vence o dump CAMPO A CAMPO; o dump (ES/EN cru) só preenche buracos.
  // (1.º backfill: o dump escondia o off_json e ES/lixo-OCR substituía PT.)
  const offLive = extra.off || (atual?.off_json ? parse(atual.off_json) : null);
  const offD = offDump ? {
    nome: offDump.nome, nome_pt: offDump.nome_pt, marca: offDump.marca, quantidade: offDump.quantidade,
    categoria: offDump.categoria, ingredientes: offDump.ingredientes, alergenios: offDump.alergenios,
    nutricao_100g: parse(offDump.nutricao),
  } : null;
  const off = offLive || offD ? {
    nome: offLive?.nome ?? offD?.nome, nome_pt: offLive?.nome_pt ?? offD?.nome_pt,
    marca: offLive?.marca ?? offD?.marca, quantidade: offLive?.quantidade ?? offD?.quantidade,
    categoria: offLive?.categoria ?? offD?.categoria,
    ingredientes: offLive?.ingredientes ?? offD?.ingredientes, // p/ ficha; na escolha entram os DOIS
    alergenios: offLive?.alergenios || offD?.alergenios,
    nutricao_100g: offLive?.nutricao_100g ?? offD?.nutricao_100g ?? null,
  } : null;
  const vlm = extra.vlm || (atual?.vlm_json ? parse(atual.vlm_json) : null);
  const manual = new Set(Object.entries(parse(atual?.fusao)?.proveniencia || {}).filter(([, f]) => f === 'manual').map(([k]) => k));

  const prov = {}; const div = [];
  const escolhe = (campo, candidatos /* [{valor, fonte}] em ordem de prioridade */) => {
    if (manual.has(campo)) { prov[campo] = 'manual'; return atual?.[campo] ?? null; }
    const vivos = candidatos.filter((c) => c.valor != null && String(c.valor).trim() !== '');
    if (!vivos.length) {
      // NUNCA degradar: sem candidato, o valor já gravado fica (achado do 1.º backfill)
      if (atual?.[campo] != null && String(atual[campo]).trim() !== '') { prov[campo] = 'anterior'; return atual[campo]; }
      return null;
    }
    prov[campo] = vivos[0].fonte;
    const distintos = [...new Set(vivos.map((c) => norm(String(c.valor))))];
    if (distintos.length > 1) div.push({ campo, escolhido: vivos[0].valor, outros: vivos.slice(1).filter((c) => norm(String(c.valor)) !== norm(String(vivos[0].valor))).map((c) => ({ fonte: c.fonte, valor: String(c.valor).slice(0, 120) })) });
    return vivos[0].valor;
  };

  // MARCA: catálogo (moda) > OFF > VLM
  const marcaCat = moda(cat.map((c) => c.marca));
  const marca = escolhe('marca', [
    { valor: marcaCat, fonte: 'catalogo' },
    { valor: off?.marca, fonte: 'off' },
    { valor: vlm?.marca, fonte: 'vlm' },
  ]);

  // TAMANHO: VLM (rótulo) > OFF > catálogo (formato real)
  const fmtCat = cat.map((c) => c.formato).find((f) => f && !/^\d+ ?un$/i.test(f)) || null;
  const quantidade = escolhe('quantidade', [
    { valor: vlm?.quantidade, fonte: 'vlm' },
    { valor: off?.quantidade, fonte: 'off' },
    { valor: fmtCat, fonte: 'catalogo' },
  ]);

  // NOME: candidatos PT limpos (marca+formato fora) → colapso → consenso
  const candsNome = [];
  for (const c of cat) {
    if (c.nome_pt) candsNome.push({ texto: limparNomeProduto(c.nome_pt, marca || c.marca), fonte: c.fonte, traduzido: true });
    if (FONTES_PT.includes(c.fonte)) candsNome.push({ texto: limparNomeProduto(c.nome, marca || c.marca), fonte: c.fonte, traduzido: false });
  }
  if (off?.nome_pt) candsNome.push({ texto: limparNomeProduto(off.nome_pt, marca), fonte: 'off', traduzido: true });
  let nome, nomeEstrangeiro = false;
  if (manual.has('nome')) { nome = atual?.nome ?? null; prov.nome = 'manual'; }
  else if (candsNome.length) {
    nome = escolherNome(candsNome);
    prov.nome = candsNome.find((c) => norm(c.texto) === norm(nome))?.fonte || 'fusao';
  } else {
    // nenhum nome PT: melhor estrangeiro (OFF > VLM) — a tradução LLM corre depois
    nome = limparNomeProduto(off?.nome || vlm?.nome || null, marca);
    prov.nome = off?.nome ? 'off' : vlm?.nome ? 'vlm' : null;
    nomeEstrangeiro = !!nome;
    // o nome já gravado DIFERENTE do estrangeiro é (quase de certeza) a tradução
    // LLM da volta anterior — não a perder (caso Passata do 1.º backfill)
    if (nomeEstrangeiro && atual?.nome && norm(atual.nome) !== norm(nome)) {
      nome = atual.nome; prov.nome = 'anterior'; nomeEstrangeiro = false;
    }
    if (!nome && atual?.nome) { nome = atual.nome; prov.nome = 'anterior'; }
  }

  // CATEGORIA: caminho de loja PT mais fundo > OFF > VLM
  const catLoja = cat.filter((c) => FONTES_PT.includes(c.fonte) && c.categoria)
    .sort((a, b) => String(b.categoria).length - String(a.categoria).length
      || String(a.categoria).localeCompare(String(b.categoria)))[0]?.categoria || null;
  const categoria = escolhe('categoria', [
    { valor: catLoja, fonte: 'catalogo' },
    { valor: off?.categoria, fonte: 'off' },
    { valor: vlm?.categoria, fonte: 'vlm' },
  ]);

  // NUTRIÇÃO: catálogo-oficial > OFF > VLM-plausível (decisão do dono)
  const nutCat = cat.map((c) => parse(c.nutricao)).find((n) => n && nutricaoPlausivel(n)) || null;
  const nutOff = off?.nutricao_100g && nutricaoPlausivel(off.nutricao_100g) ? off.nutricao_100g : null;
  const nutVlm = vlm?.nutricao_100g && nutricaoPlausivel(vlm.nutricao_100g) ? vlm.nutricao_100g : null;
  let nutricao = null, nutConfirmada = 1;
  if (manual.has('nutricao')) { nutricao = parse(atual?.nutricao); prov.nutricao = 'manual'; }
  else if (nutCat) { nutricao = nutCat; prov.nutricao = 'catalogo-oficial'; }
  else if (nutOff) { nutricao = nutOff; prov.nutricao = 'off'; }
  else if (nutVlm) { nutricao = nutVlm; prov.nutricao = 'vlm'; nutConfirmada = 0; }

  // INGREDIENTES: o mais completo (live e dump do OFF concorrem em separado).
  // O valor JÁ GRAVADO concorre como 'anterior': é assim que a tradução LLM
  // (pós-fusão) sobrevive às re-fusões — ganha pela pontuação de língua PT,
  // mas um candidato novo melhor (ex. catálogo PT completo) ainda a bate.
  const ing = manual.has('ingredientes')
    ? { texto: atual?.ingredientes, fonte: 'manual' }
    : escolherIngredientes([
        ...cat.map((c) => ({ texto: c.ingredientes, fonte: `catalogo:${c.fonte}` })),
        { texto: offLive?.ingredientes, fonte: 'off' },
        { texto: offD?.ingredientes, fonte: 'off-dump' },
        { texto: vlm?.ingredientes, fonte: 'vlm' },
        { texto: atual?.ingredientes, fonte: 'anterior' },
      ]);
  if (ing) prov.ingredientes = ing.fonte;

  let alergenios = null;
  if (manual.has('alergenios')) { alergenios = atual?.alergenios ?? null; prov.alergenios = 'manual'; }
  else {
    const alg = escolherAlergenios([
      { texto: off?.alergenios, fonte: 'off' },
      { texto: vlm?.alergenios, fonte: 'vlm' },
      { texto: atual?.alergenios, fonte: 'anterior' },
    ]);
    if (alg) { alergenios = alg.texto; prov.alergenios = alg.fonte; }
  }
  const validade = escolhe('validade', [{ valor: vlm?.validade, fonte: 'vlm' }]);

  const fontesHash = createHash('sha1').update(JSON.stringify({ cat, off, vlm })).digest('base64').slice(0, 16);
  return {
    ficha: {
      nome: nome ? tituloProduto(nome) : null, marca: marca ? tituloProduto(marca) : null,
      // ℮ (símbolo "quantidade estimada" do rótulo) vira "e" no VLM → fora
      quantidade: quantidade ? String(quantidade).replace(/℮/g, '').replace(/\s+e$/i, '').trim() || null : null,
      categoria: categoria ? String(categoria).slice(0, 255) : null, // cap da coluna — senão re-fusões "mudam" sempre
      ingredientes: ing?.texto || null, alergenios: alergenios || null, validade: validade || null,
      nutricao, nutricao_confirmada: nutConfirmada,
    },
    fusao: { proveniencia: prov, divergencias: div, fontes_hash: fontesHash, fundido_em: new Date().toISOString().slice(0, 19) },
    nomeEstrangeiro, off, vlm,
  };
}

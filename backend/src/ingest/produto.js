// Identificação/enriquecimento de produto a partir de FOTOS dos rótulos + EAN.
// Duas fontes: (1) VLM sobre as fotos — descobre o máximo possível; (2) OFF pelo
// EAN — dados autoritativos se o produto existir na base. Devolve ambos para
// comparar (ambiente de teste). Ver docs/Visao_Conselheiro_Saude_Alimentar.md.
import { config } from '../config.js';
import { parseJsonLoose } from './extract.js';
import { getPool } from '../db.js';

const PROMPT = `És um extrator de RÓTULOS de produtos de supermercado. Vês uma ou mais fotos do MESMO produto, possivelmente de FACES DIFERENTES (frente, verso, lista de ingredientes, tabela nutricional, código de barras, fundo/aba com a validade). COMBINA a informação de todas as fotos. Descobre o MÁXIMO possível e devolve SÓ um objeto JSON, sem texto à volta:
{
  "nome": string|null,            // nome do produto como na embalagem
  "marca": string|null,
  "quantidade": string|null,      // peso/volume LÍQUIDO (ex.: "500 g", "1 L", "4 x 125 g")
  "ean": string|null,             // os DÍGITOS do código de barras, se visível na foto
  "categoria": string|null,       // tipo de produto (ex.: "iogurte grego", "bolacha digestive", "leite UHT")
  "ingredientes": string|null,    // VER REGRAS ABAIXO
  "alergenios": string|null,      // alergénios destacados (ex.: "leite, glúten")
  "validade": string|null,        // texto da validade como impresso (VER REGRAS)
  "validade_iso": string|null,    // a MESMA data normalizada: "AAAA-MM-DD", ou "AAAA-MM" se só houver mês/ano
  "nutricao_100g": {              // valores POR 100 g/ml; null o que não estiver legível
    "energia_kcal": number|null, "gordura": number|null, "gordura_saturada": number|null,
    "hidratos": number|null, "acucares": number|null, "proteina": number|null, "sal": number|null, "fibra": number|null
  }
}

REGRAS DA VALIDADE (importante):
- Procura a data junto a: "Validade", "Val.", "VAL", "Consumir até", "Cons. de preferência antes de", "Cons. pref.", "Best before", "BB", "EXP", "Use by".
- NÃO confundas com o LOTE ("Lote", "L", "LOT") nem com a data de FABRICO/produção/embalamento. O lote costuma vir colado a um código alfanumérico; ignora-o.
- Se houver VÁRIAS datas, a validade é a marcada como tal (ou, na dúvida, a mais TARDIA).
- Formatos comuns: "DD/MM/AAAA", "DD-MM-AA", "DD.MM.AAAA", "MM/AAAA", "fim de <mês> AAAA". Em "validade" mete o texto tal como impresso; em "validade_iso" mete a data normalizada (AAAA-MM-DD; usa AAAA-MM se só houver mês e ano).
- Se não vires nenhuma data de validade nas fotos, mete null nos dois campos (não inventes).

REGRAS DOS INGREDIENTES (importante):
- Transcreve a lista COMPLETA e VERBATIM, na ordem impressa, INCLUINDO percentagens (ex.: "tomate 90%") e sub-ingredientes entre parênteses.
- NÃO resumas, NÃO traduzas, NÃO omitas itens, NÃO reordenes. Copia o texto.
- Se a lista aparecer em VÁRIAS línguas, usa a versão PORTUGUESA (PT-PT); se não houver, a que estiver.
- Mantém o destaque dos alergénios (MAIÚSCULAS/negrito) tal como aparece no rótulo, e repete-os em "alergenios".
- Se a lista de ingredientes não estiver visível/legível em nenhuma foto, mete null (não inventes ingredientes a partir do nome do produto).

Não inventes — null no que não conseguires ler com confiança. Só o JSON.`;

// VLM sobre N fotos do mesmo produto. fotos: [{ base64, mime }].
export async function extrairProdutoFotos(fotos, { timeoutMs } = {}) {
  const content = [
    { type: 'text', text: PROMPT },
    ...fotos.map((f) => ({ type: 'image_url', image_url: { url: `data:${f.mime};base64,${f.base64}` } })),
  ];
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs || 40000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openrouter.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Bigbag' },
      body: JSON.stringify({ model: config.openrouter.modelExtracao, messages: [{ role: 'user', content }], response_format: { type: 'json_object' }, usage: { include: true } }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const data = await res.json();
    const dados = parseJsonLoose(data.choices?.[0]?.message?.content ?? '{}');
    return { dados, custo: Number(data.usage?.cost) || 0 };
  } finally {
    clearTimeout(to);
  }
}

const PROMPT_ANALISE = `És um documentalista de nutrição. Recebes os dados de UM produto alimentar (nome, categoria, ingredientes, nutrição por 100 g, e Nutri-Score/NOVA quando existirem). Produz uma análise FACTUAL e NÃO CLÍNICA — só factos sobre o produto, SEM conselhos médicos, diagnósticos nem recomendações personalizadas. Idioma: português do Brasil (trata o leitor por "você"). Devolve SÓ um objeto JSON:
{
  "resumo": string,                          // 1-2 frases, linguagem simples: do que se trata
  "nivel_processamento": {
    "nova": 1|2|3|4|null,                     // grupo NOVA (usa o fornecido se existir)
    "rotulo": string,                         // ex.: "ultraprocessado", "processado", "in natura"
    "porque": string                          // 1 frase factual
  },
  "nutriscore": { "grau": "A"|"B"|"C"|"D"|"E"|null, "porque": string },  // explica pelos NUTRIENTES (ver regras)
  "ingredientes": [                           // UM objeto por ingrediente, na ordem do rótulo
    {
      "nome": string,
      "tipo": string,                         // ex.: "base", "regulador de acidez", "estabilizador", "conservante", "antiaglomerante"
      "e_numero": string|null,                // o E-número do aditivo (ver regras)
      "funcao": string,                       // para que serve, 1 frase simples
      "origem": string|null,                  // ex.: "alga", "leguminosa", "mineral", "leite"
      "nota": string|null                     // facto relevante, se houver (ex.: "fonte de fósforo adicionado")
    }
  ],
  "alergenios": [string],
  "destaques": [                              // factos que saltam à vista
    { "tom": "atencao"|"bom"|"neutro", "texto": string }   // ex.: sal alto, gordura saturada, nº de aditivos, fósforo adicionado, sem açúcar adicionado
  ],
  "parecer": string                           // VER REGRAS (comentário estilo nutricionista)
}
Regras:
- E-NÚMEROS: para aditivos bem conhecidos, INCLUI o E-número correto (ex.: ácido cítrico→E330, fosfato dissódico→E339, citrato trissódico→E331, fosfato tricálcico→E341, agar-agar→E406, farinha de sementes de alfarroba/goma de alfarroba→E410, goma de tara→E417, sorbato de potássio→E202). Usa null SÓ para ingredientes que não são aditivos com E-número (leite, nata, sal, água, fermentos) ou se realmente desconheceres.
- NUTRI-SCORE: usa o grau fornecido se existir; no "porque", explica-o pelos NUTRIENTES concretos (ex.: "penalizado pela gordura saturada alta e pelo sal; pouca fibra/proteína a compensar"). Se não for fornecido, estima e di-lo.
- NOVA: usa o fornecido se existir; senão deriva (presença de aditivos cosméticos → 4).
- PARECER: NO MÁXIMO 3 frases curtas (cabe em ~7 linhas no telemóvel). Tom de CONVERSA, como um amigo que por acaso é nutricionista a comentar contigo — descontraído, direto e humano. Diz só o essencial: o que é, 1 ponto menos bom E 1 ponto bom (sempre os dois). Trata por "você". PROIBIDO arranques e fechos professorais ("É importante notar…", "Vale lembrar…", "para fazer escolhas informadas…") — entra logo no assunto. Sem prescrever ("deve evitar"), sem julgar, sem diagnóstico. Exemplo do REGISTO certo (não copies, é só o tom): "Esse aqui é um queijo de barrar bem cremoso. O lado fraco é que carrega bastante gordura saturada, sal e uma boa lista de aditivos pra ficar com essa textura — em compensação, te dá uma proteína bacana."
- Sê factual, nunca prescritivo (nada de "deve evitar"/"é saudável"). Só o JSON.`;

// Análise FACTUAL (não clínica) de um produto a partir dos dados consolidados.
// p: { nome, categoria, ingredientes, nutricao_100g, nutriscore, nova }.
export async function analisarProduto(p, { timeoutMs } = {}) {
  const payload = {
    nome: p.nome || null,
    categoria: p.categoria || null,
    ingredientes: p.ingredientes || null,
    nutricao_100g: p.nutricao_100g || null,
    nutriscore: p.nutriscore || null,
    nova: p.nova ?? null,
  };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs || 30000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openrouter.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Bigbag' },
      body: JSON.stringify({
        model: config.openrouter.modelConsulta,
        messages: [
          { role: 'system', content: PROMPT_ANALISE },
          { role: 'user', content: 'Dados do produto:\n' + JSON.stringify(payload, null, 2) },
        ],
        response_format: { type: 'json_object' },
        usage: { include: true },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const data = await res.json();
    const analise = parseJsonLoose(data.choices?.[0]?.message?.content ?? '{}');
    return { analise, custo: Number(data.usage?.cost) || 0 };
  } finally {
    clearTimeout(to);
  }
}

const PROMPT_CARACT = `És uma base de composição de alimentos. Recebes o NOME de um produto de supermercado (em português) e classificas + dás a nutrição típica. Devolve SÓ JSON:
{
  "tipo": "fresco" | "processado",
  "alimento": string,              // alimento genérico identificado (ex.: "banana", "courgette", "peito de frango")
  "categoria": string,
  "nutricao_100g": {               // por 100 g
    "energia_kcal": number|null, "gordura": number|null, "gordura_saturada": number|null,
    "hidratos": number|null, "acucares": number|null, "proteina": number|null, "sal": number|null, "fibra": number|null
  }
}
Regras:
- "fresco" = alimento inteiro ou minimamente processado, vendido a peso/unidade, SEM rótulo de ingredientes: fruta, legume, hortaliça, carne/peixe fresco, ovos, frutos secos/leguminosas a granel. Para estes, dá os valores TÍPICOS por 100 g (crus, são bem conhecidos das tabelas de composição).
- "processado" = produto EMBALADO com rótulo (iogurte, queijo, bolacha, conserva, bebida, cereais, charcutaria…). Para estes, mete TODOS os campos de nutricao_100g a NULL — a nutrição vem do rótulo, não inventes.
- Na dúvida entre fresco e processado, escolhe "processado".
- Só o JSON.`;

// Classifica um produto pelo NOME (fresco vs. embalado) e, se fresco, devolve a
// nutrição típica por 100 g (sem precisar de EAN nem rótulo).
export async function caracterizarProdutoNome(nome, { timeoutMs } = {}) {
  // 1 retry: o LLM às vezes devolve JSON truncado ("Unexpected end of JSON input").
  let ultimoErro;
  for (let tent = 0; tent < 2; tent++) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs || 20000);
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.openrouter.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Bigbag' },
        body: JSON.stringify({
          model: config.openrouter.modelConsulta,
          messages: [{ role: 'system', content: PROMPT_CARACT }, { role: 'user', content: `Produto: "${nome}"` }],
          response_format: { type: 'json_object' },
          usage: { include: true },
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
      const data = await res.json();
      const dados = parseJsonLoose(data.choices?.[0]?.message?.content ?? '{}');
      if (dados.tipo !== 'fresco') dados.nutricao_100g = null; // processado → nutrição vem do rótulo
      return { dados, custo: Number(data.usage?.cost) || 0 };
    } catch (e) {
      ultimoErro = e;
    } finally {
      clearTimeout(to);
    }
  }
  throw ultimoErro;
}

// Garante a caracterização genérica (nutrição-por-NOME) de um SKU, com CACHE em
// produto_generico: chama o LLM SÓ na 1.ª vez; nas seguintes devolve o que está
// guardado. É a cache partilhada por SKU (o mesmo produto = uma entrada). Usada
// pelo fluxo da foto/identificação para frescos sem EAN (ex.: "fraldinha").
export async function garantirGenericoSku(pool, skuId, nome) {
  if (!skuId) return null;
  const [[g]] = await pool.query(
    'SELECT tipo, alimento, categoria, nutricao FROM produto_generico WHERE sku_id = ?', [skuId]);
  if (g) {
    const nut = typeof g.nutricao === 'string' ? parseJsonLoose(g.nutricao) : g.nutricao;
    return { tipo: g.tipo, alimento: g.alimento, categoria: g.categoria, nutricao_100g: nut || null, cacheada: true, custo: 0 };
  }
  if (!nome) return null;
  const { dados, custo } = await caracterizarProdutoNome(nome);
  const tipo = dados.tipo === 'fresco' ? 'fresco' : 'processado';
  await pool.query(
    `INSERT INTO produto_generico (sku_id, tipo, alimento, categoria, nutricao, modelo) VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE tipo=VALUES(tipo), alimento=VALUES(alimento), categoria=VALUES(categoria), nutricao=VALUES(nutricao), modelo=VALUES(modelo)`,
    [skuId, tipo, dados.alimento || null, dados.categoria || null,
      dados.nutricao_100g ? JSON.stringify(dados.nutricao_100g) : null, config.openrouter.modelConsulta],
  );
  return { tipo, alimento: dados.alimento || null, categoria: dados.categoria || null, nutricao_100g: dados.nutricao_100g || null, cacheada: false, custo };
}

const PROMPT_NOME = `És um normalizador de nomes de produtos de supermercado. Recebes VÁRIAS variantes do nome do MESMO produto (de talões, rótulos e bases de dados — podem estar em línguas diferentes, em MAIÚSCULAS, abreviadas ou com códigos). Escolhe/compõe o MELHOR nome canónico em PORTUGUÊS. Devolve SÓ JSON: {"nome": string}.
Regras:
- Português (PT). Capitalização normal: Primeira Letra Maiúscula nas palavras principais (minúsculas em "de/da/do/com/e/para").
- SEM códigos de loja, SEM quantidades/pesos/embalagem (ex.: "2KG", "X4", "TP 25", "500 G").
- NOME GENÉRICO (de FAMÍLIA): NÃO incluas a MARCA comercial (fabricante ou marca-de-loja: Heinz, Mythos, SerraMel, Hacendado, Continente, Milbona, Kania…). O nome normalizado é a FAMÍLIA que engloba VÁRIAS marcas e tamanhos — o mesmo nome serve produtos de lojas diferentes. Ex.: "Ketchup" (NÃO "Ketchup Heinz"), "Iogurte Grego Natural" (NÃO "... Mythos"), "Doce de Leite" (NÃO "... Chimbote").
- Mantém o TIPO e a VARIEDADE que DEFINEM a família (ex.: "Grego", "Ligeiro", "Biológico", "Curado 7 Meses", "de Rosmaninho", "Grana Padano" — este é um tipo de queijo, não uma marca). Só a MARCA comercial é que sai.
- Claro e natural. Se uma das variantes já for um bom nome PT genérico, usa-a (limpa).
- Só o JSON.`;

// Sugere o melhor nome canónico GENÉRICO (PT, sem marca) das variantes de nome.
export async function sugerirNomeCanonico(variantes, { timeoutMs } = {}) {
  const lista = [...new Set((variantes || []).map((v) => String(v || '').trim()).filter(Boolean))];
  if (!lista.length) return { nome: null, custo: 0 };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs || 20000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openrouter.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Bigbag' },
      body: JSON.stringify({
        model: config.openrouter.modelConsulta,
        messages: [{ role: 'system', content: PROMPT_NOME }, { role: 'user', content: 'Variantes:\n- ' + lista.join('\n- ') }],
        response_format: { type: 'json_object' },
        usage: { include: true },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const data = await res.json();
    const j = parseJsonLoose(data.choices?.[0]?.message?.content ?? '{}');
    return { nome: (j.nome || '').trim() || null, custo: Number(data.usage?.cost) || 0 };
  } finally {
    clearTimeout(to);
  }
}

// Lê os DÍGITOS do código de barras de uma foto (fallback quando o scanner ao vivo
// falha — ex.: telemóvel antigo). foto: { base64, mime }. O chamador valida o EAN.
export async function lerEanDeFoto(foto, { timeoutMs } = {}) {
  const content = [
    { type: 'text', text: 'Vês a foto de um CÓDIGO DE BARRAS de um produto de supermercado. Devolve SÓ os DÍGITOS do número impresso (EAN-13, EAN-8 ou UPC), lendo com atenção dígito a dígito. JSON: {"ean": string|null}. null se não der para ler.' },
    { type: 'image_url', image_url: { url: `data:${foto.mime};base64,${foto.base64}` } },
  ];
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs || 25000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openrouter.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Bigbag' },
      body: JSON.stringify({ model: config.openrouter.modelExtracao, messages: [{ role: 'user', content }], response_format: { type: 'json_object' }, usage: { include: true } }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const data = await res.json();
    const dados = parseJsonLoose(data.choices?.[0]?.message?.content ?? '{}');
    return { ean: dados.ean ? String(dados.ean).replace(/\D/g, '') : null, custo: Number(data.usage?.cost) || 0 };
  } finally {
    clearTimeout(to);
  }
}

// Classifica uma foto da câmara: TALÃO, PRODUTO (embalagem) ou outro. Se produto,
// extrai nome/marca/EAN(se legível). Para a câmara "inteligente" do rodapé.
export async function analisarFotoProduto(foto, { timeoutMs } = {}) {
  const content = [
    { type: 'text', text: `Classifica esta imagem. Devolve SÓ JSON:
- se for um TALÃO/recibo de supermercado: {"tipo":"talao"}
- se for a FOTO de UM PRODUTO (embalagem/rótulo de um único artigo): {"tipo":"produto","nome":string,"marca":string|null,"ean":string|null,"categoria":string|null}  (ean = dígitos do código de barras SE legíveis, senão null)
- outra coisa qualquer: {"tipo":"outro"}` },
    { type: 'image_url', image_url: { url: `data:${foto.mime};base64,${foto.base64}` } },
  ];
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs || 25000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openrouter.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Bigbag' },
      body: JSON.stringify({ model: config.openrouter.modelExtracao, messages: [{ role: 'user', content }], response_format: { type: 'json_object' }, usage: { include: true } }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const data = await res.json();
    return { dados: parseJsonLoose(data.choices?.[0]?.message?.content ?? '{}'), custo: Number(data.usage?.cost) || 0 };
  } finally {
    clearTimeout(to);
  }
}

// Procura no Open Food Facts por NOME (texto) e devolve o EAN do melhor resultado.
export async function buscarOffPorNome(query) {
  const q = String(query || '').trim();
  if (q.length < 3) return null;
  try {
    const u = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=3&fields=code,product_name,brands`;
    const r = await fetch(u, { headers: { 'User-Agent': 'Bigbag/0.1 (laboratorio pessoal)' } });
    const j = await r.json();
    const p = (j.products || []).find((x) => x.code && /^\d{8,14}$/.test(String(x.code)));
    return p ? String(p.code) : null;
  } catch {
    return null;
  }
}

// Valida o dígito verificador de um código GTIN (EAN-8/UPC-12/EAN-13/GTIN-14).
// Apanha a maioria dos erros de leitura do VLM (ex.: 1.º dígito 4→2) sem internet.
export function eanValido(cod) {
  const s = String(cod || '').replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(s.length)) return false;
  const d = s.split('').map(Number);
  const check = d.pop();
  let sum = 0;
  for (let i = d.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += d[i] * w;
  return (10 - (sum % 10)) % 10 === check;
}

// Consulta o Open Food Facts pelo EAN (dados autoritativos do produto exato).
// 1.º o EXTRATO LOCAL do dump (off_produto, migração 038 — Lidl/Aldi/PT em massa):
// instantâneo, offline, sem rate-limit; só depois a API.
export async function consultarOFF(ean) {
  const cod = String(ean || '').replace(/\D/g, '');
  if (cod.length < 8) return null;
  try {
    const [[l]] = await getPool().query('SELECT * FROM off_produto WHERE ean = ?', [cod]);
    if (l) {
      const j = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
      return {
        nome: l.nome_pt || l.nome, marca: l.marca, quantidade: l.quantidade,
        categoria: l.categoria, ingredientes: l.ingredientes, alergenios: l.alergenios,
        categorias_tags: j(l.categorias_tags), grupos_alimento: j(l.grupos_alimento), labels: j(l.labels),
        nutriscore: l.nutriscore || null, nova: l.nova ?? null, imagem: null,
        nutricao_100g: j(l.nutricao) || {},
      };
    }
  } catch { /* tabela ainda não existe / erro → cai para a API */ }
  try {
    const u = `https://world.openfoodfacts.org/api/v2/product/${cod}?fields=product_name,brands,quantity,categories,categories_tags,food_groups_tags,labels_tags,ingredients_text,allergens,nutriscore_grade,nova_group,nutriments,image_url`;
    const r = await fetch(u, { headers: { 'User-Agent': 'Bigbag/0.1 (laboratorio pessoal)' } });
    const j = await r.json();
    if (j.status !== 1 || !j.product) return null;
    const p = j.product, n = p.nutriments || {};
    return {
      nome: p.product_name || null, marca: p.brands || null, quantidade: p.quantity || null,
      categoria: p.categories || null, ingredientes: p.ingredients_text || null, alergenios: p.allergens || null,
      // DAG de categorias do OFF (âncora da classificação facetada — vem de graça
      // na mesma resposta; persistir agora evita um backfill impossível depois)
      categorias_tags: p.categories_tags || null, grupos_alimento: p.food_groups_tags || null, labels: p.labels_tags || null,
      nutriscore: (p.nutriscore_grade || '').toUpperCase() || null, nova: p.nova_group || null, imagem: p.image_url || null,
      nutricao_100g: {
        energia_kcal: n['energy-kcal_100g'] ?? null, gordura: n.fat_100g ?? null, gordura_saturada: n['saturated-fat_100g'] ?? null,
        hidratos: n.carbohydrates_100g ?? null, acucares: n.sugars_100g ?? null, proteina: n.proteins_100g ?? null, sal: n.salt_100g ?? null, fibra: n.fiber_100g ?? null,
      },
    };
  } catch {
    return null;
  }
}

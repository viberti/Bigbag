// Identificação/enriquecimento de produto a partir de FOTOS dos rótulos + EAN.
// Duas fontes: (1) VLM sobre as fotos — descobre o máximo possível; (2) OFF pelo
// EAN — dados autoritativos se o produto existir na base. Devolve ambos para
// comparar (ambiente de teste). Ver docs/Visao_Conselheiro_Saude_Alimentar.md.
import { config } from '../config.js';
import { parseJsonLoose } from './extract.js';

const PROMPT = `És um extrator de RÓTULOS de produtos de supermercado. Vês uma ou mais fotos do MESMO produto (frente, lista de ingredientes, tabela nutricional, código de barras, validade). Descobre o MÁXIMO possível e devolve SÓ um objeto JSON, sem texto à volta:
{
  "nome": string|null,            // nome do produto como na embalagem
  "marca": string|null,
  "quantidade": string|null,      // peso/volume LÍQUIDO (ex.: "500 g", "1 L", "4 x 125 g")
  "ean": string|null,             // os DÍGITOS do código de barras, se visível na foto
  "categoria": string|null,       // tipo de produto (ex.: "iogurte grego", "bolacha digestive", "leite UHT")
  "ingredientes": string|null,    // lista de ingredientes, texto como impresso
  "alergenios": string|null,      // alergénios destacados (ex.: "leite, glúten")
  "validade": string|null,        // data de validade impressa (texto, como aparece)
  "nutricao_100g": {              // valores POR 100 g/ml; null o que não estiver legível
    "energia_kcal": number|null, "gordura": number|null, "gordura_saturada": number|null,
    "hidratos": number|null, "acucares": number|null, "proteina": number|null, "sal": number|null, "fibra": number|null
  }
}
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

// Consulta o Open Food Facts pelo EAN (dados autoritativos do produto exato).
export async function consultarOFF(ean) {
  const cod = String(ean || '').replace(/\D/g, '');
  if (cod.length < 8) return null;
  try {
    const u = `https://world.openfoodfacts.org/api/v2/product/${cod}?fields=product_name,brands,quantity,categories,ingredients_text,allergens,nutriscore_grade,nova_group,nutriments,image_url`;
    const r = await fetch(u, { headers: { 'User-Agent': 'Bigbag/0.1 (laboratorio pessoal)' } });
    const j = await r.json();
    if (j.status !== 1 || !j.product) return null;
    const p = j.product, n = p.nutriments || {};
    return {
      nome: p.product_name || null, marca: p.brands || null, quantidade: p.quantity || null,
      categoria: p.categories || null, ingredientes: p.ingredients_text || null, alergenios: p.allergens || null,
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

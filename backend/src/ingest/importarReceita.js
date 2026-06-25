// IMPORTAR RECEITA DA INTERNET — recebe um URL (site, blog, vídeo, rede social) e tenta extrair
// nome, foto, ingredientes, modo de preparo, tempo e porções. Estratégia em camadas:
//   1) schema.org Recipe via JSON-LD (a maioria dos sites de receitas publica) — limpo e estruturado.
//   2) OpenGraph/meta (og:title, og:image, description) — sempre que houver.
//   3) LLM de recurso sobre o TEXTO da página — para blogs/posts sem dados estruturados.
// Nunca falha "para o utilizador": se nada se extrair, guarda na mesma o link + o que houver (bruto).
import { chatCompletion } from '../openrouter.js';
import { config } from '../config.js';

const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36';

// ISO-8601 de duração (PT1H30M) → "1 h 30 min"
function duracaoHumana(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const m = iso.match(/^P(?:T)?(?:(\d+)H)?(?:(\d+)M)?/i) || iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return null;
  const h = parseInt(m[1] || '0', 10), min = parseInt(m[2] || '0', 10);
  if (!h && !min) return null;
  return [h ? `${h} h` : '', min ? `${min} min` : ''].filter(Boolean).join(' ');
}

const txt = (v) => (typeof v === 'string' ? v.trim() : '');
function primeiraImagem(img) {
  if (!img) return null;
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return primeiraImagem(img[0]);
  if (typeof img === 'object') return img.url || primeiraImagem(img.contentUrl) || null;
  return null;
}
// recipeInstructions: string | [string] | [HowToStep{text}] | [HowToSection{itemListElement}]
function passos(ri) {
  if (!ri) return [];
  if (typeof ri === 'string') return ri.split(/\n+|\.\s+(?=[A-ZÀ-Ý])/).map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(ri)) return ri.flatMap((x) => {
    if (typeof x === 'string') return [x.trim()];
    if (x && x['@type'] === 'HowToSection' && Array.isArray(x.itemListElement)) return passos(x.itemListElement);
    if (x && (x.text || x.name)) return [String(x.text || x.name).trim()];
    return [];
  }).filter(Boolean);
  return [];
}

// extrai todos os blocos <script type="application/ld+json"> e devolve objetos achatados (@graph incl.)
function lerJsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const j = JSON.parse(m[1].trim().replace(/^﻿/, ''));
      const arr = Array.isArray(j) ? j : [j];
      for (const o of arr) { out.push(o); if (Array.isArray(o['@graph'])) out.push(...o['@graph']); }
    } catch { /* bloco inválido — ignora */ }
  }
  return out;
}
const ehReceita = (o) => {
  const t = o && o['@type'];
  return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
};

function metaTag(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
  const m = html.match(re) || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'));
  return m ? m[1].trim() : null;
}
function textoVisivel(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#?\w+;/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

async function llmExtrai(texto, fonte) {
  const prompt = `Abaixo está o texto de uma página de receita (${fonte}). Extraia a receita em PORTUGUÊS DO BRASIL.
Se algum campo não existir, deixe vazio/null. NÃO invente. Responda SÓ JSON:
{"nome":"","ingredientes":["..."],"preparo":"passo 1\\npasso 2","tempo":"","porcoes":""}

TEXTO:
${texto.slice(0, 7000)}`;
  try {
    const r = await chatCompletion({ messages: [{ role: 'user', content: prompt }], model: config.openrouter.modelConsulta, responseFormat: { type: 'json_object' }, contexto: 'receita_importar' });
    const j = JSON.parse(r || '{}');
    return {
      nome: txt(j.nome) || null,
      ingredientes: Array.isArray(j.ingredientes) ? j.ingredientes.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 60) : [],
      preparo: txt(j.preparo) || null,
      tempo: txt(j.tempo) || null,
      porcoes: txt(j.porcoes) || null,
    };
  } catch (e) { console.error('[importar receita] LLM:', e.message); return null; }
}

export async function importarDeUrl(urlBruto) {
  let url;
  try { url = new URL(String(urlBruto).trim()); } catch { throw new Error('URL inválido'); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('URL inválido');
  const fonte = url.hostname.replace(/^www\./, '');
  const base = { url: url.href, fonte, nome: null, foto: null, ingredientes: [], preparo: null, tempo: null, porcoes: null, via: 'erro', bruto: null };

  let html = '';
  try {
    const r = await fetch(url.href, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(13000) });
    html = await r.text();
  } catch (e) {
    // sem acesso à página (geo/bot/login) → guarda só o link
    return { ...base, nome: fonte, bruto: `Não foi possível abrir a página (${e.message}).` };
  }

  // 1) JSON-LD Recipe
  const rec = lerJsonLd(html).find(ehReceita);
  if (rec && (Array.isArray(rec.recipeIngredient) || rec.recipeInstructions)) {
    const ing = (rec.recipeIngredient || rec.ingredients || []);
    const ps = passos(rec.recipeInstructions);
    return {
      ...base, via: 'jsonld',
      nome: txt(rec.name) || metaTag(html, 'og:title') || fonte,
      foto: primeiraImagem(rec.image) || metaTag(html, 'og:image'),
      ingredientes: (Array.isArray(ing) ? ing : [ing]).map(String).map((s) => s.trim()).filter(Boolean).slice(0, 60),
      preparo: ps.length ? ps.join('\n') : null,
      tempo: duracaoHumana(rec.totalTime) || duracaoHumana(rec.cookTime) || duracaoHumana(rec.prepTime),
      porcoes: rec.recipeYield ? String(Array.isArray(rec.recipeYield) ? rec.recipeYield[0] : rec.recipeYield).trim() : null,
    };
  }

  // 2) OpenGraph + 3) LLM sobre o texto
  const ogTitle = metaTag(html, 'og:title') || (html.match(/<title>([^<]+)<\/title>/i) || [])[1] || fonte;
  const ogImg = metaTag(html, 'og:image');
  const ogDesc = metaTag(html, 'og:description') || metaTag(html, 'description');
  const texto = textoVisivel(html);
  const llm = texto.length > 200 ? await llmExtrai(texto, fonte) : null;
  if (llm && (llm.ingredientes.length || llm.preparo)) {
    return { ...base, via: 'og+llm', nome: llm.nome || txt(ogTitle), foto: ogImg, ingredientes: llm.ingredientes, preparo: llm.preparo, tempo: llm.tempo, porcoes: llm.porcoes, bruto: ogDesc || null };
  }
  // só meta — guarda mesmo assim
  return { ...base, via: 'og', nome: txt(ogTitle) || fonte, foto: ogImg, bruto: ogDesc || null };
}

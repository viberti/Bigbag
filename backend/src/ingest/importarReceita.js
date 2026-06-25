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
  const re = /<script[^>]+type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
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

// lê <meta property|name=prop content=...> — tolerante a atributos SEM aspas (ex.: Panelinha)
function metaTag(html, prop) {
  const pe = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<meta\\b[^>]*?(?:property|name)\\s*=\\s*["']?${pe}["'\\s/>][^>]*>`, 'i');
  const m = html.match(re);
  if (!m) return null;
  const q = m[0].match(/content\s*=\s*(["'])([\s\S]*?)\1/i);   // content com aspas
  if (q) return q[2].trim();
  const u = m[0].match(/content\s*=\s*([^\s/>]+)/i);            // content sem aspas
  return u ? u[1].trim() : null;
}
function nomeDoSite(html, host) {
  let og = (metaTag(html, 'og:site_name') || metaTag(html, 'application-name') || '').trim();
  og = og.split(/\s[-–—|·]\s/)[0].trim(); // "Panelinha - Receitas que funcionam" → "Panelinha"
  if (og) return og.slice(0, 120);
  const base = String(host || '').replace(/^www\./, '').split('.')[0]; // panelinha.com.br → "Panelinha"
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : host;
}
function fotoPagina(html) {
  return metaTag(html, 'og:image') || metaTag(html, 'og:image:url') || metaTag(html, 'og:image:secure_url')
    || metaTag(html, 'twitter:image') || metaTag(html, 'twitter:image:src')
    || ((html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i) || [])[1] || null);
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

const ehYoutube = (host) => /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host);

// Transcrição/legendas do vídeo (quando existem): o URL da faixa está no JSON da página (captionTracks).
// Preferimos PT; senão a 1.ª disponível. Lê o timedtext, tira as tags e devolve o texto corrido.
async function transcricaoYoutube(html) {
  // extrai os URLs das faixas de legenda diretamente (o array tem objetos aninhados → não dá p/ JSON.parse);
  // baseUrl vem relativo e com & escapado → torna absoluto. Prefere PT.
  const urls = [...html.matchAll(/"baseUrl":"([^"]*timedtext[^"]*)"/g)]
    .map((x) => x[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/'));
  if (!urls.length) return null;
  let pick = urls.find((u) => /[?&](?:lang|tlang)=pt/i.test(u)) || urls[0];
  if (!/^https?:/i.test(pick)) pick = `https://www.youtube.com${pick.startsWith('/') ? '' : '/'}${pick}`;
  try {
    const xml = await fetch(pick, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) }).then((r) => r.text());
    const t = xml.replace(/<[^>]+>/g, ' ')
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
      .replace(/\s+/g, ' ').trim();
    return t.length > 120 ? t.slice(0, 8000) : null;
  } catch { return null; }
}

// YouTube: o watch page é JS + muro de consentimento (UE) → usar oEmbed (título+thumbnail) e ler a
// DESCRIÇÃO do vídeo (onde a receita costuma estar) saltando o consentimento com o cookie CONSENT.
async function importarYoutube(url) {
  let oe = null;
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url.href)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (r.ok) oe = await r.json();
  } catch { /* sem oembed */ }
  const base = { url: url.href, fonte: 'youtube.com', site_nome: 'YouTube', nome: oe?.title || 'Vídeo do YouTube', foto: oe?.thumbnail_url || null, ingredientes: [], preparo: null, tempo: null, porcoes: null, via: 'youtube', bruto: oe?.author_name ? `Vídeo de ${oe.author_name}` : null };
  let desc = null, transcricao = null;
  try {
    const r = await fetch(url.href, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Cookie: 'CONSENT=YES+1' }, signal: AbortSignal.timeout(12000) });
    const html = await r.text();
    const m = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
    if (m) { try { desc = JSON.parse(`"${m[1]}"`); } catch { desc = m[1]; } }
    transcricao = await transcricaoYoutube(html); // legendas (opção 1) — onde a receita falada está
  } catch { /* página indisponível — fica oembed */ }
  // junta descrição + transcrição e deixa o LLM montar a receita
  const material = [
    desc && desc.length > 40 ? `Descrição do vídeo:\n${desc}` : null,
    transcricao ? `Transcrição (legendas) do vídeo:\n${transcricao}` : null,
  ].filter(Boolean).join('\n\n');
  if (material.length > 120) {
    const llm = await llmExtrai(material, 'vídeo do YouTube');
    if (llm && (llm.ingredientes.length || llm.preparo)) {
      return { ...base, via: transcricao ? 'youtube+transcricao' : 'youtube+llm', ingredientes: llm.ingredientes, preparo: llm.preparo, tempo: llm.tempo, porcoes: llm.porcoes, bruto: (desc || transcricao || '').slice(0, 1500) };
    }
  }
  const fb = (desc && desc.length > 40) ? desc : (transcricao || base.bruto);
  return { ...base, bruto: fb ? String(fb).slice(0, 1500) : base.bruto };
}

export async function importarDeUrl(urlBruto) {
  let url;
  try { url = new URL(String(urlBruto).trim()); } catch { throw new Error('URL inválido'); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('URL inválido');
  if (ehYoutube(url.hostname)) return importarYoutube(url);

  // segue redirects (ex.: share.google, l.facebook, lnkd.in) e usa o URL FINAL para a fonte/link
  let html = '', finalUrl = url.href;
  try {
    const r = await fetch(url.href, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(13000) });
    finalUrl = r.url || url.href;
    html = await r.text();
  } catch (e) {
    const f = url.hostname.replace(/^www\./, '');
    return { url: url.href, fonte: f, site_nome: nomeDoSite('', url.hostname), nome: nomeDoSite('', url.hostname), foto: null, ingredientes: [], preparo: null, tempo: null, porcoes: null, via: 'erro', bruto: `Não foi possível abrir a página (${e.message}).` };
  }
  let real = url; try { real = new URL(finalUrl); } catch { /* fica o original */ }
  if (ehYoutube(real.hostname)) return importarYoutube(real); // redirect levou ao YouTube
  const fonte = real.hostname.replace(/^www\./, '');
  const fotoPag = fotoPagina(html);
  const base = { url: finalUrl, fonte, site_nome: nomeDoSite(html, real.hostname), nome: null, foto: null, ingredientes: [], preparo: null, tempo: null, porcoes: null, via: 'erro', bruto: null };

  // 1) JSON-LD Recipe
  const rec = lerJsonLd(html).find(ehReceita);
  if (rec && (Array.isArray(rec.recipeIngredient) || rec.recipeInstructions)) {
    const ing = (rec.recipeIngredient || rec.ingredients || []);
    const ps = passos(rec.recipeInstructions);
    let preparo = ps.length ? ps.join('\n') : null;
    // JSON-LD sem instruções (ex.: Panelinha só põe ingredientes) → tira o modo de preparo do texto via LLM
    if (!preparo) { const t = textoVisivel(html); if (t.length > 200) { const llm = await llmExtrai(t, fonte); if (llm?.preparo) preparo = llm.preparo; } }
    return {
      ...base, via: ps.length ? 'jsonld' : 'jsonld+llm',
      nome: txt(rec.name) || metaTag(html, 'og:title') || fonte,
      foto: primeiraImagem(rec.image) || fotoPag,
      ingredientes: (Array.isArray(ing) ? ing : [ing]).map(String).map((s) => s.trim()).filter(Boolean).slice(0, 60),
      preparo,
      tempo: duracaoHumana(rec.totalTime) || duracaoHumana(rec.cookTime) || duracaoHumana(rec.prepTime),
      porcoes: rec.recipeYield ? String(Array.isArray(rec.recipeYield) ? rec.recipeYield[0] : rec.recipeYield).trim() : null,
    };
  }

  // 2) OpenGraph + 3) LLM sobre o texto
  const ogTitle = metaTag(html, 'og:title') || (html.match(/<title>([^<]+)<\/title>/i) || [])[1] || fonte;
  const ogImg = fotoPag;
  const ogDesc = metaTag(html, 'og:description') || metaTag(html, 'description');
  const texto = textoVisivel(html);
  const llm = texto.length > 200 ? await llmExtrai(texto, fonte) : null;
  if (llm && (llm.ingredientes.length || llm.preparo)) {
    return { ...base, via: 'og+llm', nome: llm.nome || txt(ogTitle), foto: ogImg, ingredientes: llm.ingredientes, preparo: llm.preparo, tempo: llm.tempo, porcoes: llm.porcoes, bruto: ogDesc || null };
  }
  // só meta — guarda mesmo assim
  return { ...base, via: 'og', nome: txt(ogTitle) || fonte, foto: ogImg, bruto: ogDesc || null };
}

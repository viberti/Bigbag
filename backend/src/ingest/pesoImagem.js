// Ferramenta "PESO PELA IMAGEM" (desenho fechado com o dono, 2026-06-12).
// Problema: milhares de produtos de catálogo (sobretudo Continente/Pingo Doce)
// ficam sem peso ("1un") porque o peso não está no TÍTULO — mas está na FOTO da
// embalagem, e as fotos são públicas (CDN da loja / OFF), ao contrário das páginas
// (JS+anti-bot). Um VLM lê o peso da foto por ~$0,001, UMA vez, e cura a base.
//
// CASCATA de imagens: (1) imagem_url do catálogo → (2) foto do OFF (API pública,
// resolução full) → (3) busca de imagem Google CSE quando configurada (hoje 403)
// → (4) desiste e marca como tentado (fallback = foto manual do utilizador).
//
// Como trabalha (decisões do dono):
// - LAZY, em fundo: dispara da lista quando um item fica sem peso; não bloqueia
//   (o poll de 3s traz o peso na carga seguinte). Só paga o que a casa usa.
// - CIRÚRGICO: só o peso. Nome/marca não se tocam (vêm das fontes fiáveis).
// - TENTADO-UMA-VEZ: catalogo_produto.peso_img_em marca a tentativa (com ou sem
//   sucesso) → nunca repete o custo; produtos só-OFF usam um Set por processo.
// - PLAUSIBILIDADE: 5 g–15 kg / 5 ml–20 L; fora disso = leitura errada → rejeita
//   (o VLM pode ler "107" do "Tagliatelle No 107" como se fosse peso).
import { getPool } from '../db.js';
import { config } from '../config.js';
import { registrarCusto } from '../custo.js';

const _emVoo = new Set();     // EANs com job a correr (dedup de concorrência)
const _tentadosOff = new Set(); // EANs só-OFF tentados neste processo (sem linha de catálogo p/ marcar)

// versão que muda quando um peso novo é gravado — entra na assinatura do ETag da
// lista (senão o 304 esconderia o peso recém-curado para sempre).
let _versao = 0;
export const versaoPesoImg = () => _versao;

const PROMPT_PESO = (nome, marca) => `Estas fotos mostram a embalagem de um produto de supermercado${nome ? ` («${nome}»${marca ? `, marca «${marca}»` : ''})` : ''}.
Lê o PESO ou VOLUME LÍQUIDO impresso na embalagem (ex.: "500 g", "1 L", "330 ml", "4 x 125 g").
Regras: NÃO confundas com números de modelo/formato (ex.: "No 107", "39"), preços, nem percentagens. Se as fotos não mostrarem o peso de forma legível, ou se o produto na foto NÃO corresponder ao nome dado, devolve null. Não inventes.
Devolve SÓ JSON: {"quantidade": string|null}`;

// VLM focado no peso (prompt curto = mais barato que a extração completa).
async function lerPesoVlm(fotos, nome, marca) {
  const content = [
    { type: 'text', text: PROMPT_PESO(nome, marca) },
    ...fotos.map((f) => ({ type: 'image_url', image_url: { url: `data:${f.mime};base64,${f.base64}` } })),
  ];
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openrouter.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Bigbag' },
    body: JSON.stringify({ model: config.openrouter.modelExtracao, messages: [{ role: 'user', content }], response_format: { type: 'json_object' }, usage: { include: true } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  const data = await res.json();
  registrarCusto({ contexto: 'peso-imagem', modelo: data.model, usage: data.usage });
  try { return JSON.parse(data.choices?.[0]?.message?.content ?? '{}').quantidade || null; } catch { return null; }
}

// Plausibilidade: parseia "500 g"/"1.5 kg"/"4 x 125 g" e valida gamas.
// Devolve { texto, valorBase, unidadeBase } ou null (implausível/ilegível).
export function pesoPlausivel(q) {
  if (!q) return null;
  const s = String(q).trim().replace(/\s+/g, ' ').replace(',', '.');
  const mMulti = s.match(/^(\d+)\s*x\s*([\d.]+)\s*(kg|g|gr|mg|ml|cl|l)$/i);
  const mSimples = s.match(/^([\d.]+)\s*(kg|g|gr|mg|ml|cl|l)$/i);
  const m = mMulti || mSimples;
  if (!m) return null;
  const n = mMulti ? parseInt(mMulti[1], 10) : 1;
  const v = parseFloat(mMulti ? mMulti[2] : mSimples[1]);
  const u = (mMulti ? mMulti[3] : mSimples[2]).toLowerCase();
  if (!Number.isFinite(v) || v <= 0 || n <= 0 || n > 48) return null;
  const peso = ['kg', 'g', 'gr', 'mg'].includes(u);
  const base = peso
    ? (u === 'kg' ? v * 1000 : u === 'mg' ? v / 1000 : v) * n  // g
    : (u === 'l' ? v * 1000 : u === 'cl' ? v * 10 : v) * n;    // ml
  if (peso ? (base < 5 || base > 15000) : (base < 5 || base > 20000)) return null;
  return { texto: s, valorBase: base, unidadeBase: peso ? 'kg' : 'l' };
}

// fetch de uma imagem pública → { base64, mime } ou null (404/timeout/não-imagem).
async function buscarImagem(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !ct.startsWith('image/')) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 2000 || buf.length > 8_000_000) return null; // placeholder ou exagero
    return { base64: buf.toString('base64'), mime: ct };
  } catch { return null; }
}

// Degrau 2: foto do OFF (frente em resolução full; tamanho 400 não chega p/ ler o peso).
async function imagemOff(ean) {
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=image_front_url,image_url`,
      { headers: { 'User-Agent': 'Bigbag/0.1 (projeto pessoal)' }, signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const url = (j?.product?.image_front_url || j?.product?.image_url || '').replace(/\.(\d{3})\.jpg$/, '.full.jpg');
    return url ? buscarImagem(url) : null;
  } catch { return null; }
}

// Degrau 3: busca de imagem na web. Primeiro SerpApi (Google Images por
// procuração — adotado 2026-06-12 depois de o CSE ficar bloqueado pela conta
// revendedor IONOS: "project does not have access", imune a chave/billing/reativar;
// free 250 buscas/mês, chega porque isto é o ÚLTIMO degrau e corre 1x por EAN).
// O CSE fica como alternativa para se um dia o Google destravar.
async function imagemBuscaWeb(nome, marca) {
  const q = [nome, marca].filter(Boolean).join(' ');
  if (!q) return null;
  const SERP = process.env.SERPAPI_KEY;
  if (SERP) {
    try {
      const u = new URL('https://serpapi.com/search.json');
      u.searchParams.set('engine', 'google_images');
      u.searchParams.set('q', q);
      u.searchParams.set('gl', 'pt'); u.searchParams.set('hl', 'pt');
      u.searchParams.set('api_key', SERP);
      const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      for (const it of (j?.images_results || []).slice(0, 3)) {
        const img = it.original ? await buscarImagem(it.original) : null;
        if (img) return img; // o prompt VLM verifica a correspondência com o nome (anti-produto-errado)
      }
    } catch { /* cai para o CSE */ }
  }
  const KEY = process.env.GOOGLE_CSE_KEY, CX = process.env.GOOGLE_CSE_CX;
  if (!KEY || !CX) return null;
  try {
    const u = new URL('https://www.googleapis.com/customsearch/v1');
    u.searchParams.set('key', KEY); u.searchParams.set('cx', CX);
    u.searchParams.set('searchType', 'image'); u.searchParams.set('num', '2'); u.searchParams.set('gl', 'pt');
    u.searchParams.set('q', q);
    const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    if (j?.error) return null; // 403 etc. — salta o degrau em silêncio
    for (const it of j?.items || []) {
      const img = await buscarImagem(it.link);
      if (img) return img;
    }
    return null;
  } catch { return null; }
}

// Job principal (fire-and-forget a partir da lista). Idempotente e tentado-uma-vez.
export async function pesoPelaImagem(ean) {
  const cod = String(ean || '').replace(/\D/g, '');
  if (!cod || _emVoo.has(cod)) return;
  _emVoo.add(cod);
  try {
    const pool = getPool();
    // nome/marca p/ o prompt de verificação (anti imagem-de-outro-produto)
    const [[pe]] = await pool.query(
      'SELECT nome, marca, quantidade FROM produto_ean WHERE ean = ? ORDER BY id LIMIT 1', [cod]);
    if (pe?.quantidade) return; // já tem peso — nada a fazer
    // linhas de catálogo deste EAN: imagem candidata + marcador tentado-uma-vez
    const [cat] = await pool.query(
      'SELECT id, imagem_url, peso_img_em, formato FROM catalogo_produto WHERE ean = ?', [cod]);
    const jaTentado = cat.length ? cat.every((c) => c.peso_img_em != null) : _tentadosOff.has(cod);
    if (jaTentado) return;

    // FASE 1 — imagens locais (catálogo a 1000px + OFF full), juntas numa chamada
    // VLM. CDNs Demandware (Continente/Auchan) servem 280px por defeito → sw/sh=1000.
    const locais = [];
    for (const c of cat) {
      if (!c.imagem_url || locais.length >= 2) continue;
      const grande = c.imagem_url.replace(/sw=\d+/, 'sw=1000').replace(/sh=\d+/, 'sh=1000');
      const img = await buscarImagem(grande) || (grande !== c.imagem_url ? await buscarImagem(c.imagem_url) : null);
      if (img) locais.push(img);
    }
    const off = await imagemOff(cod);
    if (off && locais.length < 3) locais.push(off);

    let peso = null;
    if (locais.length) peso = pesoPlausivel(await lerPesoVlm(locais, pe?.nome, pe?.marca));

    // FASE 2 — a imagem local existe mas não mostra o peso (ou não há local) →
    // busca web (SerpApi/CSE) e 2.ª chamada VLM. A cascata NÃO pode parar na
    // primeira imagem que existe (bug original: a foto OFF do Concchiglioni
    // existia sem peso e a busca web nunca corria).
    if (!peso) {
      const web = await imagemBuscaWeb(pe?.nome, pe?.marca);
      if (web) peso = pesoPlausivel(await lerPesoVlm([web], pe?.nome, pe?.marca));
    }

    // marca a tentativa SEMPRE (sucesso ou não) — nunca repetir o custo
    if (cat.length) await pool.query('UPDATE catalogo_produto SET peso_img_em = NOW() WHERE ean = ?', [cod]);
    else _tentadosOff.add(cod);

    if (!peso) return; // sem peso legível — item fica como está; fallback: foto manual

    // grava CIRURGICAMENTE: ficha (a lista lê daqui) + catálogo (formato/ppb curados)
    await pool.query('UPDATE produto_ean SET quantidade = ? WHERE ean = ? AND (quantidade IS NULL OR quantidade = \'\')', [peso.texto.slice(0, 60), cod]);
    const fv = Math.round((peso.valorBase / 1000) * 1000) / 1000; // kg ou L
    for (const c of cat) {
      if (c.formato && !/^\d+ ?un$/i.test(c.formato)) continue; // já tinha formato real — não tocar
      await pool.query(
        `UPDATE catalogo_produto SET formato = ?, formato_valor = ?, unidade_base = ?,
                preco_por_base = IF(preco IS NOT NULL AND ? > 0, ROUND(preco / ?, 4), preco_por_base)
          WHERE id = ?`,
        [peso.texto.slice(0, 20), fv, peso.unidadeBase, fv, fv, c.id]);
    }
    _versao++; // invalida o ETag da lista → o poll seguinte mostra o peso
    console.log(`[peso-imagem] ${cod}: ${peso.texto}`);
  } catch (e) {
    console.error('[peso-imagem]', ean, e.message);
  } finally {
    _emVoo.delete(String(ean || '').replace(/\D/g, ''));
  }
}

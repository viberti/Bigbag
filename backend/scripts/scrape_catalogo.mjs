// Scraper de catálogo de retalhistas PT → tabela unificada `catalogo_produto`.
// Genérico, com um ADAPTADOR por fonte (enumeração via sitemap + extração da
// ficha). robots-compliant: usa só sitemaps de produto + páginas de produto
// (ambos permitidos no Auchan e no Continente); NUNCA a pesquisa (Disallow).
//
// Uso:
//   node scripts/scrape_catalogo.mjs <fonte> [limite]
//   AUCHAN_POOL=4 AUCHAN_DELAY=250 SO_NOVOS=1 node scripts/scrape_catalogo.mjs continente 30
import { gunzipSync } from 'node:zlib';
import { getPool } from '../src/db.js';
import { extrairFormato, precoPorBase } from '../src/normaliza/formato.js';
import { tituloProduto } from '../src/normaliza/titulo.js';

// NB: sem acentos — o Continente devolve HTTP 400 se o User-Agent tiver chars não-ASCII.
const UA = 'Mozilla/5.0 (compatible; BigbagBot/0.1; +catalogo pessoal)';
const FONTE = (process.argv[2] || '').toLowerCase();
const LIMITE = Number(process.argv[3] || process.env.LIMITE || 0);
const POOL = Number(process.env.POOL || 4);
const DELAY = Number(process.env.DELAY || 250);
const SO_NOVOS = process.env.SO_NOVOS !== '0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const locs = (xml) => [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
const prettify = (s) => String(s || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
const ENT = { amp: '&', quot: '"', apos: "'", nbsp: ' ', aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã',
  eacute: 'é', egrave: 'è', ecirc: 'ê', iacute: 'í', oacute: 'ó', ocirc: 'ô', otilde: 'õ', uacute: 'ú', ccedil: 'ç',
  Aacute: 'Á', Atilde: 'Ã', Acirc: 'Â', Eacute: 'É', Ecirc: 'Ê', Iacute: 'Í', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Uacute: 'Ú', Ccedil: 'Ç' };
const decode = (s) => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&([a-z]+);/gi, (m, n) => (n in ENT ? ENT[n] : ' '))
  .replace(/\s+/g, ' ').trim();

async function fetchText(url, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xml' }, signal: ctrl.signal });
      clearTimeout(t);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) {
      if (i === tentativas - 1) throw e;
      await sleep(600 * (i + 1));
    }
  }
}

// Lê um sitemap (descomprime se vier gzipado — alguns sites, ex. Lidl, servem .gz).
async function fetchSitemap(url, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(url, { headers: { 'User-Agent': UA } , signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      let buf = Buffer.from(await r.arrayBuffer());
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf); // magic gzip
      return buf.toString('utf8');
    } catch (e) {
      if (i === tentativas - 1) throw e;
      await sleep(600 * (i + 1));
    }
  }
}

function jsonLdProduct(html) {
  for (const b of [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1])) {
    let j; try { j = JSON.parse(b); } catch { continue; }
    for (const o of Array.isArray(j) ? j : [j]) {
      const tp = o && o['@type'];
      if (tp === 'Product' || (Array.isArray(tp) && tp.includes('Product'))) return o;
    }
  }
  return null;
}

// Junta nome+marca → formato → €/base. Comum a todas as fontes.
function comporFormatoPreco(o, nome, preco) {
  const fmt = extrairFormato(nome);
  const ppb = preco != null && fmt ? precoPorBase({ preco_liquido: preco, quantidade: 1 }, fmt) : null;
  return {
    formato: fmt ? `${fmt.formato_valor ?? ''}${fmt.unidade_base ?? ''}`.trim() || null : null,
    unidade_base: fmt?.unidade_base || null, formato_valor: fmt?.formato_valor ?? null, preco_por_base: ppb,
  };
}
const niveisToCat = (niveis) => ({
  categoria_path: niveis.length ? niveis.join('/') : null, categoria: niveis.length ? prettify(niveis[niveis.length - 1]) : null,
  cat_n1: niveis[0] || null, cat_n2: niveis[1] || null, cat_n3: niveis[2] || null, cat_n4: niveis[3] || null,
});

// NUTRIÇÃO + INGREDIENTES das páginas do AUCHAN (HTML estático, 2026-06-11):
// <span class="auc-pdp-nutritional-disclaimer">Valores Nutricionais por: 100 Gramas …</span>
// <div class="auc-pdp-nutritional-table"><table><tr><td>Energia</td><td>494.00</td><td>kcal</td>…
// Só aceita base "por: 100 …" (g/ml) — outra base (por porção) fica de fora para
// não poluir comparações por 100 g. Ingredientes vêm da secção própria, com os
// ALERGÉNIOS EM MAIÚSCULAS (rotulagem UE) — preservados tal e qual.
function extrairNutricaoAuchan(html) {
  const out = { nutricao: null, nutricao_base: null, ingredientes: null };
  const mIng = html.match(/Ingredientes\/Composi[^<]*<\/h3>\s*<ul[^>]*>\s*<li[^>]*>([\s\S]*?)<\/li>/i);
  if (mIng) out.ingredientes = decode(mIng[1].replace(/<[^>]+>/g, ' ')).slice(0, 3000) || null;
  const disc = html.match(/auc-pdp-nutritional-disclaimer[^>]*>\s*([^<]+)/i)?.[1];
  if (disc) out.nutricao_base = decode(disc).slice(0, 80) || null;
  if (out.nutricao_base && !/por:\s*100/i.test(out.nutricao_base)) return out; // base ≠ 100g/ml → não comparável
  const tab = html.match(/auc-pdp-nutritional-table[\s\S]*?<table>([\s\S]*?)<\/table>/i)?.[1];
  if (!tab) return out;
  const rows = [...tab.matchAll(/<tr><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]*)<\/td><\/tr>/gi)]
    .map((m) => ({ n: decode(m[1]).toLowerCase(), v: num(String(m[2]).trim()), u: decode(m[3]).toLowerCase() }));
  const val = (re, u) => rows.find((r) => re.test(r.n) && (!u || r.u === u) && r.v != null)?.v ?? null;
  const nut = {
    energia_kcal: val(/^energia/, 'kcal'),
    gordura: val(/^l[ií]pidos/),
    gordura_saturada: val(/saturados/),
    hidratos: val(/^hidratos/),
    acucares: val(/a[çc][úu]cares/),
    proteina: val(/^prote[ií]na/),
    sal: val(/^sal\b/),
    fibra: val(/^fibra/),
  };
  if (Object.values(nut).some((v) => v != null)) out.nutricao = nut;
  return out;
}

// NUTRIÇÃO + INGREDIENTES das páginas do PINGO DOCE (HTML estático, 2026-06-11):
// <table class="nutrition-table"> com section-header "Valores médios por 100 g de
// produto (não preparado)" e linhas <td>Energia (kcal)</td><td>205.0</td> — a
// unidade vem no NOME do nutriente. Só aceita base "por 100 g/ml". Ingredientes
// no texto "Ingredientes: …" (alergénios em MAIÚSCULAS, rotulagem UE).
function extrairNutricaoPD(html) {
  const out = { nutricao: null, nutricao_base: null, ingredientes: null };
  const mIng = html.match(/Ingredientes:\s*([^<]{10,})/);
  if (mIng) out.ingredientes = decode(`Ingredientes: ${mIng[1]}`).slice(0, 3000) || null;
  const mTab = html.match(/nutrition-table[\s\S]*?<\/table>/i);
  if (!mTab) return out;
  const bloco = mTab[0];
  const mBase = bloco.match(/section-header[^>]*>\s*([^<]+)/i);
  if (mBase) out.nutricao_base = decode(mBase[1]).slice(0, 80) || null;
  if (out.nutricao_base && !/por\s*100\s*(g|ml)/i.test(out.nutricao_base)) return out; // por porção → fora
  const rows = [...bloco.matchAll(/<tr>\s*<td>([^<]+)<\/td>\s*<td>([^<]*)<\/td>\s*<\/tr>/gi)]
    .map((m) => ({ n: decode(m[1]).toLowerCase(), v: num(String(m[2]).replace(',', '.').trim()) }));
  const val = (re) => rows.find((r) => re.test(r.n) && r.v != null)?.v ?? null;
  const nut = {
    energia_kcal: val(/^energia \(kcal\)/),
    gordura: val(/^l[ií]pidos/),
    gordura_saturada: val(/saturados/),
    hidratos: val(/^hidratos/),
    acucares: val(/a[çc][úu]cares/),
    proteina: val(/^prote[ií]na/),
    sal: val(/^sal\b/),
    fibra: val(/^fibra/),
  };
  if (Object.values(nut).some((v) => v != null)) out.nutricao = nut;
  return out;
}

const FONTES = {
  auchan: {
    sitemapIndex: 'https://www.auchan.pt/sitemap_index.xml',
    sitemapMatch: /-product\.xml/i,
    filtros: ['/alimentacao/', '/produtos-frescos/'],
    skuDoUrl: (u) => u.match(/\/(\d+)\.html?$/)?.[1] || null,
    extrair(url, html) {
      const p = jsonLdProduct(html); if (!p) return null;
      const nome = String(p.name || '').trim(); if (!nome) return null;
      const preco = num(Array.isArray(p.offers) ? p.offers[0]?.price : p.offers?.price);
      const niveis = new URL(url).pathname.split('/').filter(Boolean).slice(1, -2);
      return {
        ean: String(p.gtin13 || p.gtin || '').replace(/\D/g, '') || null,
        nome: nome.slice(0, 255), marca: ((typeof p.brand === 'object' ? p.brand?.name : p.brand) || null)?.toString().slice(0, 140) || null,
        ...niveisToCat(niveis),
        preco, moeda: (Array.isArray(p.offers) ? p.offers[0]?.priceCurrency : p.offers?.priceCurrency) || 'EUR',
        imagem_url: ((Array.isArray(p.image) ? p.image[0] : p.image) || null)?.toString().slice(0, 600) || null,
        ...comporFormatoPreco(p, nome, preco),
        ...extrairNutricaoAuchan(html),
      };
    },
  },
  continente: {
    sitemapIndex: 'https://www.continente.pt/sitemap_index.xml',
    sitemapMatch: /-product\.xml/i,
    filtros: [], // URLs são /produto/… (sem categoria no path) → apanha tudo
    skuDoUrl: (u) => u.match(/-(\d+)\.html?$/)?.[1] || null,
    extrair(url, html) {
      const p = jsonLdProduct(html); if (!p) return null;
      const nome = String(p.name || '').trim(); if (!nome) return null;
      const preco = num(Array.isArray(p.offers) ? p.offers[0]?.price : p.offers?.price);
      // EAN real: parâmetro &ean= numa URL embebida (o JSON-LD não traz gtin13).
      // No HTML o '&' vem como '&amp;' → o char antes de 'ean=' é ';'. Aceita ?, &, ;.
      const ean = (html.match(/[?&;]ean=(\d{8,14})/i)?.[1]) || null;
      // categoria: breadcrumb schema.org — nomes em <span itemprop="name">, tirando o "Página inicial".
      let niveis = [];
      const bi = html.search(/class="breadcrumbs"/);
      if (bi >= 0) {
        niveis = [...html.slice(bi, bi + 8000).matchAll(/itemprop="name"[^>]*>([^<]{1,80})<\/span>/gi)]
          .map((m) => decode(m[1])).filter(Boolean)
          .filter((t) => !/^(p[aá]gina inicial|in[ií]cio|home)$/i.test(t));
      }
      return {
        ean, nome: nome.slice(0, 255), marca: ((typeof p.brand === 'object' ? p.brand?.name : p.brand) || null)?.toString().slice(0, 140) || null,
        ...niveisToCat(niveis.map((n) => n.slice(0, 90))),
        preco, moeda: (Array.isArray(p.offers) ? p.offers[0]?.priceCurrency : p.offers?.priceCurrency) || 'EUR',
        imagem_url: ((Array.isArray(p.image) ? p.image[0] : p.image) || null)?.toString().slice(0, 600) || null,
        ...comporFormatoPreco(p, nome, preco),
      };
    },
  },
  // Lidl: catálogo online pequeno (~390) e SEM EAN. Útil só para dar nome/marca
  // oficiais aos itens de talões DO Lidl (melhora normalização e matching).
  lidl: {
    sitemapIndex: 'https://www.lidl.pt/static/sitemap.xml',
    sitemapMatch: /product_sitemap/i,
    filtros: [],
    skuDoUrl: (u) => u.match(/\/p(\d+)(?:$|[/?#])/)?.[1] || null,
    extrair(url, html) {
      const p = jsonLdProduct(html); if (!p) return null;
      const nome = String(p.name || '').trim(); if (!nome) return null;
      const preco = num(Array.isArray(p.offers) ? p.offers[0]?.price : p.offers?.price);
      let niveis = [];
      if (p.category) niveis = String(p.category).split(/[>/]/).map((s) => decode(s).trim()).filter(Boolean);
      return {
        ean: null, // o Lidl não publica EAN
        nome: nome.slice(0, 255), marca: ((typeof p.brand === 'object' ? p.brand?.name : p.brand) || null)?.toString().slice(0, 140) || null,
        ...niveisToCat(niveis.map((n) => n.slice(0, 90))),
        preco, moeda: (Array.isArray(p.offers) ? p.offers[0]?.priceCurrency : p.offers?.priceCurrency) || 'EUR',
        imagem_url: ((Array.isArray(p.image) ? p.image[0] : p.image) || null)?.toString().slice(0, 600) || null,
        ...comporFormatoPreco(p, nome, preco),
      };
    },
  },
  // Pingo Doce: SFCC (como Auchan/Continente), ~20k produtos, categoria no path
  // do URL, nome/marca no JSON-LD. SEM EAN (não o publica). Útil para nome+categoria
  // dos itens de talões DO Pingo Doce (cadeia grande). Aceita o nosso UA de bot.
  // BÓNUS (2026-06-11): o `description` do JSON-LD é a ABREVIATURA DE TALÃO oficial
  // ("IOG MAG PD NAT 125G") → guarda-se em `descricao_curta` (matching verbatim
  // talão↔catálogo) e dela extrai-se o TAMANHO que falta aos nomes do site.
  pingodoce: {
    sitemapIndex: 'https://www.pingodoce.pt/home/sitemap_index.xml',
    sitemapMatch: /-product\.xml/i,
    filtros: [],
    skuDoUrl: (u) => u.match(/-(\d+)\.html?$/)?.[1] || null,
    extrair(url, html) {
      const p = jsonLdProduct(html); if (!p) return null;
      const nome = String(p.name || '').trim(); if (!nome) return null;
      const preco = num(Array.isArray(p.offers) ? p.offers[0]?.price : p.offers?.price);
      const niveis = new URL(url).pathname.split('/').filter(Boolean).slice(2, -1); // tira 'home','produtos' e o slug do produto
      const desc = typeof p.description === 'string' ? decode(p.description).slice(0, 80) || null : null;
      // formato: o nome do site não tem tamanho (vira "1un" degenerado); a abreviatura
      // de talão tem ("125G", "6X1,5L") → prefere o formato dela quando é real.
      const fmtNome = comporFormatoPreco(p, nome, preco);
      const fmtDesc = desc ? comporFormatoPreco(p, desc, preco) : null;
      const degenerado = (f) => !f?.formato_valor || (f.formato_valor === 1 && f.unidade_base === 'un');
      const fmt = degenerado(fmtNome) && !degenerado(fmtDesc) ? fmtDesc : fmtNome;
      return {
        ean: null, // o Pingo Doce não publica EAN
        nome: nome.slice(0, 255), marca: ((typeof p.brand === 'object' ? p.brand?.name : p.brand) || null)?.toString().slice(0, 140) || null,
        descricao_curta: desc,
        ...niveisToCat(niveis.map((n) => n.slice(0, 90))),
        preco, moeda: (Array.isArray(p.offers) ? p.offers[0]?.priceCurrency : p.offers?.priceCurrency) || 'EUR',
        imagem_url: ((Array.isArray(p.image) ? p.image[0] : p.image) || null)?.toString().slice(0, 600) || null,
        ...fmt,
        ...extrairNutricaoPD(html),
      };
    },
  },
};

async function upsert(pool, fonte, sku, url, f) {
  await pool.query(
    `INSERT INTO catalogo_produto
       (fonte, sku_fonte, ean, nome, marca, descricao_curta, categoria_path, categoria, cat_n1, cat_n2, cat_n3, cat_n4,
        formato, unidade_base, formato_valor, preco, moeda, preco_por_base, nutricao, nutricao_base, ingredientes, url, imagem_url, scraped_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, NOW())
     ON DUPLICATE KEY UPDATE ean=VALUES(ean), nome=VALUES(nome), marca=VALUES(marca),
       descricao_curta=COALESCE(VALUES(descricao_curta), descricao_curta), categoria_path=VALUES(categoria_path),
       categoria=VALUES(categoria), cat_n1=VALUES(cat_n1), cat_n2=VALUES(cat_n2), cat_n3=VALUES(cat_n3), cat_n4=VALUES(cat_n4),
       formato=VALUES(formato), unidade_base=VALUES(unidade_base), formato_valor=VALUES(formato_valor), preco=VALUES(preco),
       moeda=VALUES(moeda), preco_por_base=VALUES(preco_por_base),
       nutricao=COALESCE(VALUES(nutricao), nutricao), nutricao_base=COALESCE(VALUES(nutricao_base), nutricao_base),
       ingredientes=COALESCE(VALUES(ingredientes), ingredientes), url=VALUES(url), imagem_url=VALUES(imagem_url), scraped_at=NOW()`,
    [fonte, sku, f.ean, tituloProduto(f.nome), tituloProduto(f.marca), f.descricao_curta || null, f.categoria_path, f.categoria, f.cat_n1, f.cat_n2, f.cat_n3, f.cat_n4,
      f.formato, f.unidade_base, f.formato_valor, f.preco, f.moeda, f.preco_por_base,
      f.nutricao ? JSON.stringify(f.nutricao) : null, f.nutricao_base || null, f.ingredientes || null, url, f.imagem_url],
  );
}

async function main() {
  const cfg = FONTES[FONTE];
  if (!cfg) { console.error(`fonte inválida. usa: ${Object.keys(FONTES).join(' | ')}`); process.exit(1); }
  const pool = getPool();
  console.log(`[${FONTE}] a ler sitemaps…`);
  const idx = await fetchSitemap(cfg.sitemapIndex);
  const sms = locs(idx).filter((u) => cfg.sitemapMatch.test(u));
  let urls = [];
  for (const sm of sms) urls.push(...locs(await fetchSitemap(sm)));
  const total = urls.length;
  if (cfg.filtros.length) urls = urls.filter((u) => cfg.filtros.some((f) => u.includes(f)));
  console.log(`[${FONTE}] sitemaps produto: ${sms.length} | URLs: ${total} (após filtro: ${urls.length})`);

  if (SO_NOVOS) {
    const [ex] = await pool.query('SELECT sku_fonte FROM catalogo_produto WHERE fonte=?', [FONTE]);
    const has = new Set(ex.map((r) => String(r.sku_fonte)));
    const antes = urls.length;
    urls = urls.filter((u) => { const s = cfg.skuDoUrl(u); return !(s && has.has(s)); });
    if (antes !== urls.length) console.log(`[${FONTE}] resumível: ${antes - urls.length} já feitos, restam ${urls.length}.`);
  }
  if (LIMITE > 0) urls = urls.slice(0, LIMITE);
  console.log(`[${FONTE}] a processar ${urls.length} (pool=${POOL}, delay=${DELAY}ms)…\n`);

  let ok = 0, semFicha = 0, semEan = 0, erro = 0, feitos = 0, errosSeguidos = 0;
  async function worker(lista) {
    for (const url of lista) {
      // CIRCUIT-BREAKER: 25 erros SEGUIDOS = anti-bot ativo (Continente devolve
      // 471/474 ao IP) → aborta em vez de insistir e endurecer o bloqueio.
      if (errosSeguidos >= 25) { console.error(`[${FONTE}] ${errosSeguidos} erros seguidos — bloqueio ativo, a abortar.`); break; }
      try {
        const html = await fetchText(url);
        const sku = cfg.skuDoUrl(url);
        if (!html || !sku) { semFicha++; }
        else {
          const f = cfg.extrair(url, html);
          if (!f) { semFicha++; }
          else { await upsert(pool, FONTE, sku, url, f); ok++; if (!f.ean) semEan++; }
        }
        errosSeguidos = 0;
      } catch (e) { erro++; errosSeguidos++; if (erro <= 5) console.error('  erro:', url.split('/').pop(), e.message); }
      feitos++;
      if (feitos % 25 === 0) console.log(`  …${feitos}/${urls.length} (ok ${ok}, s/ean ${semEan}, s/ficha ${semFicha}, erro ${erro})`);
      await sleep(DELAY);
    }
  }
  const baldes = Array.from({ length: POOL }, () => []);
  urls.forEach((u, i) => baldes[i % POOL].push(u));
  await Promise.all(baldes.map(worker));

  console.log(`\n✅ [${FONTE}] ${ok} guardados (${semEan} sem EAN), ${semFicha} sem ficha, ${erro} erros.`);
  const [[c]] = await pool.query('SELECT COUNT(*) n, COUNT(ean) com_ean FROM catalogo_produto WHERE fonte=?', [FONTE]);
  console.log(`[${FONTE}] no catálogo: ${c.n} (${c.com_ean} com EAN).`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });

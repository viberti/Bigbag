// Nutrição + ingredientes das fichas do CONTINENTE. Ao contrário do Auchan/Pingo
// Doce (HTML estático), o Continente NÃO traz a tabela na página — carrega-a num
// separador via AJAX (SFCC remote-include `Product-ProductNutritionalInfoTab`).
// O `data-url` desse separador está embebido na página (com pid+ean+supplierid),
// por isso o scraper lê a página, tira o data-url e faz um 2.º fetch a ESTE
// fragmento. Módulo PURO (sem fetch, sem db) — testável; quem chama trata do I/O.
//
// Estrutura do fragmento (2026-06-14):
//   <div class="ingredients"><p>Declaração de Ingredientes:</p><p>TEXTO…</p></div>
//   <div class="nutrients-row"><div class="nutrients-cell">energia</div>
//     <div class="nutrients-cell">1132,0</div><div class="nutrients-cell">(KJO) Quilojoule</div></div>
//   (energia aparece 2×: KJ e kcal; valores em vírgula decimal PT)

const ENT = { amp: '&', quot: '"', apos: "'", nbsp: ' ', aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã',
  eacute: 'é', egrave: 'è', ecirc: 'ê', iacute: 'í', oacute: 'ó', ocirc: 'ô', otilde: 'õ', uacute: 'ú', ccedil: 'ç',
  Aacute: 'Á', Atilde: 'Ã', Acirc: 'Â', Eacute: 'É', Ecirc: 'Ê', Iacute: 'Í', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Uacute: 'Ú', Ccedil: 'Ç' };
const decode = (s) => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&([a-z]+);/gi, (m, n) => (n in ENT ? ENT[n] : ' '))
  .replace(/\s+/g, ' ').trim();
// nº PT: vírgula decimal; pontos são milhares (os valores observados não usam ponto
// como decimal). "1.234,5"→1234.5 · "0,05"→0.05 · "808"→808.
const numPt = (v) => { const n = Number(String(v).trim().replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

// Extrai (e desofusca os &amp;) o URL do separador nutricional embebido na PÁGINA.
// Devolve null se a página não tiver o separador (produto sem ficha nutricional).
export function urlTabNutricional(pageHtml) {
  const u = String(pageHtml || '').match(/data-url="([^"]*ProductNutritionalInfoTab[^"]*)"/i)?.[1];
  return u ? u.replace(/&amp;/g, '&') : null;
}

// Parseia o FRAGMENTO do separador → { nutricao, nutricao_base, ingredientes }.
// Best-effort: devolve só o que existir (produtos sem tabela ficam a null).
export function extrairNutricaoContinente(frag) {
  const out = { nutricao: null, nutricao_base: null, ingredientes: null };
  const s = String(frag || '');
  if (!s) return out;

  // ingredientes: 2.º <p> do bloco .ingredients (o 1.º é o rótulo "Declaração de…")
  const ing = s.match(/<div class="ingredients">([\s\S]*?)<\/div>/i)?.[1];
  if (ing) {
    const ps = [...ing.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => decode(m[1].replace(/<[^>]+>/g, ' ')));
    const txt = ps.filter((t) => t && !/^(declara|lista de ingred|ingredientes:?$)/i.test(t)).join(' ').trim();
    if (txt && txt.length > 4) out.ingredientes = (/^ingredientes/i.test(txt) ? txt : `Ingredientes: ${txt}`).slice(0, 3000);
  }

  // nutrientes: cada .nutrients-row tem 3 .nutrients-cell = [nome, valor, unidade]
  const rows = s.split(/nutrients-row/i).slice(1).map((seg) => {
    const cells = [...seg.matchAll(/nutrients-cell[^>]*>([^<]*)</gi)].slice(0, 3).map((m) => decode(m[1]).toLowerCase());
    return cells;
  }).filter((c) => c[0] && c.length >= 2);
  const find = (reNome, reUni) => {
    const r = rows.find((c) => reNome.test(c[0]) && (!reUni || reUni.test(c[2] || '')) && numPt(c[1]) != null);
    return r ? numPt(r[1]) : null;
  };
  const nut = {
    energia_kcal: find(/energia/, /caloria|kcal|e14/),  // energia em kcal (não kJ)
    gordura: find(/^l[ií]pidos$/),
    gordura_saturada: find(/saturad/),
    hidratos: find(/^hidratos de carbono$/),
    acucares: find(/a[çc][uú]cares/),
    proteina: find(/prote[íi]na/),
    sal: find(/^sal$/),
    fibra: find(/fibra/),
  };
  if (Object.values(nut).some((v) => v != null)) {
    out.nutricao = nut;
    out.nutricao_base = /\(mlt\)|mililitro/i.test(s) ? 'por 100 ml' : 'por 100 g';
  }
  return out;
}

// ── LIVE (faz I/O: fetch ao Continente + guarda na BD) ──────────────────────
// Para um EAN: se for vendido no Continente e ainda não tivermos a tabela
// nutricional, busca-a AO VIVO (página → separador AJAX → parser acima) e guarda
// em catalogo_produto. Devolve { nutricao, nutricao_base, ingredientes } ou null
// (não é Continente, ou sem tabela). Usado on-demand quando um scan não tem nutrição.
const UA_LIVE = 'Mozilla/5.0 (compatible; BigbagBot/0.1; +catalogo pessoal)';
async function fetchTextLive(url, ms = 12000) {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
    const r = await fetch(url, { headers: { 'User-Agent': UA_LIVE }, signal: ctrl.signal });
    clearTimeout(t);
    return r.ok ? await r.text() : null;
  } catch { return null; }
}
export async function nutricaoContinenteLive(pool, ean) {
  const e = String(ean || '').replace(/\D/g, '');
  if (!e) return null;
  const [[row]] = await pool.query(
    `SELECT id, url, nutricao FROM catalogo_produto
      WHERE ean = ? AND fonte = 'continente' AND url IS NOT NULL AND url <> '' ORDER BY id LIMIT 1`, [e]);
  if (!row) return null; // não é vendido no Continente
  if (row.nutricao && row.nutricao !== '{}') { try { return { nutricao: JSON.parse(row.nutricao) }; } catch { /* segue p/ buscar */ } }
  const page = await fetchTextLive(row.url); if (!page) return null;
  const ep = urlTabNutricional(page); if (!ep) return null;
  const frag = await fetchTextLive(ep); if (!frag) return null;
  const r = extrairNutricaoContinente(frag);
  if (r.nutricao || r.ingredientes) {
    await pool.query(
      `UPDATE catalogo_produto SET nutricao = COALESCE(?, nutricao), nutricao_base = COALESCE(?, nutricao_base), ingredientes = COALESCE(?, ingredientes) WHERE id = ?`,
      [r.nutricao ? JSON.stringify(r.nutricao) : null, r.nutricao_base || null, r.ingredientes || null, row.id]);
  }
  return r.nutricao ? r : null;
}

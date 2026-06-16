// RESOLUÇÃO POR NOME (2026-06-15): um EAN desconhecido foi fotografado e o VLM leu
// um nome+marca. Procura o MESMO produto no off_full (FULLTEXT nome+marca) — pode
// estar sob OUTRO EAN — e devolve candidatos com nutrição/imagem. A MARCA é o gate
// forte (exige-se a marca no match); o tamanho desempata. Cruza-se depois com o
// match-por-imagem (matchImagem.js) para validar. NUNCA é facto do EAN exato: o
// chamador marca como "mesmo produto (por nome)" e pede confirmação se incerto.
import { normAlfa } from './categoria.js';
import { matchImagemB64 } from './matchImagem.js';
import { parseJsonCol } from '../db.js';

const nutDe = (r) => ({
  energia_kcal: r.energia_kcal, gordura: r.gordura, gordura_saturada: r.gordura_sat, hidratos: r.hidratos,
  acucares: r.acucares, proteina: r.proteinas, sal: r.sal, fibra: r.fibra,
});
const temNut = (n) => n && Object.values(n).some((v) => v != null);

// tamanho aproximado igual? ("250 g" ~ "250g" ~ "0,25 kg"). Heurística leve por número.
const numTam = (s) => { const m = String(s || '').replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|cl)?/i); if (!m) return null; let v = parseFloat(m[1]); const u = (m[2] || '').toLowerCase(); if (u === 'kg' || u === 'l') v *= 1000; return v; };

export async function acharPorNomeMarca(pool, { nome, marca, tamanho, termos } = {}) {
  if (!nome && !(termos && termos.length)) return [];
  const marcaTok = marca ? normAlfa(marca).split(' ').filter((t) => t.length >= 3) : [];
  // tokens de busca: PREFERE os `termos` do VLM (já discriminativos, sem ruído de embalagem —
  // ex.: "achocolatado" em vez de "fortificante"); senão deriva-os do nome (heurística).
  const fonteTok = (termos && termos.length) ? termos.join(' ') : nome;
  const nomeTok = normAlfa(fonteTok || '').split(' ').filter((t) => t.length >= 3 && !marcaTok.includes(t) && !/^\d+(g|kg|ml|cl|l|un)?$/i.test(t));
  // RECALL > precisão (dono 2026-06-16: o texto é a espinha — o OFF de 4,5M nunca terá as
  // fotos todas vetorizadas). A MARCA é o gate FORTE (obrigatória, casa em nome OU marca);
  // os tokens do NOME são OPCIONAIS — pontuam (rel) mas NÃO filtram. Assim "Fortificante
  // Ovomaltine 400g" acha o off_full que se chama só "Ovomaltine" (o `+fortificante` exigido
  // matava-o). Sem marca, o nome volta a ser o único gate. O tamanho/nutrição desempatam.
  let bool;
  if (marcaTok.length) bool = [...marcaTok.map((t) => `+${t}`), ...nomeTok.map((t) => `${t}*`)].join(' ');
  else if (nomeTok.length) bool = nomeTok.map((t) => `+${t}*`).join(' ');
  else return [];
  const tAlvo = numTam(tamanho);
  const tamBateDe = (q) => { const t = numTam(q); return tAlvo && t ? Math.abs(tAlvo - t) / tAlvo < 0.1 : null; };
  const map = new Map(); // ean → candidato (DEDUP/MERGE entre as fontes)
  const juntar = (c) => {
    const ex = map.get(c.ean);
    if (!ex) { map.set(c.ean, c); return; }
    ex.nome = ex.nome || c.nome; ex.marca = ex.marca || c.marca; ex.tamanho = ex.tamanho || c.tamanho;
    ex.imagem_url = ex.imagem_url || c.imagem_url;
    if (!ex.tem_nutricao && c.tem_nutricao) { ex.nutricao_100g = c.nutricao_100g; ex.tem_nutricao = true; }
    if (ex.tamanho_bate == null) ex.tamanho_bate = c.tamanho_bate;
    ex.rel = Math.max(ex.rel || 0, c.rel || 0);
    ex.fonte = ex.fonte === c.fonte ? ex.fonte : 'ambos';
  };
  // 1) OFF (off_full) — pan-país; nutrição em colunas planas
  try {
    const [r1] = await pool.query(
      `SELECT ean, nome, marca, quantidade, imagem_url, energia_kcal, gordura, gordura_sat, hidratos, acucares, proteinas, sal, fibra,
              MATCH(nome, marca) AGAINST(? IN BOOLEAN MODE) AS rel
         FROM off_full WHERE MATCH(nome, marca) AGAINST(? IN BOOLEAN MODE)
        ORDER BY (energia_kcal IS NOT NULL) DESC, rel DESC LIMIT 12`, [bool, bool]);
    for (const r of r1) { const nut = nutDe(r); juntar({ ean: String(r.ean), nome: r.nome, marca: r.marca, tamanho: r.quantidade || null, imagem_url: r.imagem_url || null, nutricao_100g: temNut(nut) ? nut : null, tem_nutricao: temNut(nut), tamanho_bate: tamBateDe(r.quantidade), rel: r.rel, fonte: 'off' }); }
  } catch { /* índice/erro */ }
  // 2) AS NOSSAS FONTES (catalogo_produto) — TODAS as lojas e PAÍSES; nutrição em JSON
  try {
    const [r2] = await pool.query(
      `SELECT ean, COALESCE(nome_pt, nome) AS nome, marca, formato AS quantidade, imagem_url, nutricao,
              MATCH(nome, marca) AGAINST(? IN BOOLEAN MODE) AS rel
         FROM catalogo_produto WHERE MATCH(nome, marca) AGAINST(? IN BOOLEAN MODE)
        ORDER BY rel DESC LIMIT 30`, [bool, bool]);
    for (const r of r2) { const nut = parseJsonCol(r.nutricao); const tn = temNut(nut); juntar({ ean: String(r.ean), nome: r.nome, marca: r.marca, tamanho: r.quantidade || null, imagem_url: r.imagem_url || null, nutricao_100g: tn ? nut : null, tem_nutricao: tn, tamanho_bate: tamBateDe(r.quantidade), rel: r.rel, fonte: 'catalogo' }); }
  } catch { /* FULLTEXT ainda a construir (migração 064) */ }
  return [...map.values()].sort((a, b) => (b.tamanho_bate === true) - (a.tamanho_bate === true) || (b.tem_nutricao - a.tem_nutricao) || (b.rel || 0) - (a.rel || 0));
}

// GÉMEO sob OUTRO EAN por CONVERGÊNCIA de dois sinais independentes: a FOTO (CLIP) e o
// NOME+marca do VLM. Um EAN que aparece nos DOIS é quase certo (a imagem e o texto não se
// enganam ao mesmo tempo). Devolve o melhor candidato (ou null) — NUNCA é facto: o
// chamador mostra e pede CONFIRMAÇÃO ao humano (a foto/o texto acham; o humano confirma).
export async function acharGemeo(pool, { fotoB64, nome, marca, tamanho, termos, eanProprio } = {}) {
  const proprio = String(eanProprio || '');
  const txt = (nome || (termos && termos.length)) ? await acharPorNomeMarca(pool, { nome, marca, tamanho, termos }) : [];
  let img = [];
  if (fotoB64) { try { img = await matchImagemB64(fotoB64, { k: 8, limiar: 0.72 }); } catch { img = []; } }
  if (!txt.length && !img.length) return null;
  const map = new Map(); // ean → { ean, detalhe, scoreImg, viaImg, viaTxt }
  for (const c of txt) { const e = String(c.ean); if (e === proprio) continue; map.set(e, { ean: e, detalhe: c, scoreImg: 0, viaImg: false, viaTxt: true }); }
  for (const c of img) { const e = String(c.ean); if (e === proprio) continue; const ex = map.get(e); if (ex) { ex.scoreImg = c.score; ex.viaImg = true; } else map.set(e, { ean: e, detalhe: null, scoreImg: c.score, viaImg: true, viaTxt: false }); }
  if (!map.size) return null;
  // pontuação: NOS DOIS domina; senão imagem-forte; depois nome-com-nutrição / tamanho.
  const pont = (x) => (x.viaImg && x.viaTxt ? 1000 : 0) + x.scoreImg * 100 + (x.detalhe?.tem_nutricao ? 20 : 0) + (x.detalhe?.tamanho_bate === true ? 10 : 0);
  const top = [...map.values()].sort((a, b) => pont(b) - pont(a))[0];
  let d = top.detalhe;
  if (!d) { // candidato só-imagem → vai buscar os detalhes ao off_full
    const [[r]] = await pool.query(
      `SELECT ean, nome, marca, quantidade, imagem_url, energia_kcal, gordura, gordura_sat, hidratos, acucares, proteinas, sal, fibra
         FROM off_full WHERE ean = ? LIMIT 1`, [top.ean]);
    d = r ? { ean: r.ean, nome: r.nome, marca: r.marca, tamanho: r.quantidade, imagem_url: r.imagem_url, nutricao_100g: nutDe(r), tem_nutricao: temNut(nutDe(r)) } : { ean: top.ean };
  }
  return {
    ean: top.ean, nome: d.nome || null, marca: d.marca || null, tamanho: d.tamanho || null,
    imagem_url: d.imagem_url || null, nutricao_100g: d.tem_nutricao ? d.nutricao_100g : null,
    via: top.viaImg && top.viaTxt ? 'ambos' : (top.viaImg ? 'imagem' : 'nome'),
    score_imagem: top.scoreImg || null,
  };
}

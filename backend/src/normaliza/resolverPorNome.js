// RESOLUÇÃO POR NOME (2026-06-15): um EAN desconhecido foi fotografado e o VLM leu
// um nome+marca. Procura o MESMO produto no off_full (FULLTEXT nome+marca) — pode
// estar sob OUTRO EAN — e devolve candidatos com nutrição/imagem. A MARCA é o gate
// forte (exige-se a marca no match); o tamanho desempata. Cruza-se depois com o
// match-por-imagem (matchImagem.js) para validar. NUNCA é facto do EAN exato: o
// chamador marca como "mesmo produto (por nome)" e pede confirmação se incerto.
import { normAlfa } from './categoria.js';

const nutDe = (r) => ({
  energia_kcal: r.energia_kcal, gordura: r.gordura, gordura_saturada: r.gordura_sat, hidratos: r.hidratos,
  acucares: r.acucares, proteina: r.proteinas, sal: r.sal, fibra: r.fibra,
});
const temNut = (n) => n && Object.values(n).some((v) => v != null);

// tamanho aproximado igual? ("250 g" ~ "250g" ~ "0,25 kg"). Heurística leve por número.
const numTam = (s) => { const m = String(s || '').replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|cl)?/i); if (!m) return null; let v = parseFloat(m[1]); const u = (m[2] || '').toLowerCase(); if (u === 'kg' || u === 'l') v *= 1000; return v; };

export async function acharPorNomeMarca(pool, { nome, marca, tamanho } = {}) {
  if (!nome) return [];
  const marcaTok = marca ? normAlfa(marca).split(' ').filter((t) => t.length >= 3) : [];
  const nomeTok = normAlfa(nome).split(' ').filter((t) => t.length >= 3 && !marcaTok.includes(t) && !/^\d+(g|kg|ml|cl|l|un)?$/i.test(t));
  if (!nomeTok.length) return [];
  // nome em prefixo (o VLM pode ler formas/acentos diferentes) + MARCA exigida (gate forte)
  const bool = [...nomeTok.map((t) => `+${t}*`), ...marcaTok.map((t) => `+${t}`)].join(' ');
  let rows;
  try {
    [rows] = await pool.query(
      `SELECT ean, nome, marca, quantidade, imagem_url,
              energia_kcal, gordura, gordura_sat, hidratos, acucares, proteinas, sal, fibra,
              MATCH(nome, marca) AGAINST(? IN BOOLEAN MODE) AS rel
         FROM off_full
        WHERE MATCH(nome, marca) AGAINST(? IN BOOLEAN MODE)
        ORDER BY (energia_kcal IS NOT NULL) DESC, rel DESC
        LIMIT 10`, [bool, bool]);
  } catch { return []; } // índice ainda a construir / erro → sem candidatos
  const tAlvo = numTam(tamanho);
  return rows.map((r) => {
    const nut = nutDe(r);
    const tCand = numTam(r.quantidade);
    const tamBate = tAlvo && tCand ? Math.abs(tAlvo - tCand) / tAlvo < 0.1 : null; // ±10%
    return {
      ean: r.ean, nome: r.nome, marca: r.marca, tamanho: r.quantidade || null,
      imagem_url: r.imagem_url || null, nutricao_100g: temNut(nut) ? nut : null,
      tem_nutricao: temNut(nut), tamanho_bate: tamBate, rel: r.rel,
    };
  }).sort((a, b) => (b.tamanho_bate === true) - (a.tamanho_bate === true) || (b.tem_nutricao - a.tem_nutricao) || b.rel - a.rel);
}

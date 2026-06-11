// Enriquece (Open Food Facts) os produtos cujo EAN veio na LINHA do talão
// (Makro, e agora também os talões digitais do Lidl Plus), guardando os dados
// como produto_ean autónomo (item_id NULL) → a ficha fica cheia, sem foto.
// Partilhado pela rota de faturas e pelo importador do Lidl Plus.
import { consultarOFF, consultarCatalogo } from './produto.js';
import { tituloProduto } from '../normaliza/titulo.js';
import { garantirFichaPT } from './traduz.js';
import { atualizarConteudoFicha } from '../normaliza/conteudo.js';
import { grupoDe, grupoDeNome } from '../normaliza/categoria.js';

// Trunca ao tamanho da coluna: o OFF devolve a hierarquia COMPLETA de categorias
// (>120 chars) e um "Data too long for column 'categoria'" abortava este INSERT,
// deixando o EAN do talão SEM ficha (o kefir Milbona do Lidl era exatamente isto).
const lim = (s, n) => (s == null ? null : String(s).slice(0, n));

// ── VALIDAÇÃO CRUZADA EAN×NOME (anti "EAN válido-mas-errado") ────────────────
// O VLM pode trocar um dígito e produzir OUTRO EAN real (passa no dígito
// verificador): o "Patê de Alho e Salsa" ganhou ficha OFF de PÃO por isto.
// Antes de gravar a ficha, compara o GRUPO da fonte (food_groups do OFF, ou
// nome/categoria do catálogo) com o grupo do NOME DO TALÃO: conflito forte entre
// grupos disjuntos = EAN suspeito → NÃO grava (log para diagnóstico).
// Pares ADJACENTES não contam como conflito (ambiguidade legítima das fontes):
// atum em lata é peixe|mercearia(conservas); kefir é lacticinios|bebidas;
// sobremesa láctea é lacticinios|doces; bolacha é doces|padaria; congelados
// cruza com tudo (estado físico, não tipo).
const ADJACENTES = new Set([
  'bebidas|lacticinios', 'doces|lacticinios', 'doces|padaria', 'doces|frutas',
  'frutas|mercearia', 'carne|mercearia', 'peixe|mercearia', 'mercearia|padaria',
  'bebidas|mercearia',
]);
const parKey = (a, b) => [a, b].sort().join('|');
export function eanSuspeito(descricaoTalao, { foodGroups = null, nomeCand = null, categoriaCand = null } = {}) {
  const gTalao = grupoDeNome(descricaoTalao);
  if (!gTalao || gTalao === 'outros') return false; // sem veredicto do talão → não bloqueia
  const gFonte = grupoDe({ foodGroups, nome: nomeCand, categoria: categoriaCand });
  if (!gFonte || gFonte === 'outros') return false;
  if (gFonte === gTalao) return false;
  if (gFonte === 'congelados' || gTalao === 'congelados') return false;
  return !ADJACENTES.has(parKey(gFonte, gTalao));
}

export async function enriquecerEansFatura(pool, faturaId) {
  const [eans] = await pool.query(
    'SELECT ean, MAX(descricao_original) AS descricao FROM item WHERE fatura_id = ? AND ean IS NOT NULL GROUP BY ean', [faturaId]);
  for (const { ean, descricao } of eans) {
    try {
      const [[ja]] = await pool.query('SELECT id FROM produto_ean WHERE ean = ? AND off_json IS NOT NULL LIMIT 1', [ean]);
      if (ja) continue;
      const off = await consultarOFF(ean);
      if (!off) {
        // OFF não tem (marca própria, ex.: kefir Lidl) → CATÁLOGO local; desde a
        // 047 pode trazer nutrição oficial de loja (Auchan) → a ficha nasce cheia.
        const cat = await consultarCatalogo(ean);
        if (!cat) continue;
        if (eanSuspeito(descricao, { nomeCand: cat.nome, categoriaCand: cat.categoria })) {
          console.warn(`[enriquecer ean] SUSPEITO (catálogo≠talão): ${ean} talão="${descricao}" candidato="${cat.nome}" — não gravado`);
          continue;
        }
        await pool.query(
          `INSERT INTO produto_ean (ean, item_id, fonte, nome, marca, quantidade, categoria, ingredientes, nutricao, nutricao_confirmada)
             VALUES (?,NULL,'catalogo',?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE nome=COALESCE(produto_ean.nome, VALUES(nome)), marca=COALESCE(produto_ean.marca, VALUES(marca)),
             quantidade=COALESCE(produto_ean.quantidade, VALUES(quantidade)), categoria=COALESCE(produto_ean.categoria, VALUES(categoria)),
             ingredientes=COALESCE(produto_ean.ingredientes, VALUES(ingredientes)), nutricao=COALESCE(produto_ean.nutricao, VALUES(nutricao)),
             nutricao_confirmada=GREATEST(produto_ean.nutricao_confirmada, VALUES(nutricao_confirmada))`,
          [ean, lim(tituloProduto(cat.nome), 200), lim(tituloProduto(cat.marca), 120), lim(cat.quantidade, 60), lim(cat.categoria, 255),
            cat.ingredientes || null, cat.nutricao ? JSON.stringify(cat.nutricao) : null, cat.nutricao ? 1 : 0],
        );
        await atualizarConteudoFicha(pool, ean);
        continue;
      }
      if (eanSuspeito(descricao, { foodGroups: off.grupos_alimento, nomeCand: off.nome })) {
        console.warn(`[enriquecer ean] SUSPEITO (OFF≠talão): ${ean} talão="${descricao}" off="${off.nome}" — não gravado`);
        continue;
      }
      await pool.query(
        `INSERT INTO produto_ean (ean, item_id, fonte, nome, marca, quantidade, categoria, ingredientes, alergenios, nutricao, off_json)
           VALUES (?,NULL,'off',?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE nome=VALUES(nome), marca=VALUES(marca), quantidade=VALUES(quantidade), categoria=VALUES(categoria),
           ingredientes=VALUES(ingredientes), alergenios=VALUES(alergenios), nutricao=VALUES(nutricao), nutricao_confirmada=1, off_json=VALUES(off_json)`,
        [ean, lim(tituloProduto(off.nome), 200), lim(tituloProduto(off.marca), 120), lim(off.quantidade, 60), lim(off.categoria, 255), off.ingredientes, off.alergenios,
          off.nutricao_100g ? JSON.stringify(off.nutricao_100g) : null, JSON.stringify(off)],
      );
      await atualizarConteudoFicha(pool, ean);
      garantirFichaPT(pool, ean).catch(() => {}); // OFF pode vir noutra língua → PT em fundo
    } catch (e) {
      console.error('[enriquecer ean]', ean, e.message);
    }
  }
}

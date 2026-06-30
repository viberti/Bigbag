// NUTRIÇÃO CANÓNICA de commodities (design (1), 2026-06-30): produtos genéricos de perfil fixo
// (ovos, arroz, açúcar, farinha…) devem ter UMA nutrição → UMA nota, em vez de variar com o ruído
// dos dados por-marca. Devolve a nutrição canónica (TACO/USDA, FORMA VENDIDA) da variante certa, ou
// null quando NÃO se deve forçar (qualificador/forma que muda o perfil, ou família não-commodity).
// Tabela curada em data/nutricao_canonica.json. PURO (sem BD). Ver Nutricao_Canonica_Commodities.md.
import { readFileSync } from 'node:fs';

let CANON = {};
try { CANON = JSON.parse(readFileSync(new URL('../../data/nutricao_canonica.json', import.meta.url), 'utf8')); } catch { CANON = {}; }

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Devolve { nut, tier } da variante canónica, ou null. familia = slug; nome = nome do produto.
export function nutricaoCanonica(familia, nome) {
  const ent = familia && CANON[familia];
  if (!ent || !Array.isArray(ent.variantes)) return null;
  const nm = norm(nome);
  // qualificador que QUEBRA o canónico (ómega-3, light, cozido, líquido…) → não força, mantém retail.
  if ((ent.quebra || []).some((k) => nm.includes(norm(k)))) return null;
  // escolhe a variante: a 1.ª cujo `match` aparece no nome; senão a default (match:null).
  let def = null;
  for (const v of ent.variantes) {
    if (v.match == null) { def = v; continue; }
    if (v.match.some((k) => nm.includes(norm(k)))) return { nut: v.nut, tier: ent.tier };
  }
  return def ? { nut: def.nut, tier: ent.tier } : null;
}

export function tierCanonico(familia) { return (familia && CANON[familia] && CANON[familia].tier) || null; }
export function familiasCanonicas() { return Object.keys(CANON).filter((k) => k[0] !== '_'); }

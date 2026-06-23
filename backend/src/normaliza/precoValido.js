// Guard ÚNICO: um valor é PREÇO real (não sentinela do VTEX nem placeholder de centavo)?
// Decisão do dono (2026-06-23, Cluster 1).
//  - Sentinelas de "indisponível": 99999 / 999999 / 9999999 (valores EXATOS, isolados). Há
//    remédios caros LEGÍTIMOS até R$558k → NUNCA filtrar por faixa, só por valor exato.
//  - Piso de centavo: < 0,50 (SKUs virtuais/promo: "Pneu colecionável R$0,01").
//  - Disponibilidade (VTEX): IsAvailable=false / AvailableQuantity<=0 → não é oferta real
//    (causa-raiz do sentinela; o valor exato é o cinto-e-suspensório).
const SENTINELAS = new Set([99999, 999999, 9999999]);

export function precoValido(preco, { disponivel } = {}) {
  if (disponivel === false) return false;
  const p = Number(preco);
  if (!Number.isFinite(p) || p <= 0 || p < 0.5) return false;
  if (SENTINELAS.has(p)) return false;
  return true;
}

// Qual LISTA de compras um pedido usa (migr. 099). A app BigBag não manda nada → 'bigbag'
// (contrato antigo intacto); a app "Lista" (/lista) manda o header `X-Lista: simples`.
// Valor fora da lista conhecida → 'bigbag' (nunca cria listas por engano/injeção).
export const LISTAS = Object.freeze(['bigbag', 'simples']);
export const LISTA_DEFAULT = 'bigbag';

export function listaDe(req) {
  const v = String(req?.get?.('X-Lista') || req?.query?.lista || '').trim().toLowerCase();
  return LISTAS.includes(v) ? v : LISTA_DEFAULT;
}

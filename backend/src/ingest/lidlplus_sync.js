// Sincroniza os talões novos do Lidl Plus → Bigbag.
// Lista os talões, ignora os já importados (numero_fatura = id do talão), e para
// cada novo: busca o detalhe → ticketParaFatura → ingestão estruturada (com EAN).
// O refresh token é lido/rotacionado pelo token-store. Devolve o resumo para a
// notificação. NÃO correr dois sincronizadores em simultâneo (rotação do token).
import { criarCliente, ticketParaFatura } from './lidlplus.js';
import { ingerirFaturaEstruturada } from './ingestEstruturada.js';
import { lerToken, guardarToken } from './lidlplus_token.js';

export async function importarNovos(pool, { limite = 0 } = {}) {
  const refreshToken = await lerToken();
  const cli = criarCliente({ refreshToken, onRotate: guardarToken });

  const tickets = await cli.listarTickets();
  // ids já importados (faturas do Lidl com numero_fatura = id do talão)
  const [rows] = await pool.query(
    "SELECT f.numero_fatura n FROM fatura f JOIN loja l ON l.id = f.loja_id WHERE l.cadeia = 'Lidl' AND f.numero_fatura IS NOT NULL",
  );
  const vistos = new Set(rows.map((r) => String(r.n)));
  let novos = tickets.filter((t) => !vistos.has(String(t.id)));
  if (limite > 0) novos = novos.slice(0, limite);

  const importados = [];
  for (const t of novos) {
    try {
      const ticket = await cli.obterTicket(t.id);
      const dados = ticketParaFatura(ticket);
      const r = await ingerirFaturaEstruturada(pool, dados, { metodo: 'digital', origemCaptura: 'lidlplus' });
      if (!r.duplicada) {
        importados.push({ id: t.id, fatura_id: r.fatura_id, n_itens: r.n_itens, data: dados.data_compra, total: dados.total_impresso });
      }
    } catch (e) {
      console.error('[lidl sync] talão', t.id, e.message);
    }
  }
  return { total: tickets.length, novosDetetados: novos.length, importados };
}

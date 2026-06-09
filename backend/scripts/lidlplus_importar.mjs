// CLI de teste/importação do Lidl Plus. Requer LIDLPLUS_REFRESH_TOKEN no .env
// (obtido UMA vez com `python -m lidlplus -c PT -l pt --2fa phone auth`).
//
//   node scripts/lidlplus_importar.mjs --listar           # lista os talões (id, data, total)
//   node scripts/lidlplus_importar.mjs --ticket <id>      # despeja o JSON CRU de um talão
//   node scripts/lidlplus_importar.mjs --ticket <id> > t.json
//   node scripts/lidlplus_importar.mjs --parse <id>       # mostra o talão já mapeado p/ fatura
//   node scripts/lidlplus_importar.mjs --importar <id>    # (TODO) ingere no Bigbag
//
// Usar primeiro --listar e --ticket <id> para CONFIRMAR os nomes dos campos reais
// antes de finalizar o parser/ingestão.
import { criarCliente, ticketParaFatura } from '../src/ingest/lidlplus.js';
import { importarNovos } from '../src/ingest/lidlplus_sync.js';
import { lerToken, guardarToken } from '../src/ingest/lidlplus_token.js';
import { getPool } from '../src/db.js';

const args = process.argv.slice(2);
const tem = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

async function main() {
  const cli = criarCliente({ refreshToken: await lerToken(), onRotate: guardarToken });

  if (tem('--listar')) {
    const tickets = await cli.listarTickets();
    console.log(`${tickets.length} talões.\n`);
    for (const t of tickets.slice(0, 30)) {
      console.log(`${t.id}  | ${t.date || t.datetime || '?'} | ${t.totalAmount ?? t.total ?? '?'} | itens: ${t.itemsCount ?? '?'}`);
    }
    if (tickets[0]) console.log(`\n(campos do resumo: ${Object.keys(tickets[0]).join(', ')})`);
    return;
  }

  if (tem('--importar')) {
    // Importa TODOS os talões novos (o token-store trata da rotação). Usa --limite N p/ teste.
    const limite = Number(val('--limite') || 0);
    const r = await importarNovos(getPool(), { limite });
    console.log(`Talões: ${r.total} | novos: ${r.novosDetetados} | importados: ${r.importados.length}`);
    for (const i of r.importados) console.log(`  ✓ ${i.id} → fatura #${i.fatura_id} (${i.n_itens} itens, ${i.data}, €${i.total})`);
    process.exit(0);
  }

  const id = val('--ticket') || val('--parse');
  if (!id) {
    console.error('Usa --listar, --ticket <id>, --parse <id> ou --importar [--limite N].');
    process.exit(1);
  }
  const ticket = await cli.obterTicket(id);

  if (tem('--ticket')) {
    console.log(JSON.stringify(ticket, null, 2)); // JSON CRU — para confirmar os campos
  } else if (tem('--parse')) {
    const fatura = ticketParaFatura(ticket);
    console.log('chaves do talão cru:', Object.keys(ticket).join(', '));
    console.log('\nfatura mapeada:');
    console.log(JSON.stringify({ ...fatura, itens: fatura.itens.slice(0, 8) }, null, 2));
    console.log(`\n${fatura.itens.length} itens | com EAN: ${fatura.itens.filter((i) => i.ean).length}`);
  }
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

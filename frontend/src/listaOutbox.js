// Outbox offline da Lista de Compras (lógica PURA, sem rede nem DOM — testável).
//
// Cenário: na loja, com sinal fraco, o utilizador continua a mexer na lista —
// adiciona, risca ("no carrinho"), muda quantidades, remove. Sem outbox, só as
// ADIÇÕES sobreviviam (fila antiga); marcar/incrementar/remover offline perdiam-se.
//
// Cada mutação vira uma OPERAÇÃO na fila (localStorage). Quando volta a rede,
// despacham-se por ordem (FIFO). Itens criados offline têm id temporário ("tmp…");
// quando o `add` correspondente é aceite, o servidor dá o id real e as operações
// seguintes que referiam o tmp são REMAPEADAS (resolverId) — por isso "adicionar
// e logo riscar offline" funciona: o add corre primeiro, depois o marcar no id real.
//
// Formas de operação:
//   { op:'add', tmp, nome, quantidade, categoria }
//   { op:'inc', id, inc }          // delta (somável)
//   { op:'qtd', id, quantidade }   // valor absoluto (o último manda)
//   { op:'marcar', id, marcado }   // riscar/desriscar
//   { op:'nome', id, nome }        // concretizar variante
//   { op:'remover', id }

const ehTmp = (id) => String(id).startsWith('tmp');
const mesmo = (a, b) => String(a) === String(b);

// Junta `op` à fila, COALESCENDO para a fila não crescer sem limite e para o
// estado final ser o que o utilizador vê (ex.: cinco toques no "+" = um inc de 5;
// riscar+desriscar = nada). Devolve uma fila NOVA (não muta a recebida).
export function coalescar(fila, op) {
  const out = fila.map((e) => ({ ...e }));
  switch (op.op) {
    case 'add':
      out.push({ ...op });
      return out;

    case 'inc': {
      // soma com um inc pendente do mesmo alvo; senão acrescenta
      const e = out.find((x) => x.op === 'inc' && mesmo(x.id, op.id));
      if (e) { e.inc += op.inc; if (e.inc === 0) return out.filter((x) => x !== e); return out; }
      out.push({ ...op });
      return out;
    }

    case 'qtd': {
      // valor absoluto: descarta incs/qtds anteriores do alvo (ficam sem sentido)
      const limpa = out.filter((x) => !((x.op === 'inc' || x.op === 'qtd') && mesmo(x.id, op.id)));
      limpa.push({ ...op });
      return limpa;
    }

    case 'marcar': {
      const i = out.findIndex((x) => x.op === 'marcar' && mesmo(x.id, op.id));
      if (i >= 0) out[i] = { ...op }; else out.push({ ...op });
      return out;
    }

    case 'nome': {
      const i = out.findIndex((x) => x.op === 'nome' && mesmo(x.id, op.id));
      if (i >= 0) out[i] = { ...op }; else out.push({ ...op });
      return out;
    }

    case 'remover': {
      // remover anula tudo o que estava pendente para este alvo
      const limpa = out.filter((x) => !(x.op !== 'add' && mesmo(x.id, op.id)) && !(x.op === 'add' && mesmo(x.tmp, op.id)));
      // se o alvo era um item criado offline (tmp) e ainda nem foi enviado, o item
      // nunca existiu para o servidor → não há nada a remover lá.
      if (!ehTmp(op.id)) limpa.push({ ...op });
      return limpa;
    }

    default:
      return out;
  }
}

// Resolve o id de uma operação face ao remap tmp→real construído ao despachar.
export const resolverId = (id, remap) => (remap[id] != null ? remap[id] : id);

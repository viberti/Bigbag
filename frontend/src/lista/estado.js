// Estado LOCAL da app "Lista" — lógica PURA (sem React, sem rede), testada em
// backend/test/listaEstado.test.mjs.
//
// A app é otimista: cada toque muda a lista no ecrã JÁ e entra numa fila (outbox) que
// é enviada ao servidor por ordem. No mercado a rede falha; a fila sobrevive em
// localStorage e é enviada quando ela voltar. A coalescência das operações é a do
// listaOutbox.js do BigBag (fonte única); aqui só se acrescenta a operação 'medida'
// (peso absoluto de um item vendido a peso), que o outbox antigo não conhecia.
import { coalescar } from '../listaOutbox.js';
import { grupoDeNome } from '../../../backend/src/normaliza/categoria.js';

export function enfileirar(fila, op) {
  if (op.op === 'medida') {
    // valor absoluto → só o último conta
    return [...fila.filter((x) => !(x.op === 'medida' && String(x.id) === String(op.id))), { ...op }];
  }
  if (op.op === 'remover') {
    // o coalescar já limpa inc/qtd/marcar/nome do alvo; limpa também as 'medida'
    return coalescar(fila.filter((x) => !(x.op === 'medida' && String(x.id) === String(op.id))), op);
  }
  return coalescar(fila, op);
}

const mesmo = (a, b) => String(a) === String(b);
const chave = (n) => String(n || '').trim().toLowerCase();

// Aplica UMA operação à lista do ecrã (devolve uma lista nova). `quem` = nome de quem risca.
export function aplicar(itens, op, quem = null) {
  switch (op.op) {
    case 'add': {
      // mesma consolidação que o servidor faz: o mesmo nome soma quantidade
      const ja = itens.find((x) => chave(x.nome) === chave(op.nome));
      if (ja) {
        return itens.map((x) => (x === ja
          ? { ...x, quantidade: Math.min(99, (x.quantidade || 1) + (op.quantidade || 1)), estado: 'ativo', marcado_por: null }
          : x));
      }
      return [...itens, {
        id: op.tmp, nome: op.nome, ean: op.ean || null, quantidade: op.quantidade || 1,
        estado: 'ativo', grupo: grupoDeNome(op.nome) || 'outros', pendente: true,
      }];
    }
    case 'inc':
      return itens.map((x) => (mesmo(x.id, op.id)
        ? { ...x, quantidade: Math.max(1, Math.min(99, (x.quantidade || 1) + op.inc)) } : x));
    case 'medida':
      return itens.map((x) => (mesmo(x.id, op.id) ? { ...x, qtd_medida: op.qtd_medida, unidade: op.unidade } : x));
    case 'marcar':
      return itens.map((x) => (mesmo(x.id, op.id)
        ? { ...x, estado: op.marcado ? 'carrinho' : 'ativo', marcado_por: op.marcado ? quem : null } : x));
    case 'remover':
      return itens.filter((x) => !mesmo(x.id, op.id));
    default:
      return itens;
  }
}

// Passo do stepper de PESO: fino abaixo de 1 kg/L, mais largo acima.
export const passoPeso = (q) => ((Number(q) || 0) < 1 ? 0.05 : 0.25);
export function novaMedida(q, sentido) {
  const atual = Number(q) || 0.5;
  const novo = Math.round((atual + sentido * passoPeso(sentido < 0 ? atual - 0.001 : atual)) * 1000) / 1000;
  return Math.max(0.05, novo);
}

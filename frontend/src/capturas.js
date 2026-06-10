// Fila de CAPTURAS por identificar, persistida em IndexedDB. Cada captura liga um
// item do talão (item_id) ao seu EAN (scan) + fotos do rótulo, e ACUMULA no
// telefone até o utilizador enviar tudo. Sobrevive a fechar a app / perder sinal
// (capturar no supermercado offline, enviar depois). As fotos guardam-se como
// Blobs (File), reduzidas só no envio. DB partilhado em dbLocal.js.
import { txStore } from './dbLocal.js';

// Devolve todas as capturas como mapa { item_id: {item_id, ean, nome, fotos[], ts} }.
export async function lerCapturas() {
  const arr = await txStore('capturas', 'readonly', (s) => s.getAll());
  const mapa = {};
  for (const c of arr || []) mapa[c.item_id] = c;
  return mapa;
}

// Cria/atualiza a captura de um item (substitui a anterior).
export async function guardarCaptura(rec) {
  if (!rec || !rec.item_id) throw new Error('captura sem item_id');
  await txStore('capturas', 'readwrite', (s) => s.put(rec));
  return rec;
}

export async function removerCaptura(itemId) {
  await txStore('capturas', 'readwrite', (s) => s.delete(itemId));
}

export async function limparCapturas() {
  await txStore('capturas', 'readwrite', (s) => s.clear());
}

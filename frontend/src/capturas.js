// Fila de CAPTURAS por identificar, persistida em IndexedDB. Cada captura liga um
// item do talão (item_id) ao seu EAN (scan) + fotos do rótulo, e ACUMULA no
// telefone até o utilizador enviar tudo. Sobrevive a fechar a app / perder sinal
// (capturar no supermercado offline, enviar depois). As fotos guardam-se como
// Blobs (File), reduzidas só no envio.
const DB = 'bigbag';
const STORE = 'capturas';

let _db = null;
function abrir() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'item_id' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(modo, fn) {
  return abrir().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, modo);
        const store = t.objectStore(STORE);
        let out;
        const r = fn(store);
        if (r) r.onsuccess = () => { out = r.result; };
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

// Devolve todas as capturas como mapa { item_id: {item_id, ean, nome, fotos[], ts} }.
export async function lerCapturas() {
  const arr = await tx('readonly', (s) => s.getAll());
  const mapa = {};
  for (const c of arr || []) mapa[c.item_id] = c;
  return mapa;
}

// Cria/atualiza a captura de um item (substitui a anterior).
export async function guardarCaptura(rec) {
  if (!rec || !rec.item_id) throw new Error('captura sem item_id');
  await tx('readwrite', (s) => s.put(rec));
  return rec;
}

export async function removerCaptura(itemId) {
  await tx('readwrite', (s) => s.delete(itemId));
}

export async function limparCapturas() {
  await tx('readwrite', (s) => s.clear());
}

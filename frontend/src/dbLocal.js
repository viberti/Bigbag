// IndexedDB partilhado da app ('bigbag'). Um só abridor para todos os stores —
// versões/upgrades num único sítio (abrir o mesmo DB com versões diferentes a
// partir de módulos separados rebenta). Stores:
//   capturas — fila de capturas por identificar (scan+fotos), chave item_id
//   fichas   — base local de produtos RICA (nutrição/análise), chave ean
//   catalogo — índice nome→EAN do catálogo (sem nutrição), chave ean
const DB = 'bigbag';
const VERSAO = 2;

let _db = null;
export function abrirDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSAO);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('capturas')) db.createObjectStore('capturas', { keyPath: 'item_id' });
      if (!db.objectStoreNames.contains('fichas')) db.createObjectStore('fichas', { keyPath: 'ean' });
      if (!db.objectStoreNames.contains('catalogo')) db.createObjectStore('catalogo', { keyPath: 'ean' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

// Transação genérica: fn recebe o objectStore; se devolver um request, o resultado
// dele é o valor resolvido. Para escrita em lote, fn pode fazer N put() — a
// transação só resolve no oncomplete (tudo ou nada).
export function txStore(store, modo, fn) {
  return abrirDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, modo);
        let out;
        const r = fn(t.objectStore(store));
        if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

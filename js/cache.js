const DB_NAME = 'cec-cache';
const DB_VERSION = 1;

const STORES = ['communes', 'meta'];

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('communes')) {
        db.createObjectStore('communes', { keyPath: 'code' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode = 'readonly') {
  return db.transaction(store, mode).objectStore(store);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getMeta(key) {
  const db = await openDB();
  const r = await reqToPromise(tx(db, 'meta').get(key));
  return r ? r.value : null;
}

export async function setMeta(key, value) {
  const db = await openDB();
  await reqToPromise(tx(db, 'meta', 'readwrite').put({ key, value }));
}

export async function bulkPut(records) {
  const db = await openDB();
  const store = tx(db, 'communes', 'readwrite');
  const promises = records.map(r => reqToPromise(store.put(r)));
  await Promise.all(promises);
}

export async function getCommune(code) {
  const db = await openDB();
  return reqToPromise(tx(db, 'communes').get(code));
}

export async function getAllCommunes() {
  const db = await openDB();
  return reqToPromise(tx(db, 'communes').getAll());
}

export async function countCommunes() {
  const db = await openDB();
  return reqToPromise(tx(db, 'communes').count());
}

export async function clearAll() {
  const db = await openDB();
  await Promise.all(
    STORES.map(s => reqToPromise(db.transaction(s, 'readwrite').objectStore(s).clear()))
  );
}

export async function isReady() {
  const ts = await getMeta('lastPullAt');
  const n = await countCommunes();
  return Boolean(ts) && n > 1000;
}

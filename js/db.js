const DB_NAME = "cafeRencontreDB";
const DB_VERSION = 1;
let dbInstance = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) return resolve(dbInstance);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("achats")) db.createObjectStore("achats", { keyPath: "id" });
      if (!db.objectStoreNames.contains("ventes")) db.createObjectStore("ventes", { keyPath: "id" });
      if (!db.objectStoreNames.contains("parametres")) db.createObjectStore("parametres", { keyPath: "key" });
      if (!db.objectStoreNames.contains("compteurs")) db.createObjectStore("compteurs", { keyPath: "key" });
    };
    req.onsuccess = (e) => { dbInstance = e.target.result; resolve(dbInstance); };
    req.onerror = (e) => reject(e.target.error);
  });
}

async function txStore(storeName, mode) {
  const db = await openDB();
  return db.transaction(storeName, mode).objectStore(storeName);
}

async function dbGetAll(storeName) {
  const store = await txStore(storeName, "readonly");
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(storeName, key) {
  const store = await txStore(storeName, "readonly");
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(storeName, value) {
  const store = await txStore(storeName, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(storeName, key) {
  const store = await txStore(storeName, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function nextRef(prefix) {
  const store = await txStore("compteurs", "readwrite");
  const year = new Date().getFullYear();
  const key = prefix + "-" + year;
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => {
      const current = req.result ? req.result.value : 0;
      const next = current + 1;
      const putReq = store.put({ key, value: next });
      putReq.onsuccess = () => resolve(`${prefix}-${year}-${String(next).padStart(4, "0")}`);
      putReq.onerror = () => reject(putReq.error);
    };
    req.onerror = () => reject(req.error);
  });
}

window.DB = { openDB, dbGetAll, dbGet, dbPut, dbDelete, nextRef };

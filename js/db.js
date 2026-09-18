// Stockage via localStorage (et non IndexedDB) : IndexedDB est bloqué par Chrome
// et Safari quand la page est ouverte en double-clic (file://) plutôt que via un
// serveur. localStorage fonctionne de façon fiable dans les deux cas.

function readAll(storeName) {
  try { return JSON.parse(localStorage.getItem("crdb_" + storeName) || "[]"); }
  catch { return []; }
}
function writeAll(storeName, arr) {
  localStorage.setItem("crdb_" + storeName, JSON.stringify(arr));
}

async function dbGetAll(storeName) {
  return readAll(storeName);
}

async function dbPut(storeName, value) {
  const arr = readAll(storeName);
  const matchKey = value.id !== undefined ? "id" : "key";
  const idx = arr.findIndex((x) => x[matchKey] === value[matchKey]);
  if (idx >= 0) arr[idx] = value;
  else arr.push(value);
  writeAll(storeName, arr);
  return value[matchKey];
}

async function dbDelete(storeName, key) {
  writeAll(storeName, readAll(storeName).filter((x) => x.id !== key));
}

async function nextRef(prefix) {
  const year = new Date().getFullYear();
  const key = prefix + "-" + year;
  const compteurs = readAll("compteurs");
  let rec = compteurs.find((c) => c.key === key);
  if (!rec) { rec = { key, value: 0 }; compteurs.push(rec); }
  rec.value += 1;
  writeAll("compteurs", compteurs);
  return `${prefix}-${year}-${String(rec.value).padStart(4, "0")}`;
}

window.DB = { dbGetAll, dbPut, dbDelete, nextRef };

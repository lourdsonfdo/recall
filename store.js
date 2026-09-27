/* Recall storage: IndexedDB on the device. Nothing leaves the phone. */
(function (root) {
  "use strict";

  let dbp;
  function open() {
    return (dbp ||= new Promise((res, rej) => {
      const r = indexedDB.open("recall", 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore("kv");
        db.createObjectStore("revlog", { keyPath: "id", autoIncrement: true });
        db.createObjectStore("media");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const out = fn(t.objectStore(store));
      t.oncomplete = () => res(out && "result" in out ? out.result : out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error("IndexedDB transaction aborted"));
    });
  }

  const get = (k) => tx("kv", "readonly", (s) => s.get(k));
  const put = (k, v) => tx("kv", "readwrite", (s) => s.put(v, k));

  async function load() {
    const [cards, core, revlog] = await Promise.all([
      get("cards"),
      get("core"),
      tx("revlog", "readonly", (s) => s.getAll()),
    ]);
    if (!cards || !core) return null;
    return Object.assign({ cards, revlog: revlog || [] }, core);
  }

  function coreOf(db) {
    return { st: db.st, cfg: db.cfg, daily: db.daily, bundles: db.bundles, nextPos: db.nextPos };
  }

  const saveCore = (db) => put("core", coreOf(db));
  const saveCards = (db) => put("cards", db.cards);
  const saveAll = (db) => Promise.all([saveCards(db), saveCore(db)]);

  async function addLog(entry) {
    const e = Object.assign({}, entry);
    delete e.id;
    entry.id = await tx("revlog", "readwrite", (s) => s.add(e));
    return entry.id;
  }
  const deleteLog = (id) => tx("revlog", "readwrite", (s) => s.delete(id));
  const clearLogs = () => tx("revlog", "readwrite", (s) => s.clear());
  async function replaceLogs(list) {
    await clearLogs();
    await tx("revlog", "readwrite", (s) => list.forEach((e) => {
      const c = Object.assign({}, e);
      delete c.id;
      s.add(c);
    }));
  }

  const putMedia = (name, blob) => tx("media", "readwrite", (s) => s.put(blob, name));
  const getMedia = (name) => tx("media", "readonly", (s) => s.get(name));
  const mediaNames = () => tx("media", "readonly", (s) => s.getAllKeys());

  async function wipe() {
    const db = await open();
    await Promise.all(["kv", "revlog", "media"].map((n) => tx(n, "readwrite", (s) => s.clear())));
    return db;
  }

  root.Store = { load, saveCore, saveCards, saveAll, addLog, deleteLog, replaceLogs, putMedia, getMedia, mediaNames, wipe };
})(self);

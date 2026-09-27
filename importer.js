/* Recall importer: Anki .apkg/.colpkg (legacy + new zstd format), Anki plain-text
 * exports (.txt/.csv/.tsv), and Recall deck JSON.
 * Heavy libraries are loaded lazily from the CDN on the first import.
 */
(function (root) {
  "use strict";

  const LIBS = {
    JSZip: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
    initSqlJs: "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js",
    fzstd: "https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js",
    DOMPurify: "https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js",
  };
  const SQL_WASM = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.wasm";

  function load(name) {
    if (root[name]) return Promise.resolve(root[name]);
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = LIBS[name];
      s.onload = () => (root[name] ? res(root[name]) : rej(new Error(name + " failed to load")));
      s.onerror = () => rej(new Error(`Couldn't load ${name} — importing needs a connection the first time.`));
      document.head.appendChild(s);
    });
  }

  let sqlPromise;
  const sql = () => (sqlPromise ||= load("initSqlJs").then((init) => init({ locateFile: () => SQL_WASM })));

  // ---------- minimal protobuf reader (for the new .apkg format) ----------
  function pb(buf) {
    const out = {};
    let i = 0;
    const varint = () => {
      let x = 0, shift = 0, b;
      do {
        b = buf[i++];
        x += (b & 0x7f) * 2 ** shift;
        shift += 7;
      } while (b & 0x80);
      return x;
    };
    while (i < buf.length) {
      const tag = varint();
      const f = Math.floor(tag / 8), w = tag & 7;
      let v;
      if (w === 0) v = varint();
      else if (w === 2) {
        const n = varint();
        v = buf.subarray(i, i + n);
        i += n;
      } else if (w === 1) (v = buf.subarray(i, i + 8)), (i += 8);
      else if (w === 5) (v = buf.subarray(i, i + 4)), (i += 4);
      else throw new Error("bad protobuf wire type " + w);
      (out[f] ||= []).push(v);
    }
    return out;
  }
  const utf8 = (b) => (b ? new TextDecoder().decode(b) : "");

  // ---------- Anki template rendering ----------
  const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

  function cloze(text, n, answer) {
    return text.replace(CLOZE, (_, num, body, hint) => {
      if (+num !== n) return body;
      if (answer) return `<span class="cloze">${body}</span>`;
      return `<span class="cloze">[${hint || "…"}]</span>`;
    });
  }

  function clozeNumbers(fields) {
    const nums = new Set();
    for (const v of Object.values(fields)) for (const m of v.matchAll(CLOZE)) nums.add(+m[1]);
    return [...nums].sort((a, b) => a - b);
  }

  const stripHtml = (h) => h.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ");

  function render(tmpl, fields, { ord = 0, isCloze = false, answer = false, front = "" } = {}) {
    let s = tmpl;
    // Conditional sections, innermost first.
    const sec = /\{\{([#^])([^}]+)\}\}((?:(?!\{\{[#^])[\s\S])*?)\{\{\/\2\}\}/;
    for (let guard = 0; sec.test(s) && guard < 200; guard++) {
      s = s.replace(sec, (_, kind, name, body) => {
        const key = name.trim().split(":").pop();
        const v = key.startsWith("c") && isCloze && /^c\d+$/.test(key) ? "" : fields[key] || "";
        const filled = stripHtml(v).trim() !== "";
        return (kind === "#") === filled ? body : "";
      });
    }
    return s.replace(/\{\{([^#^/}][^}]*)\}\}/g, (_, expr) => {
      const parts = expr.trim().split(":");
      const name = parts.pop().trim();
      const filters = parts.map((p) => p.trim().toLowerCase());
      if (name === "FrontSide") return front;
      let v = fields[name];
      if (v === undefined) return "";
      for (const f of filters.reverse()) {
        if (f === "cloze") v = cloze(v, ord + 1, answer);
        else if (f === "text") v = stripHtml(v);
        else if (f === "type") v = answer ? "" : "";
        else if (f === "hint") v = v ? `<details class="hint"><summary>Hint</summary>${v}</details>` : "";
        else if (f.startsWith("tts")) v = "";
      }
      return v;
    });
  }

  function finish(html) {
    html = html.replace(/\[sound:[^\]]+\]/g, "").trim();
    return root.DOMPurify ? root.DOMPurify.sanitize(html, { ADD_ATTR: ["id"] }) : html;
  }

  function buildCard(model, fields, ord) {
    const isCloze = model.type === 1;
    const t = isCloze ? model.tmpls[0] : model.tmpls[ord];
    if (!t) return null;
    const q = render(t.q, fields, { ord, isCloze });
    const a = render(t.a, fields, { ord, isCloze, answer: true, front: q });
    if (!stripHtml(q).trim() && !/<img/i.test(q)) return null; // Anki skips empty fronts
    return { q: finish(q), a: finish(a) };
  }

  // ---------- .apkg / .colpkg ----------
  async function readApkg(file, { withSched = true } = {}) {
    const [JSZip] = await Promise.all([load("JSZip"), load("DOMPurify")]);
    const zip = await JSZip.loadAsync(file);
    const entry = zip.file("collection.anki21b") || zip.file("collection.anki21") || zip.file("collection.anki2");
    if (!entry) throw new Error("Not an Anki package (no collection inside).");
    const zstd = entry.name.endsWith("21b");
    let bytes = await entry.async("uint8array");
    if (zstd) bytes = (await load("fzstd")).decompress(bytes);
    const SQL = await sql();
    const db = new SQL.Database(bytes);
    const rows = (q) => {
      const r = db.exec(q)[0];
      return r ? r.values : [];
    };

    const models = {}, decks = {};
    const [[crt, modelsJson, decksJson]] = rows("select crt, models, decks from col");
    const hasTable = (t) => rows(`select name from sqlite_master where type='table' and name='${t}'`).length > 0;
    if (hasTable("notetypes")) {
      for (const [id, name, cfg] of rows("select id, name, config from notetypes")) {
        const c = pb(cfg);
        models[id] = { name, type: (c[1] || [0])[0], flds: [], tmpls: [] };
      }
      for (const [ntid, ord, name] of rows("select ntid, ord, name from fields order by ntid, ord")) models[ntid] && (models[ntid].flds[ord] = name);
      for (const [ntid, ord, name, cfg] of rows("select ntid, ord, name, config from templates order by ntid, ord")) {
        const c = pb(cfg);
        models[ntid] && (models[ntid].tmpls[ord] = { name, q: utf8((c[1] || [])[0]), a: utf8((c[2] || [])[0]) });
      }
      for (const [id, name] of rows("select id, name from decks")) decks[id] = name.split("\x1f").join("::");
    } else {
      for (const m of Object.values(JSON.parse(modelsJson))) {
        models[m.id] = { name: m.name, type: m.type, flds: m.flds.map((f) => f.name), tmpls: m.tmpls.map((t) => ({ name: t.name, q: t.qfmt, a: t.afmt })) };
      }
      for (const d of Object.values(JSON.parse(decksJson))) decks[d.id] = d.name;
    }

    const notes = {};
    for (const [id, mid, flds, tags] of rows("select id, mid, flds, tags from notes")) notes[id] = { mid, flds: flds.split("\x1f"), tags: tags.trim() ? tags.trim().split(/\s+/) : [] };

    const crtDay = Sched.dayNum(crt * 1000);
    const cards = [], states = {};
    let skipped = 0;
    for (const [nid, ord, did, odid, type, queue, due, ivl, factor, reps, lapses, left] of rows(
      "select nid, ord, did, odid, type, queue, due, ivl, factor, reps, lapses, left from cards order by nid, ord"
    )) {
      const n = notes[nid], m = n && models[n.mid];
      if (!m) { skipped++; continue; }
      const fields = {};
      m.flds.forEach((f, i) => (fields[f] = n.flds[i] || ""));
      const built = buildCard(m, fields, ord);
      if (!built) { skipped++; continue; }
      const k = `n${nid}-${ord}`;
      const deck = decks[odid || did] || "Imported";
      if (deck === "Default" && /please update to the latest anki/i.test(built.q)) { skipped++; continue; }
      cards.push({ k, d: deck, q: built.q, a: built.a, t: n.tags });
      if (withSched && type !== 0) states[k] = convertSched({ type, queue, due, ivl, factor, reps, lapses, left }, crtDay);
    }
    db.close();

    const media = await readMedia(zip, zstd);
    return { cards, states, media, skipped };
  }

  function convertSched(c, crtDay) {
    const now = Date.now();
    const cfg = Sched.DEFAULTS;
    const s = { type: c.type, queue: c.queue, due: 0, ivl: c.ivl, ease: c.factor || cfg.startEase, step: 0, reps: c.reps, lapses: c.lapses };
    if (c.type === 2) s.due = crtDay + c.due;
    else {
      // learning / relearning
      const steps = c.type === 3 ? cfg.relearnSteps : cfg.learnSteps;
      s.step = Math.max(0, Math.min(steps.length - 1, steps.length - (c.left % 1000)));
      s.due = c.queue === 1 ? c.due * 1000 : c.queue === 3 ? Sched.dayStart(crtDay + c.due) : now;
      if (c.type === 3) s.ivl = Math.max(1, c.ivl);
    }
    if (c.queue === -1) s.queue = -1;
    else if (c.queue < -1) s.queue = c.type === 2 ? 2 : c.type === 0 ? 0 : 1;
    else s.queue = c.type === 2 ? 2 : c.type === 0 ? 0 : 1;
    return s;
  }

  async function readMedia(zip, zstd) {
    const mf = zip.file("media");
    if (!mf) return {};
    let map = {};
    let raw = await mf.async("uint8array");
    if (zstd) {
      raw = root.fzstd.decompress(raw);
      (pb(raw)[1] || []).forEach((e, i) => (map[i] = utf8((pb(e)[1] || [])[0])));
    } else {
      try { map = JSON.parse(utf8(raw)); } catch { map = {}; }
    }
    const out = {};
    for (const [idx, name] of Object.entries(map)) {
      const f = zip.file(idx);
      if (!f || !name) continue;
      let b = await f.async("uint8array");
      if (zstd) b = root.fzstd.decompress(b);
      out[name] = new Blob([b], { type: mime(name) });
    }
    return out;
  }

  function mime(name) {
    const ext = name.split(".").pop().toLowerCase();
    return { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", mp3: "audio/mpeg", ogg: "audio/ogg" }[ext] || "application/octet-stream";
  }

  // ---------- plain text (Anki "Notes in Plain Text" or any 2-column CSV/TSV) ----------
  function parseDelimited(text, sep) {
    const rows = [];
    let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') (f += '"'), i++;
        else if (ch === '"') q = false;
        else f += ch;
      } else if (ch === '"' && f === "") q = true;
      else if (ch === sep) row.push(f), (f = "");
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(f), rows.push(row), (row = []), (f = "");
      } else f += ch;
    }
    if (f || row.length) row.push(f), rows.push(row);
    return rows.filter((r) => r.some((x) => x.trim()));
  }

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36);
  }

  async function readText(file) {
    await load("DOMPurify").catch(() => {});
    let text = await file.text();
    const opts = { separator: null, html: true, tags: null, deck: null };
    const lines = text.split(/\r?\n/);
    while (lines.length && lines[0].startsWith("#")) {
      const m = lines.shift().match(/^#([\w ]+):(.*)$/);
      if (!m) continue;
      const [key, val] = [m[1].trim().toLowerCase(), m[2].trim()];
      if (key === "separator") opts.separator = { tab: "\t", comma: ",", semicolon: ";", pipe: "|", space: " " }[val.toLowerCase()] || val;
      else if (key === "html") opts.html = val === "true";
      else if (key === "tags column") opts.tags = +val - 1;
      else if (key === "deck column") opts.deckCol = +val - 1;
      else if (key === "deck") opts.deck = val;
    }
    text = lines.join("\n");
    const sep = opts.separator || (text.includes("\t") ? "\t" : text.includes(";") && !text.includes(",") ? ";" : ",");
    const deckName = opts.deck || file.name.replace(/\.[^.]+$/, "");
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>");
    const cards = [];
    for (const r of parseDelimited(text, sep)) {
      const cols = r.filter((_, i) => i !== opts.tags && i !== opts.deckCol);
      if (cols.length < 2) continue;
      const [front, back] = cols.map((x) => (opts.html ? x : esc(x)));
      const q = finish(front);
      cards.push({
        k: "h" + hash(deckName + "\x1f" + front),
        d: (opts.deckCol != null && r[opts.deckCol]) || deckName,
        q,
        a: finish(front + "\n\n<hr id=answer>\n\n" + back),
        t: opts.tags != null && r[opts.tags] ? r[opts.tags].trim().split(/\s+/) : [],
      });
    }
    return { cards, states: {}, media: {}, skipped: 0 };
  }

  async function readFile(file, opts) {
    const name = file.name.toLowerCase();
    if (/\.(apkg|colpkg)$/.test(name)) return readApkg(file, opts);
    if (name.endsWith(".json")) {
      const j = JSON.parse(await file.text());
      if (!Array.isArray(j.cards)) throw new Error("JSON file has no cards list.");
      return { cards: j.cards, states: {}, media: {}, skipped: 0, bundleId: j.id };
    }
    if (/\.(txt|csv|tsv)$/.test(name)) return readText(file);
    throw new Error("Unsupported file. Use .apkg, .colpkg, .txt, .csv or .json.");
  }

  root.Importer = { readFile, render, cloze, clozeNumbers, parseDelimited, pb };
})(self);

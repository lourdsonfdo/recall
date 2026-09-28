/* Recall — UI. Depends on Sched, Col, Store, Importer (loaded before this file). */
(function () {
  "use strict";

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const view = $("#view");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const plain = (h) => h.replace(/<(br|hr|div|p|li)[^>]*>/gi, " ").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
  const enc = encodeURIComponent;
  const now = () => Date.now();

  const ICON = {
    back: '<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
    twisty: '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  };

  let db = null;
  let treeCache = null;
  const tree = () => (treeCache ||= Col.tree(db));
  const dirtyTree = () => (treeCache = null);

  // ---------- persistence ----------
  let saveTimer = null, cardsDirty = false;
  function save({ cards = false, now: immediate = false } = {}) {
    if (cards) cardsDirty = true;
    clearTimeout(saveTimer);
    const run = () => {
      const tasks = [Store.saveCore(db)];
      if (cardsDirty) tasks.push(Store.saveCards(db)), (cardsDirty = false);
      return Promise.all(tasks).catch((e) => toast("Couldn't save: " + e.message));
    };
    if (immediate) return run();
    saveTimer = setTimeout(run, 250);
  }
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && db && save({ now: true }));

  // ---------- local UI prefs (per device, not part of backups) ----------
  const pref = {
    get(k, d) { try { const v = localStorage.getItem("recall." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("recall." + k, JSON.stringify(v)); } catch {} },
  };
  function applyTheme() {
    const t = pref.get("appTheme", "dark");
    if (t === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
    const dark = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? "#000000" : "#f4f3ef";
    document.documentElement.style.setProperty("--card-size", { s: "18px", m: "21px", l: "25px" }[pref.get("size", "m")]);
  }

  // ---------- toast & sheets ----------
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  let openSheet = null;
  function sheet(html, { onClose } = {}) {
    if (openSheet) openSheet.close(true);
    const root = $("#sheet-root");
    root.innerHTML = `<div class="scrim"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
    const scrim = root.firstElementChild;
    const close = (silent) => {
      if (openSheet !== handle) return;
      openSheet = null;
      root.innerHTML = "";
      document.removeEventListener("keydown", onKey, true);
      if (!silent && onClose) onClose();
    };
    const onKey = (e) => e.key === "Escape" && (e.stopPropagation(), close());
    document.addEventListener("keydown", onKey, true);
    scrim.addEventListener("click", (e) => e.target === scrim && close());
    const handle = { el: $(".sheet", scrim), close };
    openSheet = handle;
    return { el: handle.el, close: () => close() };
  }

  function actionSheet(title, actions) {
    return new Promise((res) => {
      const s = sheet(
        `${title ? `<h3>${esc(title)}</h3>` : ""}<div class="group actions">${actions
          .map((a, i) => `<button class="row ${a.danger ? "danger" : ""}" data-i="${i}">${esc(a.label)}</button>`)
          .join("")}</div><div class="group actions"><button class="row" data-i="-1">Cancel</button></div>`,
        { onClose: () => res(null) }
      );
      $$("[data-i]", s.el).forEach((b) =>
        b.addEventListener("click", () => {
          const i = +b.dataset.i;
          s.close();
          if (i >= 0) actions[i].run();
          res(i);
        })
      );
    });
  }

  // ---------- media ----------
  const mediaUrls = {};
  async function hydrate(el) {
    for (const img of $$("img", el)) {
      const src = img.getAttribute("src") || "";
      if (!src || /^(https?:|data:|blob:)/.test(src)) continue;
      const name = decodeURIComponent(src);
      if (!mediaUrls[name]) {
        const blob = await Store.getMedia(name).catch(() => null);
        if (!blob) continue;
        mediaUrls[name] = URL.createObjectURL(blob);
      }
      img.src = mediaUrls[name];
    }
  }

  // ---------- routing ----------
  let cleanup = null;
  function route() {
    if (cleanup) cleanup(), (cleanup = null);
    if (openSheet) openSheet.close(true);
    const [, name = "decks", arg = ""] = location.hash.match(/^#\/([^/]*)\/?(.*)$/) || [];
    const deck = decodeURIComponent(arg);
    document.body.classList.toggle("studying", name === "study" || name === "quiz" || name === "guide");
    const tab = { deck: "decks", study: "decks", quiz: "drill", guide: "drill" }[name] || name;
    $$("#tabs button").forEach((b) => (b.dataset.tab === tab ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    window.scrollTo(0, 0);
    if (!db) return;
    if (name === "deck" && tree().map[deck]) return renderOverview(deck);
    if (name === "study" && tree().map[deck]) return renderStudy(deck);
    if (name === "browse") return renderBrowse(deck);
    if (name === "stats") return renderStats();
    if (name === "settings") return renderSettings();
    if (name === "drill") return renderDrill(deck);
    if (name === "quiz") return renderQuiz();
    if (name === "guide") return renderGuide(deck);
    renderDecks();
  }
  const go = (h) => (location.hash === h ? route() : (location.hash = h));
  $$("#tabs button").forEach((b) => b.addEventListener("click", () => go("#/" + b.dataset.tab)));
  window.addEventListener("hashchange", route);

  // ---------- decks ----------
  function countsHtml(c) {
    const z = (v, cls) => `<span class="${v ? cls : "z"}">${v}</span>`;
    return `<div class="counts">${z(c.n, "n")}${z(c.l, "l")}${z(c.r, "r")}</div>`;
  }

  function renderDecks() {
    const t = tree();
    const expanded = new Set(pref.get("expanded", []));
    const t0 = now();
    const rows = [];
    const walk = (node, depth) => {
      const has = node.children.length > 0;
      const open = expanded.has(node.name);
      const c = Col.counts(db, node, t0);
      rows.push(`<div class="row deck ${depth ? "" : "top"}" style="--depth:${depth}" data-deck="${esc(node.name)}" role="button" tabindex="0">
        <button class="twisty ${has ? "" : "none"}" aria-expanded="${open}" aria-label="${open ? "Collapse" : "Expand"} ${esc(node.label)}" data-tw="${esc(node.name)}">${ICON.twisty}</button>
        <div class="label"><div class="t">${esc(node.label)}</div></div>${countsHtml(c)}</div>`);
      if (has && open) node.children.forEach((ch) => walk(ch, depth + 1));
    };
    t.children.forEach((n) => walk(n, 0));
    const all = { n: 0, l: 0, r: 0 };
    t.children.forEach((n) => { const c = Col.counts(db, n, t0); all.n += c.n; all.l += c.l; all.r += c.r; });
    const due = all.l + all.r;
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    view.innerHTML = `
      <div class="head"><div><h1>Decks</h1><div class="sub">${
        t.children.length ? (due || all.n ? `${due} due · ${all.n} new today` : "All caught up for today") : "No cards yet"
      }</div></div>
      <button class="icon-btn" id="add" aria-label="Add card">${ICON.plus}</button></div>
      ${!standalone && !pref.get("hideInstall", false) && /iPhone|iPad|Android/.test(navigator.userAgent) ? `
        <div class="group"><div class="row"><div class="label"><div class="t"><b>Install on your phone</b></div>
        <div class="s" style="white-space:normal">${/Android/.test(navigator.userAgent) ? "Menu ⋮ → Add to Home screen" : "Share → Add to Home Screen"}, then always study from the icon. It works offline and your progress is protected there (the browser tab keeps separate data).</div></div>
        <button class="tbtn" id="hide-install" aria-label="Dismiss">${ICON.close}</button></div></div>` : ""}
      ${t.children.length ? `<div class="group">${rows.join("")}</div>
        <p class="small center">Tap a deck to study · <span style="color:var(--new)">new</span> · <span style="color:var(--learn)">learning</span> · <span style="color:var(--due)">due</span></p>` : `
        <div class="group"><div class="done center"><div class="mark">No decks yet</div>Import an Anki <b>.apkg</b> or text file in Settings, or add a card with +.</div></div>
        <button class="btn" onclick="location.hash='#/settings'">Import a deck</button>`}`;
    $$("[data-tw]", view).forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const n = b.dataset.tw;
        expanded.has(n) ? expanded.delete(n) : expanded.add(n);
        pref.set("expanded", [...expanded]);
        const y = window.scrollY;
        renderDecks();
        window.scrollTo(0, y);
      })
    );
    $$("[data-deck]", view).forEach((r) => {
      const open = () => go("#/deck/" + enc(r.dataset.deck));
      r.addEventListener("click", open);
      r.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open()));
    });
    $("#add", view).addEventListener("click", () => editCard(null));
    const hide = $("#hide-install", view);
    hide && hide.addEventListener("click", () => (pref.set("hideInstall", true), renderDecks()));
  }

  // ---------- deck overview ----------
  function renderOverview(name) {
    const node = tree().map[name];
    const c = Col.counts(db, node, now());
    const keys = Col.allKeys(node);
    const parent = name.includes("::") ? name.slice(0, name.lastIndexOf("::")).split("::").join(" › ") : "";
    const nothing = !c.n && !c.l && !c.r;
    const nx = nothing ? null : Col.next(db, node, now());
    view.innerHTML = `
      <div class="bar"><button class="back" id="back">${ICON.back}Decks</button><div class="grow"></div>
        <button class="tbtn" id="more" aria-label="Deck options">${ICON.more}</button></div>
      <div class="overview">
        ${parent ? `<div class="path">${esc(parent)}</div>` : ""}
        <h2>${esc(node.label)}</h2>
        <div class="small">${keys.length} card${keys.length === 1 ? "" : "s"}${node.children.length ? ` · ${node.children.length} subdeck${node.children.length === 1 ? "" : "s"}` : ""}</div>
        <div class="big-counts">
          <div class="n"><b>${c.n}</b><small>New</small></div>
          <div class="l"><b>${c.l}</b><small>Learning</small></div>
          <div class="r"><b>${c.r}</b><small>To review</small></div>
        </div>
        ${nothing ? `<div class="done"><div class="mark">Done for today</div>You've finished this deck for now.<br>Come back tomorrow — or study extra new cards.</div>` : ""}
      </div>
      ${nothing || (nx && nx.wait) ? "" : `<button class="btn" id="study">Study Now</button>`}
      ${nx && nx.wait ? `<div class="done center">Next learning card in ${Sched.fmtMs(nx.wait)}</div>` : ""}
      <button class="btn secondary" id="extra">Study extra new cards</button>
      <button class="btn secondary" id="browse">Browse cards</button>`;
    $("#back").addEventListener("click", () => go("#/decks"));
    const st = $("#study");
    st && st.addEventListener("click", () => go("#/study/" + enc(name)));
    $("#browse").addEventListener("click", () => go("#/browse/" + enc(`deck:"${name}"`)));
    $("#extra").addEventListener("click", () =>
      actionSheet("Extra new cards today", [5, 10, 20, 50].map((n) => ({
        label: `+${n} new cards`,
        run: () => {
          db.daily.n[name] = (db.daily.n[name] || 0) - n;
          save();
          renderOverview(name);
          toast(`+${n} new cards available today`);
        },
      })))
    );
    $("#more").addEventListener("click", () =>
      actionSheet(node.label, [
        { label: "Add card to this deck", run: () => editCard(null, name) },
        { label: "Rename deck", run: () => renameDeck(name) },
        { label: "Reset progress in this deck", danger: true, run: () => {
          if (!confirm(`Forget all progress for ${keys.length} cards in “${node.label}”? They become new cards again.`)) return;
          keys.forEach((k) => Col.forget(db, k));
          save({ now: true });
          renderOverview(name);
        } },
        { label: "Delete deck", danger: true, run: () => {
          if (!confirm(`Delete “${node.label}” and its ${keys.length} cards from this phone?`)) return;
          Col.removeDeck(db, name);
          dirtyTree();
          save({ cards: true, now: true });
          go("#/decks");
        } },
      ])
    );
  }

  function renameDeck(name) {
    const to = (prompt("Deck name (use :: for subdecks)", name) || "").trim();
    if (!to || to === name) return;
    Col.renameDeck(db, name, to);
    dirtyTree();
    save({ cards: true });
    go("#/deck/" + enc(to));
  }

  // ---------- study ----------
  function renderStudy(name) {
    const node = tree().map[name];
    const S = { sess: { sinceNew: 0 }, cur: null, shown: false, undo: [], t0: 0, done: 0, timer: null };
    view.innerHTML = `<div class="study">
      <div class="study-top">
        <button class="tbtn" id="close" aria-label="Close">${ICON.close}</button>
        <button class="tbtn" id="undo" aria-label="Undo" disabled>${ICON.undo}</button>
        <div class="counts" id="c"></div>
        <button class="tbtn" id="edit" aria-label="Edit card">${ICON.edit}</button>
        <button class="tbtn" id="menu" aria-label="More">${ICON.more}</button>
      </div>
      <div class="progress"><i id="p"></i></div>
      <div class="stage" id="stage"></div>
      <div class="answers" id="answers"></div>
    </div>`;
    const stage = $("#stage"), answers = $("#answers");

    function counts() {
      const c = Col.counts(db, node, now());
      const cur = S.cur ? S.cur.kind : null;
      $("#c").innerHTML = `<span class="n ${cur === "n" ? "cur" : ""}">${c.n}</span><span class="l ${cur === "l" ? "cur" : ""}">${c.l}</span><span class="r ${cur === "r" ? "cur" : ""}">${c.r}</span>`;
      const left = c.n + c.l + c.r;
      $("#p").style.width = (S.done + left ? (100 * S.done) / (S.done + left) : 100) + "%";
      $("#undo").disabled = !S.undo.length;
      $("#edit").disabled = $("#menu").disabled = !S.cur;
    }

    function next() {
      clearInterval(S.timer);
      const nx = Col.next(db, node, now(), S.sess);
      S.shown = false;
      if (!nx) return finished();
      if (nx.wait) return waiting(nx.wait);
      S.cur = nx;
      show();
    }

    function show() {
      const card = db.cards[S.cur.k];
      const deckLabel = card.d === name ? "" : card.d.slice(name.length + 2).split("::").join(" › ");
      stage.innerHTML = `${deckLabel ? `<div class="deckname">${esc(deckLabel)}</div>` : ""}<div class="card flash">${S.shown ? card.a : card.q}</div>`;
      hydrate(stage);
      if (S.shown) {
        const hr = $("hr#answer", stage);
        stage.scrollTop = hr ? Math.max(0, hr.offsetTop - 80) : 0;
        const p = Col.previews(db, S.cur.k, now());
        answers.innerHTML = `<div class="grid">${["Again", "Hard", "Good", "Easy"]
          .map((l, i) => `<button class="ans b${i + 1}" data-b="${i + 1}"><small>${p[i]}</small>${l}</button>`)
          .join("")}</div>`;
        $$("[data-b]", answers).forEach((b) => b.addEventListener("click", () => answer(+b.dataset.b)));
      } else {
        stage.scrollTop = 0;
        S.t0 = now();
        answers.innerHTML = `<button class="btn reveal" id="reveal">Show Answer</button>`;
        $("#reveal").addEventListener("click", reveal);
      }
      counts();
    }

    function reveal() {
      if (!S.cur || S.shown) return;
      S.shown = true;
      show();
    }

    async function answer(b) {
      if (!S.cur || !S.shown) return;
      const k = S.cur.k;
      const tagsBefore = db.cards[k].t.length;
      const rec = Col.answer(db, k, b, now(), now() - S.t0, S.sess);
      rec.kind = S.cur.kind;
      S.undo.push(rec);
      if (S.undo.length > 30) S.undo.shift();
      S.done++;
      const log = db.revlog[db.revlog.length - 1];
      Store.addLog(log).catch(() => {});
      if (db.cards[k].t.length !== tagsBefore) toast("Leech — this card keeps slipping. Tagged “leech”.");
      save({ cards: db.cards[k].t.length !== tagsBefore });
      askPersist();
      next();
    }

    function undo() {
      const rec = S.undo.pop();
      if (!rec) return;
      if (!rec.noLog) {
        const log = [...db.revlog].reverse().find((r) => r.k === rec.k);
        if (log && log.id != null) Store.deleteLog(log.id).catch(() => {});
        S.done = Math.max(0, S.done - 1);
      }
      Col.undo(db, rec, S.sess);
      save({ cards: true });
      S.cur = { k: rec.k, kind: rec.kind || (rec.st.type === 0 ? "n" : rec.st.type === 2 ? "r" : "l") };
      S.shown = false;
      clearInterval(S.timer);
      show();
      toast("Undone");
    }

    function finished() {
      S.cur = null;
      stage.innerHTML = `<div class="done center" style="padding-top:18vh"><div class="mark">Congratulations!</div>
        You've finished “${esc(node.label)}” for now.<br><span class="small">${S.done} card${S.done === 1 ? "" : "s"} this session.</span></div>`;
      answers.innerHTML = `<button class="btn" id="fin">Done</button>`;
      $("#fin").addEventListener("click", () => go("#/decks"));
      counts();
    }

    function waiting(ms) {
      S.cur = null;
      const end = now() + ms;
      const tick = () => {
        const left = end - now();
        if (left <= 0) return next();
        const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
        const el = $("#wait-t");
        if (el) el.textContent = `${m}:${String(s).padStart(2, "0")}`;
      };
      stage.innerHTML = `<div class="wait"><div class="muted">Learning cards are resting.</div><b id="wait-t"></b><div class="small">The next one comes back automatically. You can leave — it'll wait.</div></div>`;
      answers.innerHTML = `<button class="btn secondary" id="fin">Back to decks</button>`;
      $("#fin").addEventListener("click", () => go("#/decks"));
      tick();
      S.timer = setInterval(tick, 1000);
      counts();
    }

    function menu() {
      if (!S.cur) return;
      const k = S.cur.k;
      const marked = db.cards[k].t.includes("marked");
      actionSheet(null, [
        { label: "Bury card (hide until tomorrow)", run: () => { S.undo.push(Object.assign(Col.bury(db, k, now()), { kind: S.cur.kind })); save(); toast("Buried until tomorrow"); next(); } },
        { label: "Suspend card", run: () => { S.undo.push(Object.assign(Col.setSuspended(db, k, true), { kind: S.cur.kind })); save(); toast("Suspended — unsuspend in Browse"); next(); } },
        { label: marked ? "Unmark card" : "Mark card", run: () => { const t = db.cards[k].t; marked ? t.splice(t.indexOf("marked"), 1) : t.push("marked"); save({ cards: true }); toast(marked ? "Unmarked" : "Marked — find it in Browse"); } },
        { label: "Card info", run: () => cardInfo(k) },
      ]);
    }

    $("#close").addEventListener("click", () => go("#/deck/" + enc(name)));
    $("#undo").addEventListener("click", undo);
    $("#menu").addEventListener("click", menu);
    $("#edit").addEventListener("click", () => S.cur && editCard(S.cur.k, null, () => show()));
    stage.addEventListener("click", (e) => {
      if (e.target.closest("a, details, summary, audio, video")) return;
      if (S.cur && !S.shown) reveal();
    });

    const onKey = (e) => {
      if ($("#sheet-root").children.length || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest("input, textarea, [contenteditable]")) return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); S.shown ? answer(3) : reveal(); }
      else if (/^[1-4]$/.test(e.key) && S.shown) answer(+e.key);
      else if (e.key === "z" || e.key === "u") undo();
      else if (e.key === "e" && S.cur) editCard(S.cur.k, null, () => show());
      else if (e.key === "Escape") go("#/deck/" + enc(name));
    };
    document.addEventListener("keydown", onKey);
    cleanup = () => { document.removeEventListener("keydown", onKey); clearInterval(S.timer); save({ now: true }); };
    next();
  }

  let persistAsked = false;
  function askPersist() {
    if (persistAsked || !navigator.storage || !navigator.storage.persist) return;
    persistAsked = true;
    navigator.storage.persist().catch(() => {});
  }

  // ---------- card editor ----------
  const HR = /<hr id=["']?answer["']?\s*\/?>/i;
  function splitCard(card) {
    const m = card.a.match(HR);
    return { front: card.q, back: m ? card.a.slice(m.index + m[0].length).trim() : card.a };
  }

  function editCard(k, deckName, onSaved) {
    const isNew = !k;
    const card = k ? db.cards[k] : null;
    const { front, back } = card ? splitCard(card) : { front: "", back: "" };
    const decks = Object.keys(tree().map);
    const deck = card ? card.d : deckName || pref.get("lastDeck", decks[0] || "My Deck");
    let added = 0;
    const s = sheet(`
      <h3>${isNew ? "Add card" : "Edit card"}</h3>
      <div class="editor-label">Deck</div>
      <input class="text-input" id="e-deck" list="e-decks" value="${esc(deck)}" autocomplete="off" autocapitalize="words">
      <datalist id="e-decks">${decks.map((d) => `<option value="${esc(d)}">`).join("")}</datalist>
      <div class="editor-label">Front</div>
      <div class="editable" id="e-front" contenteditable="true">${front}</div>
      <div class="editor-label">Back</div>
      <div class="editable" id="e-back" contenteditable="true">${back}</div>
      ${!isNew && card.src && card.src.startsWith("bundle:") ? `<p class="small">Edits stay on this phone — later deck updates won't overwrite an edited card.</p>` : ""}
      <div style="height:14px"></div>
      <button class="btn" id="e-save">${isNew ? "Add" : "Save"}</button>
      ${isNew ? "" : `<button class="btn secondary" id="e-more">More…</button>`}
      <button class="btn secondary" id="e-cancel">${isNew ? "Done" : "Cancel"}</button>`, { onClose: () => added && !onSaved && route() });
    const f = $("#e-front", s.el), b = $("#e-back", s.el), d = $("#e-deck", s.el);
    if (isNew) setTimeout(() => f.focus(), 50);
    const clean = (el) => el.innerHTML.replace(/^(<br>)+|(<br>)+$/g, "").trim();
    $("#e-save", s.el).addEventListener("click", () => {
      const q = clean(f), bk = clean(b), dn = d.value.trim().replace(/\s*::\s*/g, "::") || "My Deck";
      if (!plain(q) && !/<img/i.test(q)) return toast("The front can't be empty");
      const a = `${q}\n\n<hr id=answer>\n\n${bk}`;
      if (isNew) {
        Col.addCard(db, { k: "u" + now().toString(36) + Math.random().toString(36).slice(2, 6), d: dn, q, a, t: [], src: "local" });
        pref.set("lastDeck", dn);
        added++;
        f.innerHTML = b.innerHTML = "";
        f.focus();
        toast("Added to " + dn.split("::").pop());
      } else {
        Object.assign(card, { q, a, d: dn, edited: true });
        s.close();
        toast("Saved");
      }
      dirtyTree();
      save({ cards: true });
      onSaved && onSaved();
    });
    $("#e-cancel", s.el).addEventListener("click", s.close);
    const more = $("#e-more", s.el);
    more && more.addEventListener("click", () => { s.close(); cardActions(k, onSaved); });
  }

  function cardActions(k, onChanged) {
    const st = db.st[k];
    const susp = st.queue === -1;
    actionSheet(null, [
      { label: "Card info", run: () => cardInfo(k) },
      { label: susp ? "Unsuspend" : "Suspend", run: () => { Col.setSuspended(db, k, !susp); save(); toast(susp ? "Unsuspended" : "Suspended"); onChanged && onChanged(); } },
      { label: "Reset to new", run: () => { Col.forget(db, k); save(); toast("Reset to new"); onChanged && onChanged(); } },
      { label: "Delete card", danger: true, run: () => {
        if (!confirm("Delete this card from this phone?")) return;
        Col.removeCard(db, k); dirtyTree(); save({ cards: true, now: true }); toast("Deleted"); onChanged && onChanged(true);
      } },
    ]);
  }

  function stateLabel(k) {
    const s = db.st[k], day = Col.today(db, now());
    const q = Col.queueOf(s, day);
    if (q === -1) return `<span class="pill s">suspended</span>`;
    if (q === -2) return `<span class="pill s">buried</span>`;
    if (s.type === 0) return `<span class="pill n">new</span>`;
    if (s.type !== 2) return `<span class="pill l">learning</span>`;
    const d = s.due - day;
    return `<span class="pill r">${d <= 0 ? "due" : "in " + Sched.fmtIvl(d)}</span>`;
  }

  function cardInfo(k) {
    const s = db.st[k], c = db.cards[k];
    const logs = db.revlog.filter((r) => r.k === k);
    const day = Col.today(db, now());
    const rows = [
      ["Deck", esc(c.d.split("::").join(" › "))],
      ["Status", stateLabel(k)],
      s.type === 2 ? ["Interval", Sched.fmtIvl(s.ivl)] : null,
      s.type === 2 ? ["Due", s.due <= day ? "today" : new Date(Sched.dayStart(s.due)).toLocaleDateString()] : null,
      s.type ? ["Ease", Math.round(s.ease / 10) + "%"] : null,
      ["Reviews", s.reps],
      ["Lapses", s.lapses],
      c.t.length ? ["Tags", esc(c.t.join(" "))] : null,
    ].filter(Boolean);
    sheet(`<h3>Card info</h3><div class="group">${rows.map(([a, b]) => `<div class="row"><div class="label">${a}</div><div class="val">${b}</div></div>`).join("")}</div>
      ${logs.length ? `<div class="group-title">History</div><div class="group">${logs.slice(-12).reverse().map((r) =>
        `<div class="row"><div class="label">${new Date(r.t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
        <div class="val" style="color:var(--${["", "again", "hard", "good", "easy"][r.b]})">${["", "Again", "Hard", "Good", "Easy"][r.b]}</div></div>`).join("")}</div>` : ""}`);
  }

  // ---------- browse ----------
  const CHIPS = [["All", ""], ["Due", "is:due"], ["New", "is:new"], ["Learning", "is:learn"], ["Marked", "tag:marked"], ["Suspended", "is:suspended"], ["Leech", "tag:leech"]];
  function renderBrowse(initial) {
    let query = initial || pref.get("browseQ", "");
    let limit = 100;
    view.innerHTML = `
      <div class="head"><div><h1>Browse</h1><div class="sub" id="b-count"></div></div>
        <button class="icon-btn" id="add" aria-label="Add card">${ICON.plus}</button></div>
      <div class="search"><input id="q" type="search" placeholder="Search cards, deck:, tag:" value="${esc(query)}" autocomplete="off" autocapitalize="off" spellcheck="false">
        <div class="chips">${CHIPS.map(([l, q]) => `<button data-q="${esc(q)}">${l}</button>`).join("")}</div></div>
      <div id="results"></div>`;
    const input = $("#q"), results = $("#results");
    const draw = () => {
      pref.set("browseQ", query);
      $$(".chips button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.q === query.trim()));
      const order = Object.keys(tree().map).sort();
      const idx = Object.fromEntries(order.map((d, i) => [d, i]));
      const keys = Col.search(db, query, now()).sort((a, b) => idx[db.cards[a].d] - idx[db.cards[b].d] || db.st[a].pos - db.st[b].pos);
      $("#b-count").textContent = `${keys.length} card${keys.length === 1 ? "" : "s"}`;
      results.innerHTML = keys.length
        ? `<div class="group">${keys.slice(0, limit).map((k) => {
            const c = db.cards[k];
            return `<button class="row" data-k="${esc(k)}"><div class="label"><div class="t">${esc(plain(c.q)) || "<i>(image)</i>"}</div>
              <div class="s">${stateLabel(k)}${esc(c.d.split("::").pop())}</div></div>${ICON.chev}</button>`;
          }).join("")}</div>${keys.length > limit ? `<button class="btn secondary" id="more-r">Show more (${keys.length - limit} left)</button>` : ""}`
        : `<div class="done center">No cards match.</div>`;
      $$("[data-k]", results).forEach((r) => r.addEventListener("click", () => editCard(r.dataset.k, null, () => draw())));
      const m = $("#more-r");
      m && m.addEventListener("click", () => ((limit += 200), draw()));
    };
    let deb;
    input.addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(() => ((query = input.value), (limit = 100), draw()), 150); });
    $$(".chips button").forEach((b) => b.addEventListener("click", () => { query = input.value = b.dataset.q; limit = 100; draw(); }));
    $("#add").addEventListener("click", () => editCard(null, null, () => draw()));
    draw();
  }

  // ---------- stats ----------
  function renderStats() {
    const s = Col.stats(db, now());
    const mins = Math.round(s.today.ms / 60000);
    const bt = s.byType;
    const total = Object.values(bt).reduce((a, b) => a + b, 0) || 1;
    const seg = [["New", bt.new, "var(--new)"], ["Learning", bt.learning, "var(--learn)"], ["Young", bt.young, "color-mix(in srgb, var(--due) 55%, var(--surface))"], ["Mature", bt.mature, "var(--due)"], ["Suspended", bt.suspended, "var(--hard)"]];
    const fc = s.forecast.slice(0, 14);
    const fmax = Math.max(1, ...fc);
    const day = Col.today(db, now());
    const hist = new Array(14).fill(0);
    for (const r of db.revlog) {
      const d = day - Sched.dayNum(r.t, Col.cfgOf(db).rolloverHour);
      if (d >= 0 && d < 14) hist[13 - d]++;
    }
    const hmax = Math.max(1, ...hist);
    const bars = (arr, max, color) => `<div class="bars">${arr.map((v) => `<div class="${v ? "" : "zero"}" style="height:${Math.max(2, (100 * v) / max)}%;${color ? "background:" + color : ""}" title="${v}"></div>`).join("")}</div>`;
    view.innerHTML = `
      <div class="head"><div><h1>Stats</h1><div class="sub">${s.total} cards</div></div></div>
      <div class="tiles">
        <div class="tile"><b>${s.today.count}</b><small>studied today${mins ? ` · ${mins} min` : ""}</small></div>
        <div class="tile"><b>${s.streak}</b><small>day streak</small></div>
        <div class="tile"><b>${s.retention == null ? "—" : Math.round(s.retention * 100) + "%"}</b><small>review retention, 30 days${s.retentionN ? ` (${s.retentionN})` : ""}</small></div>
        <div class="tile"><b>${s.today.count ? Math.round((100 * (s.today.count - s.today.again)) / s.today.count) + "%" : "—"}</b><small>correct today</small></div>
      </div>
      <div class="group-title">Cards</div>
      <div class="chart">
        <div class="stack">${seg.map(([, v, c]) => (v ? `<i style="width:${(100 * v) / total}%;background:${c}"></i>` : "")).join("")}</div>
        <div class="legend">${seg.map(([l, v, c]) => `<span><i style="background:${c}"></i>${l}<em>${v}</em></span>`).join("")}</div>
      </div>
      <div class="group-title">Due next 14 days</div>
      <div class="chart">${bars(fc, fmax)}<div class="axis"><span>Today (${fc[0]})</span><span>+7d</span><span>+13d</span></div></div>
      <div class="group-title">Reviews, last 14 days</div>
      <div class="chart">${bars(hist, hmax, "var(--accent)")}<div class="axis"><span>−13d</span><span>−7d</span><span>Today</span></div></div>`;
  }

  // ---------- settings ----------
  function renderSettings() {
    const cfg = Col.cfgOf(db);
    const theme = pref.get("appTheme", "dark"), size = pref.get("size", "m");
    const bundleDate = Object.entries(db.bundles).map(([id, v]) => `${id}: ${new Date(v * 1000).toLocaleDateString()}`).join(" · ");
    view.innerHTML = `
      <div class="head"><div><h1>Settings</h1></div></div>
      <div class="group-title">Daily limits (per deck)</div>
      <div class="group">
        <div class="field"><label for="s-new">New cards/day</label><input id="s-new" type="number" inputmode="numeric" min="0" max="9999" value="${cfg.newPerDay}"></div>
        <div class="field"><label>New card order<small>Random mixes all subdecks</small></label><div class="seg" id="s-order">${[["deck", "In order"], ["random", "Random"]].map(([v, l]) => `<button data-v="${v}" aria-pressed="${cfg.newOrder === v}">${l}</button>`).join("")}</div></div>
        <div class="field"><label for="s-rev">Maximum reviews/day</label><input id="s-rev" type="number" inputmode="numeric" min="0" max="99999" value="${cfg.revPerDay}"></div>
      </div>
      <div class="group-title">Scheduling</div>
      <div class="group">
        <div class="field"><label for="s-ls">Learning steps<small>minutes, space-separated</small></label><input id="s-ls" type="text" value="${cfg.learnSteps.join(" ")}"></div>
        <div class="field"><label for="s-rs">Relearning steps<small>minutes</small></label><input id="s-rs" type="text" value="${cfg.relearnSteps.join(" ")}"></div>
        <div class="field"><label for="s-gi">Graduating interval<small>days</small></label><input id="s-gi" type="number" inputmode="numeric" min="1" value="${cfg.gradIvl}"></div>
        <div class="field"><label for="s-ei">Easy interval<small>days</small></label><input id="s-ei" type="number" inputmode="numeric" min="1" value="${cfg.easyIvl}"></div>
        <div class="field"><label for="s-ro">Next day starts at<small>hour, 0–23</small></label><input id="s-ro" type="number" inputmode="numeric" min="0" max="23" value="${cfg.rolloverHour}"></div>
      </div>
      <div class="group-title">Display</div>
      <div class="group">
        <div class="field"><label>Theme</label><div class="seg" id="s-theme">${[["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]].map(([v, l]) => `<button data-v="${v}" aria-pressed="${theme === v}">${l}</button>`).join("")}</div></div>
        <div class="field"><label>Card text</label><div class="seg" id="s-size">${[["s", "Small"], ["m", "Medium"], ["l", "Large"]].map(([v, l]) => `<button data-v="${v}" aria-pressed="${size === v}">${l}</button>`).join("")}</div></div>
      </div>
      <div class="group-title">Decks</div>
      <div class="group">
        <button class="row" id="s-import"><div class="label"><div class="t">Import deck file</div><div class="s">Anki .apkg / .colpkg, text .txt / .csv, or .json</div></div>${ICON.chev}</button>
        <button class="row" id="s-update"><div class="label"><div class="t">Check for deck updates</div><div class="s">${bundleDate ? "Installed " + esc(bundleDate) : "Built-in decks"}</div></div>${ICON.chev}</button>
      </div>
      <input type="file" id="s-file" accept=".apkg,.colpkg,.txt,.csv,.tsv,.json" hidden>
      <div class="group-title">Backup</div>
      <div class="group">
        <button class="row" id="s-backup"><div class="label"><div class="t">Export backup</div><div class="s">All cards, progress and history as one file</div></div>${ICON.chev}</button>
        <button class="row" id="s-restore"><div class="label"><div class="t">Restore backup</div><div class="s">Replaces everything on this phone</div></div>${ICON.chev}</button>
        <div class="field"><label>Storage<small id="s-persist">checking…</small></label></div>
      </div>
      <input type="file" id="s-rfile" accept=".json,application/json" hidden>
      <div class="group-title">Reset</div>
      <div class="group">
        <button class="row" id="s-forget" style="color:var(--again)"><div class="label">Reset all progress</div></button>
        <button class="row" id="s-wipe" style="color:var(--again)"><div class="label"><div class="t">Erase everything on this phone</div><div class="s">Built-in decks reinstall fresh on next launch</div></div></button>
      </div>
      <p class="small center">Recall · Anki-style SM-2 scheduling · data stays on this device</p>`;

    const num = (id, key, min, max) => $(id).addEventListener("change", (e) => {
      const v = Math.round(+e.target.value);
      if (!Number.isFinite(v) || v < min || v > max) return (e.target.value = Col.cfgOf(db)[key]), toast(`Enter ${min}–${max}`);
      db.cfg[key] = v;
      save();
      toast("Saved");
    });
    num("#s-new", "newPerDay", 0, 9999);
    num("#s-rev", "revPerDay", 0, 99999);
    num("#s-gi", "gradIvl", 1, 365);
    num("#s-ei", "easyIvl", 1, 365);
    num("#s-ro", "rolloverHour", 0, 23);
    const steps = (id, key) => $(id).addEventListener("change", (e) => {
      const v = e.target.value.trim().split(/[\s,]+/).map(Number);
      if (!v.length || v.some((x) => !(x > 0) || x > 1440 * 7)) return (e.target.value = Col.cfgOf(db)[key].join(" ")), toast("Use minutes, e.g. 1 10");
      db.cfg[key] = v;
      save();
      toast("Saved");
    });
    steps("#s-ls", "learnSteps");
    steps("#s-rs", "relearnSteps");
    const seg = (id, key) => $$(id + " button").forEach((b) => b.addEventListener("click", () => {
      pref.set(key, b.dataset.v);
      applyTheme();
      $$(id + " button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    }));
    $$("#s-order button").forEach((b) => b.addEventListener("click", () => {
      db.cfg.newOrder = b.dataset.v;
      save();
      $$("#s-order button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      toast(b.dataset.v === "random" ? "New cards will come in random order" : "New cards will come in order");
    }));
    seg("#s-theme", "appTheme");
    seg("#s-size", "size");

    $("#s-import").addEventListener("click", () => $("#s-file").click());
    $("#s-file").addEventListener("change", (e) => e.target.files[0] && importFile(e.target.files[0]).finally(() => (e.target.value = "")));
    $("#s-update").addEventListener("click", async () => {
      toast("Checking…");
      const r = await updateBundles(true);
      toast(r === null ? "Couldn't reach the server — try again online" : r ? `Updated: ${r}` : "Decks are up to date");
      renderSettings();
    });
    $("#s-backup").addEventListener("click", exportBackup);
    $("#s-restore").addEventListener("click", () => $("#s-rfile").click());
    $("#s-rfile").addEventListener("change", (e) => e.target.files[0] && restoreBackup(e.target.files[0]).finally(() => (e.target.value = "")));
    $("#s-forget").addEventListener("click", async () => {
      if (!confirm("Reset progress on every card? Cards stay; all become new and history is cleared.")) return;
      Object.keys(db.cards).forEach((k) => Col.forget(db, k));
      db.revlog = [];
      db.daily = { day: -1, n: {}, r: {} };
      await Store.replaceLogs([]);
      await save({ now: true });
      toast("Progress reset");
    });
    $("#s-wipe").addEventListener("click", async () => {
      if (!confirm("Erase ALL cards, progress and history from this phone? Export a backup first if unsure.")) return;
      await Store.wipe();
      drillState = emptyDrill();
      db = Col.create();
      db.bundles = {};
      dirtyTree();
      await save({ cards: true, now: true });
      toast("Everything erased");
      go("#/decks");
    });
    if (navigator.storage && navigator.storage.persisted) {
      Promise.all([navigator.storage.persisted(), navigator.storage.estimate ? navigator.storage.estimate() : {}]).then(([p, est]) => {
        const el = $("#s-persist");
        if (el) el.textContent = `${p ? "Protected from automatic clearing" : "Not yet protected — install to Home Screen"}${est.usage ? ` · ${(est.usage / 1048576).toFixed(1)} MB used` : ""}`;
      });
    } else $("#s-persist").textContent = "Saved on this device";
  }

  // ---------- drill (multiple-choice midterm banks) ----------
  // Banks live in drills/*.json (copied verbatim from the Midterm Drill pages); option 0 is correct.
  const emptyDrill = () => ({ best: {}, missed: {}, prefs: { count: "20", shuffle: true } });
  let drillState = emptyDrill();
  let drills = null; // { id: { id, title, sections, byId, total } }
  let quiz = null; // active session
  const saveDrill = () => Store.put("drill", drillState).catch(() => {});
  const shuffled = (a) => {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  async function loadDrills() {
    if (drills) return drills;
    const idx = await (await fetch("drills/index.json", { cache: "no-cache" })).json();
    const out = {};
    for (const d of idx.drills) {
      const j = await (await fetch("drills/" + d.file + "?v=" + d.version)).json();
      const byId = {};
      j.sections.forEach((s) => s.q.forEach((q, i) => {
        q.id = s.id + "-" + (i + 1);
        q.sid = s.id;
        q.stitle = s.title;
        byId[q.id] = q;
      }));
      out[d.id] = { id: d.id, title: j.title, sections: j.sections, byId, total: Object.keys(byId).length };
    }
    return (drills = out);
  }

  const dmissed = (did) => (drillState.missed[did] ||= {});
  const dbest = (did) => (drillState.best[did] ||= {});

  async function renderDrill(did) {
    if (!drills || !guides) {
      view.innerHTML = `<div class="head"><div><h1>Study</h1></div></div><div class="done center">Loading…</div>`;
      await loadGuides().catch(() => {});
      try { await loadDrills(); } catch { view.innerHTML = `<div class="head"><div><h1>Study</h1></div></div><div class="done center">Couldn't load the question banks. Open Recall once while online.</div>`; return; }
      if (!location.hash.startsWith("#/drill")) return;
    }
    const d = drills[did];
    if (!d) return renderDrillList();
    const missed = dmissed(did), best = dbest(did);
    const missedIds = Object.keys(missed).filter((id) => d.byId[id]);
    const p = drillState.prefs;
    const meta = (n, b, m) => `<div class="meta"><span class="pill">${n} q</span>${b != null ? `<span class="pill best">best ${b}%</span>` : ""}${m ? `<span class="pill miss">${m} missed</span>` : ""}</div>`;
    const rows = d.sections.map((s, i) => {
      const m = s.q.filter((q) => missed[q.id]).length;
      const head = `<button class="row drill-row" data-sec="${esc(s.id)}"><div class="label"><div class="small">SECTION ${String(i + 1).padStart(2, "0")}</div><div class="t">${esc(s.title)}</div><div class="s">${esc(s.covers || "")}</div>${meta(s.q.length, best[s.id], m)}</div>${ICON.chev}</button>`;
      const subs = (s.subs || []).map((sub) => {
        const qs = s.q.filter((q) => sub.srcs.includes(q.src));
        const sm = qs.filter((q) => missed[q.id]).length;
        return `<button class="row drill-row sub" data-sec="${esc(s.id)}" data-sub="${esc(sub.id)}"><div class="label"><div class="t">${esc(sub.title)}</div><div class="s">${esc(sub.covers || "")}</div>${meta(qs.length, best[sub.id], sm)}</div>${ICON.chev}</button>`;
      }).join("");
      return `<div class="group">${head}${subs}</div>`;
    }).join("");
    view.innerHTML = `
      <div class="bar"><button class="back" id="back">${ICON.back}Study</button></div>
      <div class="head" style="padding-top:4px"><div><h1>${esc(d.title)}</h1><div class="sub">${d.total} questions · ${d.sections.length} sections · multiple choice</div></div></div>
      <div class="group">
        <div class="field"><label>Questions</label><div class="seg" id="d-count">${["10", "20", "30", "all"].map((v) => `<button data-v="${v}" aria-pressed="${p.count === v}">${v === "all" ? "All" : v}</button>`).join("")}</div></div>
        <div class="field"><label>Shuffle question order</label><div class="seg" id="d-shuf">${[["on", "On"], ["off", "Off"]].map(([v, l]) => `<button data-v="${v}" aria-pressed="${(p.shuffle ? "on" : "off") === v}">${l}</button>`).join("")}</div></div>
      </div>
      ${missedIds.length ? `<button class="btn secondary miss-btn" id="d-miss" style="margin-bottom:18px">Drill all missed · ${missedIds.length}</button>` : ""}
      <div class="group"><button class="row drill-row mix" data-sec="__all"><div class="label"><div class="t">Full midterm mix</div><div class="s">Questions from every section — closest to the real exam.</div>${meta(d.total, best.__all, 0)}</div>${ICON.chev}</button></div>
      <div class="group-title">Sections</div>
      ${rows}
      <p class="small center">Answer choices are shuffled every time. Keys: 1–4 or A–D, Enter for next.</p>`;
    $("#back").addEventListener("click", () => go("#/drill"));
    $$("#d-count button").forEach((b) => b.addEventListener("click", () => { p.count = b.dataset.v; saveDrill(); $$("#d-count button").forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
    $$("#d-shuf button").forEach((b) => b.addEventListener("click", () => { p.shuffle = b.dataset.v === "on"; saveDrill(); $$("#d-shuf button").forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
    const mb = $("#d-miss");
    mb && mb.addEventListener("click", () => startQuiz(did, shuffled(missedIds.map((id) => d.byId[id])), "Missed questions", "__missed"));
    $$("[data-sec]", view).forEach((b) => b.addEventListener("click", () => {
      const sid = b.dataset.sec, subId = b.dataset.sub;
      let pool, title, key;
      if (sid === "__all") (pool = d.sections.flatMap((s) => s.q)), (title = "Full midterm mix"), (key = "__all");
      else {
        const s = d.sections.find((x) => x.id === sid);
        const sub = subId && s.subs.find((x) => x.id === subId);
        pool = sub ? s.q.filter((q) => sub.srcs.includes(q.src)) : s.q;
        title = sub ? sub.title : s.title;
        key = sub ? sub.id : s.id;
      }
      let list = p.shuffle || sid === "__all" ? shuffled(pool) : pool.slice();
      if (p.count !== "all") list = list.slice(0, +p.count);
      startQuiz(did, list, title, key);
    }));
  }

  function renderDrillList() {
    const list = Object.values(drills);
    view.innerHTML = `
      <div class="head"><div><h1>Study</h1><div class="sub">Tier 3 guides and midterm drills</div></div></div>
      ${guides && guides.length ? `<div class="group-title">Tier 3 study guides</div>
      <div class="group">${guides.map((g) => `<button class="row drill-row" data-g="${esc(g.id)}"><div class="label"><div class="t">${esc(g.title)}</div><div class="s">${esc(g.subtitle)}${g.stat ? " · " + esc(g.stat.split(" · ").slice(0, 2).join(" · ")) : ""}</div></div>${ICON.chev}</button>`).join("")}</div>` : ""}
      <div class="group-title">Midterm drills</div>
      <div class="group">${list.map((d) => {
        const m = Object.keys(dmissed(d.id)).filter((id) => d.byId[id]).length;
        const b = dbest(d.id).__all;
        return `<button class="row drill-row" data-d="${esc(d.id)}"><div class="label"><div class="t">${esc(d.title)}</div>
          <div class="meta"><span class="pill">${d.total} q</span><span class="pill">${d.sections.length} sections</span>${b != null ? `<span class="pill best">mix best ${b}%</span>` : ""}${m ? `<span class="pill miss">${m} missed</span>` : ""}</div></div>${ICON.chev}</button>`;
      }).join("")}</div>`;
    $$("[data-d]", view).forEach((b) => b.addEventListener("click", () => go("#/drill/" + enc(b.dataset.d))));
    $$("[data-g]", view).forEach((b) => b.addEventListener("click", () => go("#/guide/" + enc(b.dataset.g))));
  }

  // ---------- study guides (static pages shown in a frame) ----------
  let guides = null;
  async function loadGuides() {
    if (guides) return guides;
    const j = await (await fetch("guides/index.json", { cache: "no-cache" })).json();
    return (guides = j.guides);
  }

  async function renderGuide(id) {
    try { await loadGuides(); } catch { return toast("Couldn't load the guide — open Recall once while online"), go("#/drill"); }
    const g = guides.find((x) => x.id === id);
    if (!g) return go("#/drill");
    view.innerHTML = `<div class="study">
      <div class="study-top">
        <button class="tbtn" id="g-close" aria-label="Close guide">${ICON.close}</button>
        <div class="qcount" style="flex:1;text-align:center;font-weight:600">${esc(g.title)}</div>
        <button class="tbtn" id="g-top" aria-label="Back to top"><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
      </div>
      <iframe class="guide-frame" id="g-frame" title="${esc(g.title)} study guide" src="guides/${esc(g.file)}?v=${g.version}"></iframe>
    </div>`;
    const frame = $("#g-frame");
    const key = "guidePos." + id;
    let saveT;
    frame.addEventListener("load", () => {
      const w = frame.contentWindow, doc = frame.contentDocument;
      if (!w || !doc) return;
      const theme = pref.get("appTheme", "dark");
      if (theme !== "auto") doc.documentElement.setAttribute("data-theme", theme);
      const y = pref.get(key, 0);
      if (y) w.scrollTo(0, y);
      w.addEventListener("scroll", () => {
        clearTimeout(saveT);
        saveT = setTimeout(() => pref.set(key, Math.round(w.scrollY)), 250);
      }, { passive: true });
    });
    // Also save on leave/background: scroll events alone can be skipped when the app is hidden.
    const savePos = () => { try { const y = frame.contentWindow.scrollY; if (y >= 0) pref.set(key, Math.round(y)); } catch {} };
    const onHide = () => document.visibilityState === "hidden" && savePos();
    document.addEventListener("visibilitychange", onHide);
    cleanup = () => { savePos(); document.removeEventListener("visibilitychange", onHide); };
    $("#g-close").addEventListener("click", () => go("#/drill"));
    $("#g-top").addEventListener("click", () => frame.contentWindow && frame.contentWindow.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function startQuiz(did, list, title, key) {
    if (!list.length) return toast("No questions here");
    quiz = { did, key, title, i: 0, items: list.map((q) => ({ id: q.id, order: shuffled([0, 1, 2, 3]), pick: null })) };
    go("#/quiz");
  }

  function renderQuiz() {
    if (!quiz || !drills) return go("#/drill");
    const d = drills[quiz.did];
    view.innerHTML = `<div class="study">
      <div class="study-top quiz-top">
        <div class="row1"><button class="tbtn" id="q-close" aria-label="Back to sections">${ICON.close}</button>
          <div class="qcount" id="q-count"></div>
          <button class="tbtn" id="q-finish" aria-label="Finish and score">${ICON.more}</button></div>
        <div class="track" aria-hidden="true"><i class="g" id="q-g"></i><i class="r" id="q-r"></i></div>
      </div>
      <div class="stage" id="q-stage"></div>
      <div class="answers" id="q-actions"></div></div>`;
    const stage = $("#q-stage"), actions = $("#q-actions");

    function draw() {
      if (quiz.i >= quiz.items.length) return results();
      const it = quiz.items[quiz.i], q = d.byId[it.id];
      const done = it.pick !== null;
      const ok = quiz.items.filter((x) => x.pick !== null && x.order[x.pick] === 0).length;
      const bad = quiz.items.filter((x) => x.pick !== null && x.order[x.pick] !== 0).length;
      const n = quiz.items.length;
      $("#q-count").textContent = `Q ${quiz.i + 1} / ${n} · ${ok} right · ${bad} wrong`;
      $("#q-g").style.width = (100 * ok) / n + "%";
      $("#q-r").style.width = (100 * bad) / n + "%";
      const right = done && it.order[it.pick] === 0;
      stage.innerHTML = `<div class="flash" style="max-width:620px;margin:0 auto">
        <p class="qtag">${esc(q.stitle)} · ${esc(q.src)}</p>
        <p class="stem">${esc(q.q)}</p>
        <div class="opts">${it.order.map((oi, pos) => {
          let cls = "opt";
          if (done) cls += oi === 0 ? " correct" : pos === it.pick ? " wrong" : " dim";
          return `<button class="${cls}" data-pos="${pos}" ${done ? "disabled" : ""}><span class="k">${"ABCD"[pos]}</span><span class="t">${esc(q.o[oi])}</span></button>`;
        }).join("")}</div>
        ${done ? `<div class="fb ${right ? "" : "bad"}" role="status"><p class="verdict">${right ? "Correct" : "Incorrect — the answer is " + "ABCD"[it.order.indexOf(0)]}</p><p>${esc(q.e)}</p><p class="src">${esc(q.src)}</p></div>` : ""}
      </div>`;
      stage.scrollTop = 0;
      actions.innerHTML = done
        ? `<button class="btn" id="q-next">${quiz.i + 1 < n ? "Next question" : "See my score"}</button>`
        : `<p class="small center" style="margin:10px 0">Tap an answer</p>`;
      $$(".opt", stage).forEach((b) => b.addEventListener("click", () => pick(+b.dataset.pos)));
      const nx = $("#q-next");
      nx && nx.addEventListener("click", next);
      if (done) { const fb = $(".fb", stage); fb && fb.scrollIntoView({ block: "nearest" }); }
    }

    function pick(pos) {
      const it = quiz.items[quiz.i];
      if (it.pick !== null) return;
      it.pick = pos;
      const m = dmissed(quiz.did);
      if (it.order[pos] === 0) delete m[it.id];
      else m[it.id] = 1;
      saveDrill();
      draw();
    }
    const next = () => { quiz.i++; draw(); };

    function results() {
      const items = quiz.items;
      const n = items.length;
      const ok = items.filter((x) => x.order[x.pick] === 0).length;
      const pct = n ? Math.round((ok / n) * 100) : 0;
      const best = dbest(quiz.did);
      if (quiz.key !== "__missed" && (best[quiz.key] == null || pct > best[quiz.key])) (best[quiz.key] = pct), saveDrill();
      const band = pct >= 80 ? ["ok", "Exam ready"] : pct >= 70 ? ["warn", "Close — drill the misses"] : ["bad", "Needs more review"];
      const wrong = items.filter((x) => x.order[x.pick] !== 0);
      const byMix = quiz.key === "__all" || quiz.key === "__missed";
      const groups = {};
      items.forEach((x) => {
        const q = d.byId[x.id], k = byMix ? q.stitle : q.src;
        (groups[k] ||= { n: 0, ok: 0 }).n++;
        if (x.order[x.pick] === 0) groups[k].ok++;
      });
      $("#q-count").textContent = quiz.title;
      $("#q-g").style.width = (100 * ok) / n + "%";
      $("#q-r").style.width = (100 * (n - ok)) / n + "%";
      stage.innerHTML = `<div style="max-width:620px;margin:0 auto">
        <div class="score"><b>${pct}%</b><div class="muted">${ok} of ${n} correct</div><span class="band ${band[0]}">${band[1]}</span></div>
        <div class="group-title">${byMix ? "By section" : "By topic"}</div>
        <div class="chart" style="display:grid;gap:8px">${Object.entries(groups).sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n).map(([k, g]) =>
          `<div class="trow"><span>${esc(k)}</span><span class="bar"><i style="width:${(100 * g.ok) / g.n}%"></i></span><span class="pct">${g.ok}/${g.n}</span></div>`).join("")}</div>
        ${wrong.length ? `<div class="group-title">Missed (${wrong.length})</div><div class="group">${wrong.map((x) => {
          const q = d.byId[x.id];
          return `<div class="mi"><p class="q">${esc(q.q)}</p><p class="a you">You: ${esc(q.o[x.order[x.pick]])}</p><p class="a right">Answer: ${esc(q.o[0])}</p><p class="x">${esc(q.e)}</p></div>`;
        }).join("")}</div>` : `<div class="done center">Perfect run — nothing missed.</div>`}
      </div>`;
      stage.scrollTop = 0;
      actions.innerHTML = `${wrong.length ? `<button class="btn" id="q-redo">Drill these ${wrong.length} again</button>` : ""}<button class="btn secondary" id="q-back">Back to sections</button>`;
      const redo = $("#q-redo");
      redo && redo.addEventListener("click", () => startQuiz(quiz.did, shuffled(wrong.map((x) => d.byId[x.id])), "Missed questions", "__missed"));
      $("#q-back").addEventListener("click", () => go("#/drill/" + enc(quiz.did)));
      quiz.i = n;
    }

    $("#q-close").addEventListener("click", () => go("#/drill/" + enc(quiz.did)));
    $("#q-finish").addEventListener("click", () => actionSheet(null, [
      { label: "Finish & score now", run: () => { quiz.items = quiz.items.filter((x) => x.pick !== null); if (!quiz.items.length) return go("#/drill/" + enc(quiz.did)); quiz.i = quiz.items.length; draw(); } },
      { label: "Quit without scoring", danger: true, run: () => go("#/drill/" + enc(quiz.did)) },
    ]));
    const onKey = (e) => {
      if ($("#sheet-root").children.length || e.metaKey || e.ctrlKey || e.altKey) return;
      const it = quiz && quiz.items[quiz.i];
      if (!it) return;
      const k = e.key.toLowerCase();
      const idx = "1234".indexOf(k) >= 0 ? "1234".indexOf(k) : "abcd".indexOf(k);
      if (it.pick === null && idx >= 0 && k.length === 1) pick(idx);
      else if (it.pick !== null && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); next(); }
    };
    document.addEventListener("keydown", onKey);
    cleanup = () => document.removeEventListener("keydown", onKey);
    draw();
  }

  // ---------- import / backup ----------
  async function importFile(file) {
    toast("Reading " + file.name + "…");
    let res;
    try {
      res = await Importer.readFile(file);
    } catch (e) {
      console.error(e);
      return toast(e.message || "Import failed");
    }
    if (!res.cards.length) return toast("No cards found in that file");
    const decks = new Set(res.cards.map((c) => c.d));
    const existing = res.cards.filter((c) => db.cards[c.k]).length;
    const nSched = Object.keys(res.states).length;
    const s = sheet(`<h3>Import ${esc(file.name)}</h3>
      <div class="group">
        <div class="row"><div class="label">Cards</div><div class="val">${res.cards.length}</div></div>
        <div class="row"><div class="label">Decks</div><div class="val">${decks.size}</div></div>
        <div class="row"><div class="label">Already here (content updated, progress kept)</div><div class="val">${existing}</div></div>
        ${Object.keys(res.media).length ? `<div class="row"><div class="label">Images / media</div><div class="val">${Object.keys(res.media).length}</div></div>` : ""}
        ${res.skipped ? `<div class="row"><div class="label">Skipped (empty or unsupported)</div><div class="val">${res.skipped}</div></div>` : ""}
      </div>
      ${nSched ? `<div class="group"><label class="field"><span style="flex:1">Include review progress from Anki<small class="small" style="display:block">${nSched} studied cards</small></span><input type="checkbox" id="i-sched" checked style="width:22px;height:22px"></label></div>` : ""}
      <div class="small" style="margin:-6px 4px 14px">${[...decks].slice(0, 6).map(esc).join(" · ")}${decks.size > 6 ? " …" : ""}</div>
      <button class="btn" id="i-go">Import</button><button class="btn secondary" id="i-cancel">Cancel</button>`);
    $("#i-cancel", s.el).addEventListener("click", s.close);
    $("#i-go", s.el).addEventListener("click", async () => {
      const cb = $("#i-sched", s.el);
      const states = cb && cb.checked ? res.states : {};
      const src = res.bundleId ? "bundle:" + res.bundleId : "import:" + file.name;
      const r = Col.merge(db, src, res.cards.map((c) => (db.cards[c.k] && db.cards[c.k].edited ? Object.assign({}, c, { q: db.cards[c.k].q, a: db.cards[c.k].a, edited: true }) : c)), { states });
      for (const [name, blob] of Object.entries(res.media)) await Store.putMedia(name, blob).catch(() => {});
      dirtyTree();
      await save({ cards: true, now: true });
      s.close();
      toast(`Imported: ${r.added} new, ${r.updated} updated`);
      go("#/decks");
    });
  }

  async function exportBackup() {
    const data = JSON.stringify({ app: "recall", v: 1, at: now(), drill: drillState, cards: db.cards, st: db.st, cfg: db.cfg, daily: db.daily, bundles: db.bundles, nextPos: db.nextPos, revlog: db.revlog.map(({ id, ...r }) => r) });
    const name = `recall-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([data], name, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function restoreBackup(file) {
    let j;
    try { j = JSON.parse(await file.text()); } catch { return toast("That isn't a Recall backup"); }
    if (j.app !== "recall" || !j.cards || !j.st) return toast("That isn't a Recall backup");
    if (!confirm(`Replace everything on this phone with the backup from ${new Date(j.at).toLocaleString()} (${Object.keys(j.cards).length} cards)?`)) return;
    db = Object.assign(Col.create(), { cards: j.cards, st: j.st, cfg: j.cfg, daily: j.daily, bundles: j.bundles || {}, nextPos: j.nextPos, revlog: [] });
    if (j.drill) (drillState = Object.assign(emptyDrill(), j.drill)), await Store.put("drill", drillState);
    await Store.replaceLogs(j.revlog || []);
    await save({ cards: true, now: true });
    const loaded = await Store.load();
    if (loaded) db = loaded;
    dirtyTree();
    toast("Backup restored");
    go("#/decks");
  }

  // ---------- bundled decks ----------
  async function updateBundles(force = false) {
    let index;
    try {
      const r = await fetch("decks/index.json", { cache: force ? "reload" : "no-cache" });
      if (!r.ok) throw new Error(r.status);
      index = await r.json();
    } catch {
      return null;
    }
    const done = [];
    for (const b of index.decks) {
      if ((db.bundles[b.id] || 0) >= b.version) continue;
      try {
        const r = await fetch("decks/" + b.file + "?v=" + b.version);
        const j = await r.json();
        const cards = j.cards.map((c) => {
          const ex = db.cards[c.k];
          return ex && ex.edited ? Object.assign({}, c, { q: ex.q, a: ex.a, edited: true }) : c;
        });
        const res = Col.merge(db, "bundle:" + b.id, cards, { prune: true });
        db.bundles[b.id] = j.version;
        done.push(`${b.name}${res.added || res.updated || res.removed ? ` (+${res.added} new, ${res.updated} changed${res.removed ? `, −${res.removed}` : ""})` : ""}`);
      } catch (e) {
        console.error("bundle", b.id, e);
      }
    }
    if (done.length) {
      dirtyTree();
      await save({ cards: true, now: true });
    }
    return done.join("; ");
  }

  // ---------- boot ----------
  async function boot() {
    applyTheme();
    try {
      db = await Store.load();
    } catch (e) {
      view.innerHTML = `<div class="done center"><div class="mark">Storage unavailable</div>${esc(e.message || "")}<br>Private browsing can block saving. Open Recall in a normal tab.</div>`;
      return;
    }
    const first = !db;
    if (first) db = Col.create();
    if (first) view.innerHTML = `<div class="done center" style="padding-top:30vh">Loading your decks…</div>`;
    drillState = Object.assign(emptyDrill(), (await Store.get("drill").catch(() => null)) || {});
    const res = await updateBundles();
    loadDrills().catch(() => {}); // warm the offline cache
    loadGuides().then((gs) => gs.forEach((g) => fetch("guides/" + g.file + "?v=" + g.version).catch(() => {}))).catch(() => {});
    if (first) await save({ cards: true, now: true });
    route();
    if (!first && res) toast("Decks updated: " + res);
  }

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  boot();
})();

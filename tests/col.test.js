const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../sched.js");
const C = require("../col.js");

const MIN = 60000;
const base = new Date(2026, 8, 27, 10, 0, 0).getTime();

function make(spec) {
  // spec: { "Deck::Sub": nCards }
  const db = C.create();
  let i = 0;
  const cards = [];
  for (const [d, n] of Object.entries(spec)) for (let j = 0; j < n; j++) cards.push({ k: "c" + i++, d, q: "Q" + i, a: "A" + i, t: [] });
  C.merge(db, "test", cards);
  return db;
}
const node = (db, name) => C.tree(db).map[name];

test("tree nests decks and sorts numerically", () => {
  const db = make({ "A::10 x": 1, "A::2 y": 1, "A::2 y::deep": 1, B: 1 });
  const t = C.tree(db);
  assert.deepEqual(t.children.map((c) => c.name), ["A", "B"]);
  assert.deepEqual(t.map.A.children.map((c) => c.label), ["2 y", "10 x"]);
  assert.equal(C.allKeys(t.map.A).length, 3);
});

test("new limit: parent caps total across subdecks; each subdeck has its own cap", () => {
  const db = make({ "P::a": 30, "P::b": 30 });
  assert.deepEqual(C.counts(db, node(db, "P"), base), { n: 20, l: 0, r: 0 });
  assert.deepEqual(C.counts(db, node(db, "P::a"), base), { n: 20, l: 0, r: 0 });
  db.cfg.newPerDay = 50;
  assert.equal(C.counts(db, node(db, "P"), base).n, 50);
});

test("studying a subdeck uses up the parent's daily new allowance", () => {
  const db = make({ "P::a": 30, "P::b": 30 });
  const n = node(db, "P::a");
  for (let i = 0; i < 5; i++) {
    const nx = C.next(db, n, base);
    assert.equal(nx.kind, "n");
    C.answer(db, nx.k, 4, base); // easy → graduates, leaves queue
  }
  assert.equal(C.counts(db, node(db, "P"), base).n, 15);
  assert.equal(C.counts(db, node(db, "P::b"), base).n, 20);
});

test("new cards come in creation order, deck by deck", () => {
  const db = make({ "P::a": 2, "P::b": 2 });
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const nx = C.next(db, node(db, "P"), base);
    seen.push(nx.k);
    C.answer(db, nx.k, 4, base);
  }
  assert.deepEqual(seen, ["c0", "c1", "c2", "c3"]);
});

test("full sitting: learning steps, waiting, then done", () => {
  const db = make({ D: 1 });
  const n = node(db, "D");
  let t = base;
  let nx = C.next(db, n, t);
  C.answer(db, nx.k, 3, t); // → 10m step
  // Nothing else to study, so the 10m card is shown early (within 20m learn-ahead)
  nx = C.next(db, n, t);
  assert.equal(nx.kind, "l");
  C.answer(db, nx.k, 1, t); // again → 1m
  C.answer(db, nx.k, 3, t); // good → 10m
  assert.equal(C.counts(db, n, t).l, 1);
  t += 10 * MIN;
  C.answer(db, nx.k, 3, t); // graduates
  assert.equal(C.next(db, n, t), null);
  assert.deepEqual(C.counts(db, n, t), { n: 0, l: 0, r: 0 });
  // Due tomorrow as a review
  const tomorrow = base + 24 * 60 * MIN;
  assert.deepEqual(C.counts(db, n, tomorrow), { n: 0, l: 0, r: 1 });
});

test("waits when the next learning card is beyond learn-ahead", () => {
  const db = make({ D: 1 });
  db.cfg.learnSteps = [30, 60];
  const n = node(db, "D");
  const nx = C.next(db, n, base);
  C.answer(db, nx.k, 3, base);
  C.answer(db, nx.k, 1, base); // back to the 30m step
  const w = C.next(db, n, base);
  assert.equal(w.wait, 30 * MIN);
});

test("new cards are spread through reviews", () => {
  const db = make({ D: 12 });
  const n = node(db, "D");
  const keys = Object.keys(db.cards);
  const day = S.dayNum(base);
  keys.slice(0, 10).forEach((k) => (db.st[k] = { type: 2, queue: 2, due: day, ivl: 5, ease: 2500, step: 0, reps: 3, lapses: 0, pos: db.st[k].pos }));
  const sess = { sinceNew: 0 };
  const kinds = [];
  for (let i = 0; i < 12; i++) {
    const nx = C.next(db, n, base, sess);
    kinds.push(nx.kind);
    C.answer(db, nx.k, 3, base, 0, sess);
    if (nx.kind === "n") C.answer(db, nx.k, 4, base); // clear it out of learning
  }
  assert.equal(kinds.filter((k) => k === "n").length, 2);
  assert.notEqual(kinds.indexOf("n"), 11); // not all saved for the end
});

test("undo restores state, daily counts and revlog", () => {
  const db = make({ D: 3 });
  const n = node(db, "D");
  const before = JSON.stringify({ st: db.st, daily: C.counts(db, n, base) });
  const nx = C.next(db, n, base);
  const u = C.answer(db, nx.k, 3, base);
  assert.equal(db.revlog.length, 1);
  C.undo(db, u);
  assert.equal(db.revlog.length, 0);
  assert.equal(JSON.stringify({ st: db.st, daily: C.counts(db, n, base) }), before);
});

test("bury hides until tomorrow; suspend hides until unsuspended", () => {
  const db = make({ D: 2 });
  const n = node(db, "D");
  C.bury(db, "c0", base);
  assert.equal(C.counts(db, n, base).n, 1);
  assert.equal(C.counts(db, n, base + 24 * 60 * MIN).n, 2);
  C.setSuspended(db, "c1", true);
  assert.equal(C.counts(db, n, base + 24 * 60 * MIN).n, 1);
  C.setSuspended(db, "c1", false);
  assert.equal(C.counts(db, n, base + 24 * 60 * MIN).n, 2);
});

test("merge keeps progress, updates content, prunes removed cards", () => {
  const db = make({ D: 3 });
  C.answer(db, "c0", 4, base);
  const ivl = db.st.c0.ivl;
  const r = C.merge(db, "test", [
    { k: "c0", d: "D", q: "Q-edited", a: "A1", t: [] },
    { k: "c1", d: "D", q: "Q2", a: "A2", t: [] },
    { k: "c9", d: "D", q: "new", a: "new", t: [] },
  ], { prune: true });
  assert.deepEqual(r, { added: 1, updated: 1, removed: 1 });
  assert.equal(db.cards.c0.q, "Q-edited");
  assert.equal(db.st.c0.ivl, ivl);
  assert.ok(!db.cards.c2 && !db.st.c2);
  assert.equal(db.st.c9.type, 0);
});

test("search: text, deck:, tag:, is:, negation", () => {
  const db = make({ "RCP 202::ABG": 2, "RCP 203::Vent": 1 });
  db.cards.c0.q = "Normal <b>pH</b> range";
  db.cards.c1.t = ["anchor"];
  const now = base;
  assert.deepEqual(C.search(db, "ph", now), ["c0"]);
  assert.deepEqual(C.search(db, "deck:\"RCP 202\"", now).sort(), ["c0", "c1"]);
  assert.deepEqual(C.search(db, "deck:rcp*", now).length, 3);
  assert.deepEqual(C.search(db, "tag:anchor", now), ["c1"]);
  assert.deepEqual(C.search(db, "-tag:anchor is:new", now).sort(), ["c0", "c2"]);
});

test("stats: streak and retention", () => {
  const db = make({ D: 1 });
  const day = 24 * 60 * MIN;
  db.revlog = [
    { k: "c0", t: base - 2 * day, b: 3, type: 2, ms: 1000 },
    { k: "c0", t: base - day, b: 1, type: 2, ms: 1000 },
    { k: "c0", t: base, b: 3, type: 2, ms: 1000 },
  ];
  const s = C.stats(db, base);
  assert.equal(s.streak, 3);
  assert.equal(Math.round(s.retention * 100), 67);
  assert.equal(s.today.count, 1);
});

test("merge ignores markup-only differences and keeps bundle ownership", () => {
  const db = C.create();
  C.merge(db, "bundle:rcp", [{ k: "a", d: "D", q: "Q", a: "Q\n\n<hr id=answer>\n\nA", t: [] }]);
  const r = C.merge(db, "import:x.apkg", [{ k: "a", d: "D", q: "Q", a: 'Q <hr id="answer"> A', t: [] }]);
  assert.equal(r.updated, 0);
  assert.equal(db.cards.a.src, "bundle:rcp");
});

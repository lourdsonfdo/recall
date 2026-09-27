/* Recall collection: decks, daily limits, study queue, answering, undo, bundle merge.
 * Pure data logic (no DOM, no storage) so it runs under Node tests too.
 *
 * db = {
 *   cards:  { key: { k, d: "Deck::Sub", q, a, t: [tags], src } },
 *   st:     { key: schedState },         // see sched.js
 *   revlog: [ { k, t, b, type, ivl, lastIvl, ms } ],
 *   cfg:    { newPerDay, revPerDay, ... },
 *   daily:  { day, n: { deck: count }, r: { deck: count } },
 *   bundles:{ id: version },
 *   nextPos
 * }
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./sched.js"));
  else root.Col = factory(root.Sched);
})(typeof self !== "undefined" ? self : this, function (Sched) {
  "use strict";

  function create() {
    return { cards: {}, st: {}, revlog: [], cfg: Object.assign({}, Sched.DEFAULTS), daily: { day: -1, n: {}, r: {} }, bundles: {}, nextPos: 0 };
  }

  const cfgOf = (db) => Object.assign({}, Sched.DEFAULTS, db.cfg);
  const today = (db, now) => Sched.dayNum(now, cfgOf(db).rolloverHour);

  function ancestors(deck) {
    const parts = deck.split("::");
    return parts.map((_, i) => parts.slice(0, i + 1).join("::"));
  }

  function rollDay(db, now) {
    const d = today(db, now);
    if (db.daily.day !== d) db.daily = { day: d, n: {}, r: {} };
    return d;
  }

  // Effective queue: buried cards come back on a later day.
  function queueOf(s, day) {
    if (s.queue === -2 && !(s.buriedDay >= day)) return s.type === 0 ? 0 : s.type === 2 ? 2 : 1;
    return s.queue;
  }

  /** Deck tree. Node: { name, label, children: [], own: [keys] } */
  function tree(db) {
    const root = { name: "", label: "", children: [], own: [], map: {} };
    const get = (name) => {
      if (root.map[name]) return root.map[name];
      const i = name.lastIndexOf("::");
      const parent = i < 0 ? root : get(name.slice(0, i));
      const node = { name, label: i < 0 ? name : name.slice(i + 2), children: [], own: [] };
      parent.children.push(node);
      root.map[name] = node;
      return node;
    };
    for (const k in db.cards) get(db.cards[k].d).own.push(k);
    const sort = (n) => {
      n.children.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
      n.children.forEach(sort);
    };
    sort(root);
    return root;
  }

  function allKeys(node, out = []) {
    out.push(...node.own);
    node.children.forEach((c) => allKeys(c, out));
    return out;
  }

  function left(db, deck, kind) {
    const cfg = cfgOf(db);
    const lim = kind === "n" ? cfg.newPerDay : cfg.revPerDay;
    return Math.max(0, lim - (db.daily[kind][deck] || 0));
  }

  // Order key for reviews: due day, then a stable per-day shuffle.
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  /** Eligible new and review keys under node, in study order, respecting per-deck limits. */
  function gather(db, node, day) {
    const own = { n: [], r: [] };
    for (const k of node.own) {
      const s = db.st[k];
      const q = queueOf(s, day);
      if (q === 0) own.n.push(k);
      else if (q === 2 && s.due <= day) own.r.push(k);
    }
    // Random order reshuffles once per day, so counts and the queue stay stable within a day.
    const random = cfgOf(db).newOrder === "random";
    const newOrder = random ? (a, b) => hash(a + ":" + day) - hash(b + ":" + day) : (a, b) => db.st[a].pos - db.st[b].pos;
    own.n.sort(newOrder);
    const out = { n: own.n, r: own.r };
    for (const c of node.children) {
      const g = gather(db, c, day);
      out.n = out.n.concat(g.n);
      out.r = out.r.concat(g.r);
    }
    // Random mixes subdecks together; in-order goes deck by deck.
    if (random) out.n.sort(newOrder);
    if (node.name) {
      out.n = out.n.slice(0, left(db, node.name, "n"));
      out.r.sort((a, b) => db.st[a].due - db.st[b].due || hash(a + day) - hash(b + day));
      out.r = out.r.slice(0, left(db, node.name, "r"));
    }
    return out;
  }

  function learning(db, node, day) {
    return allKeys(node).filter((k) => queueOf(db.st[k], day) === 1);
  }

  /** { n, l, r } counts shown next to a deck. */
  function counts(db, node, now) {
    const day = rollDay(db, now);
    const g = gather(db, node, day);
    const end = Sched.dayStart(day + 1, cfgOf(db).rolloverHour);
    const l = learning(db, node, day).filter((k) => db.st[k].due < end).length;
    return { n: g.n.length, l, r: g.r.length };
  }

  /**
   * Next card to show. sess = { sinceNew } persists across calls in one sitting.
   * Returns { k, kind } | { wait: ms } | null when finished for today.
   */
  function next(db, node, now, sess = { sinceNew: 0 }) {
    const cfg = cfgOf(db);
    const day = rollDay(db, now);
    const learn = learning(db, node, day).sort((a, b) => db.st[a].due - db.st[b].due);
    if (learn.length && db.st[learn[0]].due <= now) return { k: learn[0], kind: "l" };

    const g = gather(db, node, day);
    if (g.n.length || g.r.length) {
      // Spread new cards evenly through the reviews, like Anki's "mix with reviews".
      const every = g.n.length ? Math.max(1, Math.floor(g.r.length / g.n.length)) : Infinity;
      if (g.n.length && (!g.r.length || sess.sinceNew >= every)) return { k: g.n[0], kind: "n" };
      return { k: g.r[0], kind: "r" };
    }
    if (learn.length) {
      const due = db.st[learn[0]].due;
      if (due - now <= cfg.learnAheadMin * 60000) return { k: learn[0], kind: "l" };
      if (due < Sched.dayStart(day + 1, cfg.rolloverHour)) return { wait: due - now };
    }
    return null;
  }

  function seedFor(k, reps) {
    return hash(k + ":" + reps);
  }

  function previews(db, k, now) {
    return Sched.previews(db.st[k], now, cfgOf(db), seedFor(k, db.st[k].reps));
  }

  /** Answer a card; returns an undo record. */
  function answer(db, k, button, now, ms = 0, sess) {
    rollDay(db, now);
    const prev = db.st[k];
    const card = db.cards[k];
    const undo = { k, st: prev, daily: JSON.parse(JSON.stringify(db.daily)), tags: card.t.slice(), sess: sess && Object.assign({}, sess) };
    const res = Sched.answer(prev, button, now, cfgOf(db), seedFor(k, prev.reps));
    db.st[k] = res.state;
    const kind = prev.type === 0 ? "n" : prev.type === 2 ? "r" : null;
    if (kind) for (const d of ancestors(card.d)) db.daily[kind][d] = (db.daily[kind][d] || 0) + 1;
    if (sess) sess.sinceNew = prev.type === 0 ? 0 : sess.sinceNew + (prev.type === 2 ? 1 : 0);
    if (res.leech && !card.t.includes("leech")) card.t.push("leech");
    db.revlog.push(Object.assign({ k, ms: Math.min(ms, 60000) }, res.log));
    return undo;
  }

  function undo(db, rec, sess) {
    db.st[rec.k] = rec.st;
    db.daily = rec.daily;
    db.cards[rec.k].t = rec.tags;
    if (sess && rec.sess) Object.assign(sess, rec.sess);
    if (rec.noLog) return;
    const i = db.revlog.map((r) => r.k).lastIndexOf(rec.k);
    if (i >= 0) db.revlog.splice(i, 1);
  }

  function bury(db, k, now) {
    const prev = db.st[k];
    db.st[k] = Object.assign({}, prev, { queue: -2, buriedDay: today(db, now) });
    return { k, st: prev, daily: JSON.parse(JSON.stringify(db.daily)), tags: db.cards[k].t.slice(), noLog: true };
  }

  function setSuspended(db, k, on) {
    const prev = db.st[k];
    const s = Object.assign({}, prev);
    if (on) s.queue = -1;
    else s.queue = s.type === 0 ? 0 : s.type === 2 ? 2 : 1;
    delete s.buriedDay;
    db.st[k] = s;
    return { k, st: prev, daily: JSON.parse(JSON.stringify(db.daily)), tags: db.cards[k].t.slice(), noLog: true };
  }

  function forget(db, k) {
    db.st[k] = Sched.newState(db.nextPos++);
  }

  function addCard(db, card, state) {
    db.cards[card.k] = card;
    db.st[card.k] = state || Sched.newState(db.nextPos++);
  }

  function removeCard(db, k) {
    delete db.cards[k];
    delete db.st[k];
  }

  /**
   * Merge cards from a source (bundle or import). Existing keys keep their progress
   * and get fresh content; new keys are added as new cards. With prune=true, cards
   * from the same src that are no longer present are removed.
   */
  // Ignore markup-only differences (quoting, whitespace) when counting updates.
  const norm = (h) => h.replace(/["']/g, "").replace(/\s+/g, " ").replace(/\s*\/?>/g, ">").trim();

  function merge(db, src, cards, { prune = false, states = {} } = {}) {
    const seen = new Set();
    let added = 0, updated = 0, removed = 0;
    for (const c of cards) {
      seen.add(c.k);
      const ex = db.cards[c.k];
      if (ex) {
        if (norm(ex.q) !== norm(c.q) || norm(ex.a) !== norm(c.a) || ex.d !== c.d || ex.t.join(" ") !== c.t.join(" ")) updated++;
        const keep = ex.t.filter((t) => t === "leech" || t === "marked");
        // A bundle owns its cards; a manual import of the same cards doesn't take them over.
        const owner = src.startsWith("bundle:") || !ex.src || !ex.src.startsWith("bundle:") ? src : ex.src;
        db.cards[c.k] = Object.assign({}, c, { src: owner, t: Array.from(new Set(c.t.concat(keep))) });
        if (states[c.k] && db.st[c.k].type === 0) db.st[c.k] = Object.assign({}, states[c.k], { pos: db.st[c.k].pos });
      } else {
        addCard(db, Object.assign({}, c, { src }), states[c.k] && Object.assign({ pos: db.nextPos++ }, states[c.k]));
        added++;
      }
    }
    if (prune) {
      for (const k of Object.keys(db.cards)) {
        if (db.cards[k].src === src && !seen.has(k)) {
          removeCard(db, k);
          removed++;
        }
      }
    }
    return { added, updated, removed };
  }

  function removeDeck(db, name) {
    let n = 0;
    for (const k of Object.keys(db.cards)) {
      const d = db.cards[k].d;
      if (d === name || d.startsWith(name + "::")) {
        removeCard(db, k);
        n++;
      }
    }
    return n;
  }

  function renameDeck(db, from, to) {
    for (const k in db.cards) {
      const d = db.cards[k].d;
      if (d === from) db.cards[k].d = to;
      else if (d.startsWith(from + "::")) db.cards[k].d = to + d.slice(from.length);
    }
  }

  /** Browse search: words, "quoted phrases", deck:X, tag:X, is:new|due|learn|review|suspended|leech. */
  function search(db, query, now) {
    const day = today(db, now);
    const terms = (query.match(/(-?\w+:"[^"]*"|-?"[^"]*"|\S+)/g) || []).map((t) => {
      const neg = t.startsWith("-");
      if (neg) t = t.slice(1);
      const m = t.match(/^(\w+):(.*)$/);
      const val = (m ? m[2] : t).replace(/^"|"$/g, "").toLowerCase();
      return { neg, field: m ? m[1].toLowerCase() : null, val };
    });
    const strip = (h) => h.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").toLowerCase();
    const glob = (pat) => new RegExp("^" + pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "i");
    return Object.keys(db.cards).filter((k) => {
      const c = db.cards[k], s = db.st[k], q = queueOf(s, day);
      return terms.every(({ neg, field, val }) => {
        let hit;
        if (field === "deck") {
          const re = glob(val);
          hit = ancestors(c.d).some((d) => re.test(d)) || re.test(c.d);
        } else if (field === "tag") {
          const re = glob(val);
          hit = c.t.some((t) => re.test(t));
        } else if (field === "is") {
          hit = {
            new: s.type === 0, learn: q === 1, review: s.type === 2 || s.type === 3,
            due: (q === 2 && s.due <= day) || q === 1, suspended: q === -1, buried: q === -2,
            leech: c.t.includes("leech"),
          }[val];
        } else hit = strip(c.q + " " + c.a).includes(field ? field + ":" + val : val);
        return neg ? !hit : !!hit;
      });
    });
  }

  function stats(db, now) {
    const day = today(db, now);
    const start = Sched.dayStart(day, cfgOf(db).rolloverHour);
    const todays = db.revlog.filter((r) => r.t >= start);
    const byType = { new: 0, learning: 0, young: 0, mature: 0, suspended: 0 };
    const forecast = new Array(30).fill(0);
    for (const k in db.st) {
      const s = db.st[k];
      const q = queueOf(s, day);
      if (q === -1) byType.suspended++;
      else if (s.type === 0) byType.new++;
      else if (s.type !== 2) byType.learning++;
      else if (s.ivl >= 21) byType.mature++;
      else byType.young++;
      if (s.type === 2 && q !== -1) forecast[Math.max(0, Math.min(29, s.due - day))]++;
    }
    const days = new Set(db.revlog.map((r) => Sched.dayNum(r.t, cfgOf(db).rolloverHour)));
    let streak = 0;
    for (let d = days.has(day) ? day : day - 1; days.has(d); d--) streak++;
    const month = db.revlog.filter((r) => r.type === 2 && r.t >= start - 29 * 86400000);
    const retention = month.length ? month.filter((r) => r.b > 1).length / month.length : null;
    return {
      today: { count: todays.length, ms: todays.reduce((a, r) => a + r.ms, 0), again: todays.filter((r) => r.b === 1).length },
      byType, forecast, streak, retention, retentionN: month.length, total: Object.keys(db.cards).length,
    };
  }

  return {
    create, tree, allKeys, counts, next, previews, answer, undo, bury, setSuspended, forget, addCard, removeCard,
    merge, removeDeck, renameDeck, search, stats, queueOf, ancestors, today, rollDay, cfgOf,
  };
});

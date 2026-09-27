/* Recall scheduler — Anki's SM-2 variant (v2/v3 defaults), pure functions.
 * Works in the browser (window.Sched) and in Node (module.exports) for tests.
 *
 * Card state: { type, queue, due, ivl, ease, step, reps, lapses, pos, buriedDay }
 *   type  0 new · 1 learning · 2 review · 3 relearning
 *   queue 0 new · 1 learning · 2 review · -1 suspended · -2 buried
 *   due   learning/relearning: epoch ms · review: day number · new: unused
 *   ease  permille (2500 = 250%)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Sched = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MIN = 60 * 1000;
  const DAY_MS = 24 * 60 * MIN;

  const DEFAULTS = {
    newPerDay: 20,
    newOrder: "deck", // "deck" = creation order, deck by deck (Anki default) · "random"
    revPerDay: 200,
    learnSteps: [1, 10], // minutes
    relearnSteps: [10], // minutes
    gradIvl: 1, // days
    easyIvl: 4,
    startEase: 2500,
    easyBonus: 1.3,
    hardMult: 1.2,
    lapseMult: 0, // new interval after a lapse = ivl * lapseMult (min 1)
    maxIvl: 36500,
    leechAt: 8,
    rolloverHour: 4, // a new "day" starts at 4 am, like Anki
    learnAheadMin: 20,
  };

  /** Local day number with Anki's 4 am rollover. */
  function dayNum(ts, rolloverHour = DEFAULTS.rolloverHour) {
    const off = new Date(ts).getTimezoneOffset() * MIN;
    return Math.floor((ts - off - rolloverHour * 60 * MIN) / DAY_MS);
  }

  /** Epoch ms when day `day` begins (at the rollover hour). */
  function dayStart(day, rolloverHour = DEFAULTS.rolloverHour) {
    let ts = day * DAY_MS + rolloverHour * 60 * MIN;
    ts += new Date(ts).getTimezoneOffset() * MIN;
    return ts;
  }

  function newState(pos) {
    return { type: 0, queue: 0, due: 0, ivl: 0, ease: 0, step: 0, reps: 0, lapses: 0, pos };
  }

  // Deterministic fuzz so previews match the real answer for the same card+day.
  function fuzzRange(ivl) {
    if (ivl < 2.5) return [ivl, ivl];
    let delta = 1;
    if (ivl >= 7) delta = Math.max(delta, Math.round(ivl * 0.15));
    if (ivl >= 20) delta = Math.max(delta, Math.round(ivl * 0.1 + 1));
    if (ivl >= 30) delta = Math.max(delta, Math.round(ivl * 0.05 + 2.5));
    return [Math.max(2, ivl - delta), ivl + delta];
  }

  function fuzz(ivl, seed) {
    const [lo, hi] = fuzzRange(ivl);
    if (lo === hi) return ivl;
    // mulberry32 on the seed
    let t = (seed + 0x6d2b79f5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return lo + Math.floor(r * (hi - lo + 1));
  }

  function stepDelayMin(steps, step, button) {
    // Anki: Hard on the first step = average of first two steps (or 1.5x if only one).
    if (button === 2) {
      if (step === 0) return steps.length > 1 ? (steps[0] + steps[1]) / 2 : Math.min(steps[0] * 1.5, steps[0] + 1440);
      return steps[step];
    }
    return steps[step];
  }

  function reviewIvls(s, today, cfg) {
    const late = Math.max(0, today - s.due);
    const ease = s.ease / 1000;
    const hard = Math.max(s.ivl + 1, Math.round(s.ivl * cfg.hardMult));
    const good = Math.max(hard + 1, Math.round((s.ivl + late / 2) * ease));
    const easy = Math.max(good + 1, Math.round((s.ivl + late) * ease * cfg.easyBonus));
    const cap = (x) => Math.min(cfg.maxIvl, x);
    return { hard: cap(hard), good: cap(good), easy: cap(easy) };
  }

  /**
   * Answer a card. button: 1 Again · 2 Hard · 3 Good · 4 Easy.
   * Returns { state, log } — never mutates the input.
   */
  function answer(prev, button, now, cfg = DEFAULTS, seed = 0) {
    cfg = Object.assign({}, DEFAULTS, cfg);
    const s = Object.assign({}, prev);
    const today = dayNum(now, cfg.rolloverHour);
    const lastIvl = prev.type === 2 ? prev.ivl : 0;
    let leech = false;
    s.reps++;
    if (s.queue === -2) s.queue = s.type === 0 ? 0 : s.type === 2 ? 2 : 1;
    delete s.buriedDay;

    const graduate = (ivl) => {
      s.type = 2;
      s.queue = 2;
      s.ivl = Math.max(1, Math.min(cfg.maxIvl, ivl));
      s.due = today + s.ivl;
      s.step = 0;
    };
    const toStep = (steps, step, btn) => {
      s.step = step;
      s.queue = 1;
      s.due = now + stepDelayMin(steps, step, btn) * MIN;
    };

    if (s.type === 0 || s.type === 1) {
      const steps = cfg.learnSteps;
      if (s.type === 0) {
        s.type = 1;
        s.step = 0;
        s.ease = cfg.startEase;
      }
      if (button === 1) toStep(steps, 0, 1);
      else if (button === 2) toStep(steps, s.step, 2);
      else if (button === 3) {
        if (s.step + 1 < steps.length) toStep(steps, s.step + 1, 3);
        else graduate(fuzz(cfg.gradIvl, seed));
      } else graduate(fuzz(cfg.easyIvl, seed));
    } else if (s.type === 2) {
      if (button === 1) {
        s.lapses++;
        s.ease = Math.max(1300, s.ease - 200);
        s.ivl = Math.max(1, Math.round(s.ivl * cfg.lapseMult));
        leech = s.lapses >= cfg.leechAt && (s.lapses - cfg.leechAt) % Math.ceil(cfg.leechAt / 2) === 0;
        if (cfg.relearnSteps.length) {
          s.type = 3;
          toStep(cfg.relearnSteps, 0, 1);
        } else graduate(s.ivl);
      } else {
        const iv = reviewIvls(s, today, cfg);
        if (button === 2) s.ease = Math.max(1300, s.ease - 150);
        if (button === 4) s.ease += 150;
        graduate(fuzz(button === 2 ? iv.hard : button === 3 ? iv.good : iv.easy, seed));
      }
    } else {
      // relearning — ivl was already reset at the lapse
      const steps = cfg.relearnSteps;
      if (button === 1) toStep(steps, 0, 1);
      else if (button === 2) toStep(steps, s.step, 2);
      else if (button === 3) {
        if (s.step + 1 < steps.length) toStep(steps, s.step + 1, 3);
        else graduate(s.ivl);
      } else graduate(s.ivl + 1);
    }

    return {
      state: s,
      leech,
      log: { t: now, b: button, type: prev.type, ivl: s.type === 2 ? s.ivl : -Math.round((s.due - now) / 1000), lastIvl },
    };
  }

  /** Human label for the delay each button would give: ["<1m", "6m", "10m", "4d"]. */
  function previews(state, now, cfg = DEFAULTS, seed = 0) {
    const today = dayNum(now, cfg.rolloverHour);
    return [1, 2, 3, 4].map((b) => {
      const { state: s } = answer(state, b, now, cfg, seed);
      if (s.type === 2 && s.queue === 2) return fmtIvl(s.due - today);
      return fmtMs(s.due - now);
    });
  }

  function fmtMs(ms) {
    if (ms < MIN) return "<1m";
    const m = Math.round(ms / MIN);
    if (m < 60) return m + "m";
    const h = m / 60;
    if (h < 24) return (Math.round(h * 10) / 10).toString().replace(/\.0$/, "") + "h";
    return fmtIvl(Math.round(h / 24));
  }

  function fmtIvl(days) {
    if (days < 30) return days + "d";
    if (days < 365) return (Math.round((days / 30) * 10) / 10).toString().replace(/\.0$/, "") + "mo";
    return (Math.round((days / 365) * 10) / 10).toString().replace(/\.0$/, "") + "y";
  }

  return { DEFAULTS, dayNum, dayStart, newState, answer, previews, fmtIvl, fmtMs, fuzz, fuzzRange, reviewIvls };
});

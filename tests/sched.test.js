const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../sched.js");

const MIN = 60000;
// 10:00 local on some day
const base = new Date(2026, 8, 27, 10, 0, 0).getTime();
const today = S.dayNum(base);

test("day rolls over at 4 am local, not midnight", () => {
  const d = (h) => S.dayNum(new Date(2026, 8, 28, h, 0, 0).getTime());
  assert.equal(S.dayNum(new Date(2026, 8, 28, 3, 59).getTime()), today); // still "yesterday"
  assert.equal(d(4), today + 1);
  assert.equal(d(23), today + 1);
  assert.ok(Math.abs(S.dayStart(today + 1) - new Date(2026, 8, 28, 4, 0).getTime()) < 1000);
});

test("new card: Again 1m, Hard 6m, Good 10m, Easy 4d±fuzz (Anki defaults)", () => {
  const p = S.previews(S.newState(0), base);
  assert.deepEqual(p.slice(0, 3), ["1m", "6m", "10m"]);
  assert.ok(["3d", "4d", "5d"].includes(p[3]), p[3]);
});

test("new card path: Good, Good graduates to 1 day with 250% ease", () => {
  let { state: s } = S.answer(S.newState(0), 3, base);
  assert.equal(s.type, 1);
  assert.equal(s.step, 1);
  assert.equal(s.due, base + 10 * MIN);
  ({ state: s } = S.answer(s, 3, base + 10 * MIN));
  assert.equal(s.type, 2);
  assert.equal(s.ivl, 1);
  assert.equal(s.due, today + 1);
  assert.equal(s.ease, 2500);
});

test("learning Again resets to first step", () => {
  let { state: s } = S.answer(S.newState(0), 3, base);
  ({ state: s } = S.answer(s, 1, base));
  assert.equal(s.step, 0);
  assert.equal(s.due, base + 1 * MIN);
});

test("learning Hard on second step repeats that step", () => {
  let { state: s } = S.answer(S.newState(0), 3, base);
  ({ state: s } = S.answer(s, 2, base));
  assert.equal(s.step, 1);
  assert.equal(s.due, base + 10 * MIN);
});

const review = (ivl, ease = 2500, dueOffset = 0) => ({
  type: 2, queue: 2, due: today + dueOffset, ivl, ease, step: 0, reps: 5, lapses: 0, pos: 0,
});

test("review on time: hard=ivl*1.2, good=ivl*ease, easy=ivl*ease*1.3", () => {
  const iv = S.reviewIvls(review(10), today, S.DEFAULTS);
  assert.deepEqual(iv, { hard: 12, good: 25, easy: 33 });
});

test("review intervals are always strictly increasing", () => {
  for (const ivl of [1, 2, 3, 5, 8, 13]) {
    for (const ease of [1300, 1800, 2500, 3200]) {
      const iv = S.reviewIvls(review(ivl, ease), today, S.DEFAULTS);
      assert.ok(iv.hard > ivl && iv.good > iv.hard && iv.easy > iv.good, `${ivl}/${ease}`);
    }
  }
});

test("overdue reviews get credit for the delay", () => {
  const onTime = S.reviewIvls(review(10), today, S.DEFAULTS);
  const late = S.reviewIvls(review(10, 2500, -4), today, S.DEFAULTS);
  assert.equal(late.good, Math.round((10 + 2) * 2.5));
  assert.ok(late.good > onTime.good);
});

test("ease: Hard -15%, Easy +15%, lapse -20%, floor 130%", () => {
  assert.equal(S.answer(review(10), 2, base).state.ease, 2350);
  assert.equal(S.answer(review(10), 4, base).state.ease, 2650);
  assert.equal(S.answer(review(10), 1, base).state.ease, 2300);
  assert.equal(S.answer(review(10, 1400), 1, base).state.ease, 1300);
});

test("lapse goes to relearning 10m then back to review at 1 day", () => {
  let { state: s } = S.answer(review(30), 1, base);
  assert.equal(s.type, 3);
  assert.equal(s.lapses, 1);
  assert.equal(s.ivl, 1);
  assert.equal(s.due, base + 10 * MIN);
  ({ state: s } = S.answer(s, 3, base + 10 * MIN));
  assert.equal(s.type, 2);
  assert.equal(s.due, today + 1);
});

test("fuzz stays inside Anki's range and is deterministic per seed", () => {
  for (const ivl of [3, 7, 20, 30, 100]) {
    const [lo, hi] = S.fuzzRange(ivl);
    for (let seed = 0; seed < 200; seed++) {
      const f = S.fuzz(ivl, seed);
      assert.ok(f >= lo && f <= hi);
      assert.equal(f, S.fuzz(ivl, seed));
    }
  }
  assert.equal(S.fuzz(1, 7), 1);
});

test("previews match the actual answer (same seed)", () => {
  const s = review(40);
  const labels = S.previews(s, base, S.DEFAULTS, 1234);
  const good = S.answer(s, 3, base, S.DEFAULTS, 1234).state;
  assert.equal(labels[2], S.fmtIvl(good.due - today));
});

test("leech flagged at the 8th lapse", () => {
  const s = Object.assign(review(5), { lapses: 7 });
  assert.equal(S.answer(s, 1, base).leech, true);
  assert.equal(S.answer(Object.assign(review(5), { lapses: 3 }), 1, base).leech, false);
});

test("answer never mutates the input state", () => {
  const s = review(10);
  const copy = JSON.stringify(s);
  S.answer(s, 1, base);
  S.answer(s, 4, base);
  assert.equal(JSON.stringify(s), copy);
});

test("interval labels", () => {
  assert.equal(S.fmtMs(30 * 1000), "<1m");
  assert.equal(S.fmtMs(90 * MIN), "1.5h");
  assert.equal(S.fmtIvl(45), "1.5mo");
  assert.equal(S.fmtIvl(730), "2y");
});

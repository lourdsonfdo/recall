const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../audiolib.js");

test("fmt formats minutes and hours", () => {
  assert.equal(A.fmt(0), "0:00");
  assert.equal(A.fmt(125), "2:05");
  assert.equal(A.fmt(3725), "1:02:05");
  assert.equal(A.fmt(5931.4), "1:38:51");
  assert.equal(A.fmt(NaN), "0:00");
  assert.equal(A.fmt(-4), "0:00");
});

test("skip is exactly 15 s and stays inside the file", () => {
  assert.equal(A.SKIP, 15);
  assert.equal(A.skipTo(100, +A.SKIP, 5931), 115);
  assert.equal(A.skipTo(100, -A.SKIP, 5931), 85);
  assert.equal(A.skipTo(5, -A.SKIP, 5931), 0);
  assert.equal(A.skipTo(5925, +A.SKIP, 5931), 5931);
  assert.equal(A.skipTo(NaN, +A.SKIP, 5931), 15);
  assert.equal(A.skipTo(40, +A.SKIP, NaN), 55); // duration not known yet
});

test("chapterAt picks the chapter that contains the time", () => {
  const ch = [{ t: 0 }, { t: 145 }, { t: 463 }];
  assert.equal(A.chapterAt(ch, 0), 0);
  assert.equal(A.chapterAt(ch, 144.9), 0);
  assert.equal(A.chapterAt(ch, 145), 1);
  assert.equal(A.chapterAt(ch, 9999), 2);
  assert.equal(A.chapterAt([], 10), -1);
});

test("resumeAt ignores the very start and the very end", () => {
  assert.equal(A.resumeAt(3, 5931), 0);
  assert.equal(A.resumeAt(1200, 5931), 1200);
  assert.equal(A.resumeAt(5929, 5931), 0);
  assert.equal(A.resumeAt(undefined, 5931), 0);
  assert.equal(A.resumeAt(1200, NaN), 1200);
});

test("stepSpeed walks the list and clamps", () => {
  assert.equal(A.stepSpeed(1, +1), 1.1);
  assert.equal(A.stepSpeed(1, -1), 0.9);
  assert.equal(A.stepSpeed(2, +1), 2);
  assert.equal(A.stepSpeed(0.75, -1), 0.75);
  assert.equal(A.stepSpeed(1.3, +1), 1.1); // unknown speed falls back to 1x first
});

test("fmtLong", () => {
  assert.equal(A.fmtLong(5931), "1 h 39 min");
  assert.equal(A.fmtLong(3000), "50 min");
  assert.equal(A.fmtLong(3600), "1 h 0 min");
});

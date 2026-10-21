/* Recall audio helpers: pure functions, no DOM. Works in the browser (window.AudioLib) and in Node for tests. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AudioLib = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SKIP = 15;
  const SPEEDS = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

  /** 3725 -> "1:02:05", 125 -> "2:05" */
  function fmt(sec) {
    const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    const mm = h ? String(m).padStart(2, "0") : String(m);
    return (h ? h + ":" : "") + mm + ":" + String(x).padStart(2, "0");
  }

  /** New position after skipping by `delta` seconds, kept inside [0, duration]. */
  function skipTo(now, delta, duration) {
    const t = (Number.isFinite(now) ? now : 0) + delta;
    const hi = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
    return Math.min(Math.max(0, t), hi);
  }

  /** Index of the chapter that contains time `t` (chapters sorted by start `t`), or -1. */
  function chapterAt(chapters, t) {
    let idx = -1;
    for (let i = 0; i < chapters.length; i++) if (chapters[i].t <= t) idx = i;
    return idx;
  }

  /** Resume only if the saved spot is meaningful: not the first 5 s, not the last 5 s. */
  function resumeAt(saved, duration) {
    if (!Number.isFinite(saved) || saved <= 5) return 0;
    if (Number.isFinite(duration) && duration > 0 && saved >= duration - 5) return 0;
    return saved;
  }

  /** Next speed in the list; clamps at both ends. dir is +1 or -1. */
  function stepSpeed(cur, dir) {
    let i = SPEEDS.indexOf(cur);
    if (i < 0) i = SPEEDS.indexOf(1);
    return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i + dir))];
  }

  /** "1 h 39 min" / "52 min" for list rows. */
  function fmtLong(sec) {
    const m = Math.round((Number.isFinite(sec) ? sec : 0) / 60);
    const h = Math.floor(m / 60);
    return h ? h + " h " + (m % 60) + " min" : m + " min";
  }

  return { SKIP, SPEEDS, fmt, skipTo, chapterAt, resumeAt, stepSpeed, fmtLong };
});

# Recall

Anki-style flashcards for your phone. Offline PWA, no account, data stays on the device.

- **Scheduling:** Anki's SM-2 defaults — learning steps 1m/10m, graduate 1d, easy 4d, 250% start ease, 4 am day rollover, fuzz, leech tag at 8 lapses. Per-deck daily limits that cap subdecks like Anki.
- **Study:** Again/Hard/Good/Easy with interval previews, undo, bury, suspend, mark, edit.
- **Decks:** built-in bundle (`decks/`), plus import of Anki `.apkg`/`.colpkg` (old and new zstd formats, optional review progress, media), plain-text `.txt/.csv`, and Recall `.json`.
- **Browse:** search text, `deck:`, `tag:`, `is:new|due|learn|suspended`, `-negation`.
- **Drill:** RCP 202 (508) and RCP 203 (644) midterm multiple-choice banks — by section/subsection or full mix, 10/20/30/all, shuffled choices, explanations, missed-question review, best scores.
- **Stats**, **backup/restore** (one JSON file, includes drill progress).

- **Guides:** RCP 201 Quick Answers, RCP 202 and 203 Tier 3 study guides, readable offline; the app remembers your place.
- **Board exam prep:** the TMC & CSE Trainer (420 TMC questions, 20 CSE simulations), embedded unchanged (`tools/import_guide.py ... --app`).

## Update a guide

```
python3 tools/import_guide.py path/to/RCP_203_Tier3_StudyGuideOnly.html rcp203-tier3 "RCP 203 Midterm" "Midterm exam · study guide scope (Tier 3)"
```
Final guides are shown compacted: `python3 tools/compact_guide.py <vault html> <tmp.html>` folds source lines and the Conflicting Numbers / Still Not Covered sections (nothing removed; "Why it matters" blocks untouched), then import the tmp file with `tools/import_guide.py`. The vault copy and PDF stay full.


## Update a drill bank

```
python3 tools/import_drill.py path/to/RCP_203_Midterm_Drill.html rcp203 "RCP 203 Midterm"
```

## Update the built-in decks from desktop Anki

Anki open, then:

```
python3 tools/export_anki.py            # default query: deck:RCP*
git commit -am "Update decks" && git push
```

Phones pick up the new version on next launch; progress is kept (cards are keyed by Anki note id).

## Develop

```
python3 -m http.server 8410
node --test tests/*.test.js
```

## Audio
Lecture recordings live in `audio/` (`index.json` lists them: id, title, course, duration, chapters). The Audio tab plays them with 15-second back/forward, chapters, speed, resume, and lock-screen controls. "Save for offline" keeps a copy in IndexedDB (the service worker skips audio so iOS byte-range playback works). Add a lecture: copy the .m4a into `audio/` and add an entry to `audio/index.json` (chapters are `{t: seconds, title}`).

## Video lectures

Open **Lectures → Videos** for the animated RCP 202 final-review lessons. Native video controls include fullscreen and English captions; chapter jumps, speed, 15-second skips and per-device resume are also available. Use **Save offline** on each video to store the video and captions in IndexedDB. Downloads are optional; MP4 files bypass the service worker to preserve byte-range playback. Existing audio remains under **Lectures → Audio**.

`videos/index.json` lists the twelve chapter MP4s (flat-illustration versions, compressed for the web from the masters), WebVTT captions, transcripts, content-hash versions and chapters. A thirteenth entry, `rcp202-final-12-elevenlabs`, is a trial of chapter 12 re-voiced with ElevenLabs; its build lives in `~/Documents/RCP 202 Video Lectures/reviews/flat-series/12-elevenlabs/`. Current exports preserve the lecture project's pronunciation-review status. Full-quality masters are in `~/Documents/RCP 202 Video Lectures/videos/`, and the earlier, pre-flat versions are kept in `~/Documents/RCP 202 Video Lectures/videos-before-flat/`; updating Recall deletes neither.

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
python3 tools/import_guide.py path/to/RCP_203_Tier3_StudyGuideOnly.html rcp203-tier3 "RCP 203 Tier 3" "Study guide scope"
```

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

# Recall

Anki-style flashcards for your phone. Offline PWA, no account, data stays on the device.

- **Scheduling:** Anki's SM-2 defaults — learning steps 1m/10m, graduate 1d, easy 4d, 250% start ease, 4 am day rollover, fuzz, leech tag at 8 lapses. Per-deck daily limits that cap subdecks like Anki.
- **Study:** Again/Hard/Good/Easy with interval previews, undo, bury, suspend, mark, edit.
- **Decks:** built-in bundle (`decks/`), plus import of Anki `.apkg`/`.colpkg` (old and new zstd formats, optional review progress, media), plain-text `.txt/.csv`, and Recall `.json`.
- **Browse:** search text, `deck:`, `tag:`, `is:new|due|learn|suspended`, `-negation`.
- **Stats**, **backup/restore** (one JSON file).

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

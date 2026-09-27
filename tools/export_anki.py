#!/usr/bin/env python3
"""Export cards from desktop Anki (via AnkiConnect) into a bundled Recall deck file.

Usage: python3 tools/export_anki.py [QUERY] [OUT]
  QUERY  Anki search (default: 'deck:RCP*')
  OUT    output JSON (default: decks/rcp.json)

Anki must be running with AnkiConnect on localhost:8765.
Card keys are 'n<noteId>-<ord>', the same keys an .apkg import produces, so the
phone keeps review progress when the bundle is updated.
"""
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QUERY = sys.argv[1] if len(sys.argv) > 1 else "deck:RCP*"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "decks" / "rcp.json"


def anki(action, **params):
    req = urllib.request.Request(
        "http://localhost:8765",
        json.dumps({"action": action, "version": 6, "params": params}).encode(),
    )
    res = json.loads(urllib.request.urlopen(req).read())
    if res.get("error"):
        raise SystemExit(f"AnkiConnect {action}: {res['error']}")
    return res["result"]


STYLE = re.compile(r"<style>.*?</style>", re.S)


def clean(html):
    return STYLE.sub("", html).strip()


def main():
    card_ids = anki("findCards", query=QUERY)
    if not card_ids:
        raise SystemExit(f"No cards match {QUERY!r}")
    cards = []
    for i in range(0, len(card_ids), 500):
        cards += anki("cardsInfo", cards=card_ids[i : i + 500])
    note_ids = sorted({c["note"] for c in cards})
    tags = {}
    for i in range(0, len(note_ids), 500):
        for n in anki("notesInfo", notes=note_ids[i : i + 500]):
            tags[n["noteId"]] = n["tags"]

    # Anki's own new-card order: note creation (note id), then card ord.
    cards.sort(key=lambda c: (c["note"], c["ord"]))
    out = {
        "id": "rcp",
        "name": "RCP decks",
        "version": int(time.time()),
        "query": QUERY,
        "cards": [
            {
                "k": f"n{c['note']}-{c['ord']}",
                "d": c["deckName"],
                "q": clean(c["question"]),
                "a": clean(c["answer"]),
                "t": tags.get(c["note"], []),
            }
            for c in cards
        ],
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    # The app installs/updates a bundle when this version is newer than the phone's copy.
    index = OUT.parent / "index.json"
    decks_idx = json.loads(index.read_text())["decks"] if index.exists() else []
    decks_idx = [d for d in decks_idx if d["id"] != out["id"]] + [
        {"id": out["id"], "name": out["name"], "file": OUT.name, "version": out["version"]}
    ]
    index.write_text(json.dumps({"decks": decks_idx}, indent=1) + "\n")

    # Self-check: every Anki card landed exactly once, none empty.
    keys = [c["k"] for c in out["cards"]]
    assert len(keys) == len(set(keys)) == len(card_ids), "card count mismatch"
    assert all(c["q"] and c["a"] for c in out["cards"]), "empty card side"
    decks = {}
    for c in out["cards"]:
        decks[c["d"]] = decks.get(c["d"], 0) + 1
    print(f"{len(keys)} cards, {len(decks)} decks -> {OUT} ({OUT.stat().st_size // 1024} KB)")
    for d in sorted(decks):
        print(f"  {decks[d]:5}  {d}")


if __name__ == "__main__":
    main()

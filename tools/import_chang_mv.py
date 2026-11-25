#!/usr/bin/env python3
"""Build the "Chang · Mechanical Ventilation" drill from the original Chang practice bank.

Usage: python3 tools/import_chang_mv.py [chang_bank.json]
Source default: ~/chang-mv-trainer/bank/final/chang_bank.json (1,576 original questions written from Chang,
Clinical Application of Mechanical Ventilation, 4th ed.; every item tied to a book page and verified quote;
cross-audited by Codex/Gemini/Sonnet; two blind checks agreed with the key). Not the publisher's test bank.
One section per chapter; option 0 is the correct answer (the app shuffles). The book quotes are not copied.
Listed in its own Study-tab section via "group" in drills/index.json.
"""
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "chang-mv-trainer/bank/final/chang_bank.json"
DID, TITLE, GROUP = "chang-mv", "Chang · Mechanical Ventilation", "Mechanical Ventilation (Chang)"

bank = json.loads(SRC.read_text())
sections = []
for ch in sorted({r["ch"] for r in bank}):
    rows = [r for r in bank if r["ch"] == ch]
    qs = []
    for r in rows:
        opts = [r["answer_text"]] + [o for o in r["options"] if o != r["answer_text"]]
        assert len(opts) == 4 and len(set(opts)) == 4 and r["options"][ "ABCD".index(r["answer"])] == r["answer_text"], r["id"]
        qs.append({"q": r["stem"], "o": opts, "e": f"{r['rationale'].strip()} (Chang 4th ed., p. {r['book_page']})", "src": f"Chang p. {r['book_page']}"})
    pages = [r["book_page"] for r in rows]
    sections.append({"id": f"ch{ch:02d}", "title": f"Ch {ch} · {rows[0]['chapter']}",
                     "covers": f"{len(qs)} questions · book pp. {min(pages)}–{max(pages)}", "q": qs})

n = sum(len(s["q"]) for s in sections)
assert n == len(bank), (n, len(bank))
out = {"id": DID, "title": TITLE, "version": int(time.time()), "sections": sections}
dest = ROOT / "drills" / f"{DID}.json"
dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))

index = ROOT / "drills" / "index.json"
idx = json.loads(index.read_text())["drills"]
idx = [d for d in idx if d["id"] != DID] + [{"id": DID, "title": TITLE, "file": dest.name, "version": out["version"], "count": n, "group": GROUP}]
index.write_text(json.dumps({"drills": idx}, ensure_ascii=False, indent=1) + "\n")
print(f"wrote {dest.relative_to(ROOT)}: {n} questions in {len(sections)} sections; index updated")

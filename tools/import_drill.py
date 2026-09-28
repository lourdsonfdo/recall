#!/usr/bin/env python3
"""Copy a Midterm Drill question bank (the `const BANK = [...]` in the drill HTML) into drills/.

Usage: python3 tools/import_drill.py DRILL.html ID "Title"
  e.g. python3 tools/import_drill.py RCP_203_Midterm_Drill.html rcp203 "RCP 203 Midterm"
Questions are copied verbatim; option 0 is the correct answer (the app shuffles them).
"""
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
src, did, title = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
html = src.read_text()
m = re.search(r"const BANK\s*=\s*(\[.*?\]);\s*\n", html, re.S)
if not m:
    raise SystemExit("No `const BANK = [...]` found in " + str(src))
bank = json.loads(m.group(1))

# Integrity: every question has a stem, 4 distinct options, an explanation and a source.
n = 0
for s in bank:
    assert s["id"] and s["title"] and s["q"], s.get("id")
    for q in s["q"]:
        assert q["q"].strip() and q["e"].strip(), q
        assert len(q["o"]) == 4 and len(set(q["o"])) == 4, q["q"]
        n += 1
    for sub in s.get("subs", []):
        hits = [q for q in s["q"] if q["src"] in sub["srcs"]]
        assert hits, f"subsection {sub['id']} matches no questions"

out = {"id": did, "title": title, "version": int(time.time()), "sections": bank}
dest = ROOT / "drills" / f"{did}.json"
dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))

index = ROOT / "drills" / "index.json"
idx = json.loads(index.read_text())["drills"] if index.exists() else []
idx = [d for d in idx if d["id"] != did] + [{"id": did, "title": title, "file": dest.name, "version": out["version"], "count": n}]
idx.sort(key=lambda d: d["id"])
index.write_text(json.dumps({"drills": idx}, indent=1) + "\n")
print(f"{did}: {n} questions, {len(bank)} sections -> {dest.relative_to(ROOT)}")
for s in bank:
    subs = f"  ({len(s['subs'])} subsections)" if s.get("subs") else ""
    print(f"  {s['id']}  {len(s['q']):3}  {s['title']}{subs}")

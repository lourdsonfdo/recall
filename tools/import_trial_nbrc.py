#!/usr/bin/env python3
"""Build the "Trial NBRC Exam" drill from the Gemini-drafted 160-question RTE practice set.

Usage: python3 tools/import_trial_nbrc.py [ASSEMBLED_160.jsonl]
Source default: ~/rcp-tmc-trainer/rte/_work/gemini160/ASSEMBLED_160.jsonl (100 breadth + 60 clinical judgment,
built to the 2027 NBRC RTE blueprint; facts from Heuer & Rodriguez 4th ed.; Codex-audited).
Questions are copied verbatim; option 0 is the correct answer (the app shuffles). The drill is listed in its own
Study-tab section via "group" in drills/index.json.
"""
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "rcp-tmc-trainer/rte/_work/gemini160/ASSEMBLED_160.jsonl"
BP = json.loads((Path.home() / "rcp-tmc-trainer/rte/blueprint.json").read_text())
DID, TITLE, GROUP = "trial-nbrc", "Trial NBRC Exam", "Trial NBRC Exam"

rows = [json.loads(l) for l in SRC.read_text().splitlines() if l.strip()]
assert len(rows) == 160, len(rows)


def item(r):
    assert r["key"] == 0 and len(r["opts"]) == 4 and len(set(r["opts"])) == 4, r["id"]
    stem = (r["scenario"].strip() + " " if r.get("scenario") else "") + r["stem"].strip()
    lines = ", ".join(f"{a}–{b}" for a, b in r["src"])
    return {"q": stem, "o": r["opts"], "e": f"{r['why'].strip()} (Heuer & Rodriguez 4th ed., lines {lines})", "src": r["topic"]}


sections = []
for sec, b in BP["breadth"].items():
    qs = [item(r) for r in rows if r.get("sec") == sec]
    assert len(qs) == b["recall"] + b["integ"], (sec, len(qs))
    sections.append({"id": "b-" + sec, "title": f"{sec} · {b['title']}", "covers": f"Breadth of knowledge · {b['recall']} recall + {b['integ']} integration", "q": qs})
for cell, c in BP["depth"]["cells"].items():
    qs = [item(r) for r in rows if r.get("cell") == cell]
    assert len(qs) == c["n"], (cell, len(qs))
    sections.append({"id": "cj-" + cell, "title": f"Clinical judgment · {c['title']}", "covers": f"Depth of clinical judgment · {c['n']} cases", "q": qs})

n = sum(len(s["q"]) for s in sections)
assert n == 160, n
out = {"id": DID, "title": TITLE, "version": int(time.time()), "sections": sections}
dest = ROOT / "drills" / f"{DID}.json"
dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))

index = ROOT / "drills" / "index.json"
idx = json.loads(index.read_text())["drills"]
idx = [d for d in idx if d["id"] != DID] + [{"id": DID, "title": TITLE, "file": dest.name, "version": out["version"], "count": n, "group": GROUP}]
index.write_text(json.dumps({"drills": idx}, ensure_ascii=False, indent=1) + "\n")
print(f"wrote {dest.relative_to(ROOT)}: {n} questions in {len(sections)} sections; index updated")

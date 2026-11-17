"""Build Codex audit batches of changed questions: python3 tools/final-fixes/mkaudit.py <drill id> <out dir> [last N pass2 entries]"""
import json, sys
from pathlib import Path
T = Path(__file__).parent
did, out = sys.argv[1], Path(sys.argv[2])
orig = json.load(open(T / f"{did}.orig.json"))
new = json.loads(json.dumps(orig)); secs = {s["id"]: s for s in new["sections"]}
def ap(q, stem, opts):
    if stem: q["q"] = stem
    if opts: q["o"] = [n if n else o for n, o in zip(opts, q["o"])]
for s in new["sections"]:
    for fx in json.load(open(T / did / f"{s['id']}.json")): ap(s["q"][fx[0]], fx[1], fx[2])
p2 = json.load(open(T / did / "pass2.json"))
for sid, i, stem, opts in p2: ap(secs[sid]["q"][i], stem, opts)
only = None
if len(sys.argv) > 3:
    only = {(sid, i) for sid, i, *_ in p2[-int(sys.argv[3]):]}
groups = {}
for so, sn in zip(orig["sections"], new["sections"]):
    for i, (a, b) in enumerate(zip(so["q"], sn["q"])):
        if a == b or (only is not None and (so["id"], i) not in only): continue
        it = {"id": f"{so['id']}-{i}", "topic": b["src"], "stem": b["q"], "correct": b["o"][0], "distractors": b["o"][1:], "explanation": b["e"], "old_distractors": a["o"][1:]}
        if a["q"] != b["q"]: it["old_stem"] = a["q"]
        if a["o"][0] != b["o"][0]: it["old_correct"] = a["o"][0]
        groups.setdefault(so["id"], []).append(it)
n = 0
for sid, its in groups.items():
    parts = [its] if len(its) <= 110 else [its[:len(its)//2], its[len(its)//2:]]
    for p in parts:
        n += 1
        tag = f"x{n}" if only is not None else str(n)
        json.dump({"section": sid, "items": p}, open(out / f"batch{tag}.json", "w"), ensure_ascii=False, indent=1)
        print(tag, sid, len(p))

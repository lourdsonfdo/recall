"""Board-style rewrites for a Final drill bank.

usage: python3 tools/final_fixes.py rcp202-final show s01      # print a section (original text)
       python3 tools/final_fixes.py rcp202-final check         # apply in memory, report
       python3 tools/final_fixes.py rcp202-final write         # write drills/<id>.json + index.json

Base text = tools/final-fixes/<id>.orig.json (the bank before rewrites).
Fixes = tools/final-fixes/<id>/<section>.json: list of [index, stem|null, [correct|null, d1|null, d2|null, d3|null], expl?]
(null = keep). Option 0 stays the correct answer.
"""
import json, re, sys, time, glob, os
from pathlib import Path
T = Path(__file__).parent
did, cmd = sys.argv[1], sys.argv[2]
base = json.load(open(T / "final-fixes" / f"{did}.orig.json"))
ABS = re.compile(r"\b(always|never|only|all|none|every|any|nothing|no effect|not controlled)\b", re.I)

if cmd == "show":
    for s in base["sections"]:
        if s["id"] != sys.argv[3]:
            continue
        for i, q in enumerate(s["q"]):
            L = [len(o) for o in q["o"]]
            flag = "L" if L[0] > max(L[1:]) else ("s" if L[0] < min(L[1:]) else " ")
            print(f"{i}{flag} {q['q']}\n   * {q['o'][0]}\n   - " + "\n   - ".join(q["o"][1:]) + f"\n   e: {q['e']}")
    sys.exit()

errors, changed_correct, nfix = [], [], 0
for s in base["sections"]:
    f = T / "final-fixes" / did / f"{s['id']}.json"
    if not f.exists():
        continue
    seen = set()
    for fx in json.load(open(f)):
        i, stem, opts = fx[0], fx[1], fx[2]
        if i in seen:
            errors.append((s["id"], i, "fixed twice"))
        seen.add(i)
        q = s["q"][i]
        if stem:
            q["q"] = stem
        if opts:
            if len(opts) != 4:
                errors.append((s["id"], i, "need 4 option slots")); continue
            if opts[0] and opts[0] != q["o"][0]:
                changed_correct.append((s["id"], i, q["o"][0], opts[0]))
            q["o"] = [n if n else o for n, o in zip(opts, q["o"])]
        if len(fx) > 3 and fx[3]:
            q["e"] = fx[3]
        nfix += 1

p2 = T / "final-fixes" / did / "pass2.json"
if p2.exists():
    secs = {s["id"]: s for s in base["sections"]}
    for sid, i, stem, opts in json.load(open(p2)):
        q = secs[sid]["q"][i]
        if stem:
            q["q"] = stem
        if opts:
            if opts[0] and opts[0] != q["o"][0]:
                changed_correct.append((sid, i, q["o"][0], opts[0]))
            q["o"] = [n if n else o for n, o in zip(opts, q["o"])]
        nfix += 1
stems = {}
tot = longest = shortest = abscue = 0
for s in base["sections"]:
    n = l = 0
    for i, q in enumerate(s["q"]):
        o = q["o"]
        if len({x.strip().lower() for x in o}) != 4:
            errors.append((s["id"], i, "options not distinct"))
        if any(re.search(r"(all|none) of the above", x, re.I) for x in o):
            errors.append((s["id"], i, "AOTA"))
        k = re.sub(r"\W+", " ", q["q"].lower()).strip()
        if k in stems:
            errors.append((s["id"], i, "dup stem", stems[k]))
        stems[k] = (s["id"], i)
        L = [len(x) for x in o]
        n += 1
        l += L[0] > max(L[1:])
        shortest += L[0] < min(L[1:])
        if cmd == "check" and "-v" in sys.argv:
            a = [bool(ABS.search(x)) for x in o]
            if (not a[0] and sum(a[1:]) >= 2) or L[0] > 1.6 * (sum(L[1:]) / 3) or L[0] > max(L[1:]) + 25:
                print("CUE", s["id"], i, "|", q["q"], "|", " / ".join(o))
    tot += n; longest += l
    print(f"{s['id']} {n:4} longest {l/n:4.0%}")
if cmd == "gap":
    N = int(sys.argv[3])
    for s_ in base["sections"]:
        for i, q in enumerate(s_["q"]):
            L = [len(x) for x in q["o"]]
            if L[0] >= max(L[1:]) + N:
                print(f"{s_['id']} {i} | {q['q']}\n   * " + "\n   - ".join(q["o"]))
    sys.exit()
print(f"{nfix} fixes; correct uniquely longest {longest}/{tot} = {longest/tot:.0%}; uniquely shortest {shortest/tot:.0%}")
if "-c" in sys.argv:
    for c in changed_correct:
        print("CORRECT CHANGED", c)
print("correct answers reworded:", len(changed_correct))
for e in errors:
    print("ERROR", e)
if errors:
    sys.exit(1)
if cmd == "write":
    base["version"] = int(time.time())
    R = T.parent / "drills"
    (R / f"{did}.json").write_text(json.dumps(base, ensure_ascii=False, separators=(",", ":")))
    idx = json.loads((R / "index.json").read_text())
    for d in idx["drills"]:
        if d["id"] == did:
            d["version"] = base["version"]; d["count"] = tot
    (R / "index.json").write_text(json.dumps(idx, indent=1) + "\n")
    print("wrote", did)

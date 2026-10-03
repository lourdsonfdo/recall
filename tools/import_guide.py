#!/usr/bin/env python3
"""Copy a study-guide HTML page into guides/ (unchanged) and list it in guides/index.json.

Usage: python3 tools/import_guide.py GUIDE.html ID "Title" "Subtitle" [--app]
  --app  the page is an interactive tool with its own scripts (e.g. the TMC/CSE trainer);
         it is listed under "Board exam prep" instead of "Study guides".
"""
import hashlib
import json
import re
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
args = [a for a in sys.argv[1:] if a != "--app"]
is_app = "--app" in sys.argv
src, gid, title, sub = Path(args[0]), args[1], args[2], args[3]
html = src.read_text()
if not is_app:
    assert "<script" not in html.lower(), "guide pages must be static (no scripts); use --app for interactive tools"
dest = ROOT / "guides" / f"{gid}.html"
shutil.copyfile(src, dest)
assert hashlib.sha256(src.read_bytes()).hexdigest() == hashlib.sha256(dest.read_bytes()).hexdigest()
stat = re.search(r'class="statline">([^<]*)', html)
index = ROOT / "guides" / "index.json"
idx = json.loads(index.read_text())["guides"] if index.exists() else []
idx = [g for g in idx if g["id"] != gid] + [{
    "id": gid, "title": title, "subtitle": sub, "file": dest.name, "version": int(time.time()),
    "stat": re.sub(r"&middot;", "·", stat.group(1)).strip() if stat else "",
    **({"kind": "app"} if is_app else {}),
}]
idx.sort(key=lambda g: g["id"])
index.write_text(json.dumps({"guides": idx}, indent=1, ensure_ascii=False) + "\n")
print(f"{gid}: {dest.relative_to(ROOT)} ({dest.stat().st_size // 1024} KB) identical to source")

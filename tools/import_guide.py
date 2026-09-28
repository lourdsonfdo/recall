#!/usr/bin/env python3
"""Copy a study-guide HTML page into guides/ (unchanged) and list it in guides/index.json.

Usage: python3 tools/import_guide.py GUIDE.html ID "Title" "Subtitle"
"""
import hashlib
import json
import re
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
src, gid, title, sub = Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
html = src.read_text()
assert "<script" not in html.lower(), "guide pages must be static (no scripts)"
dest = ROOT / "guides" / f"{gid}.html"
shutil.copyfile(src, dest)
assert hashlib.sha256(src.read_bytes()).hexdigest() == hashlib.sha256(dest.read_bytes()).hexdigest()
stat = re.search(r'class="statline">([^<]*)', html)
index = ROOT / "guides" / "index.json"
idx = json.loads(index.read_text())["guides"] if index.exists() else []
idx = [g for g in idx if g["id"] != gid] + [{
    "id": gid, "title": title, "subtitle": sub, "file": dest.name, "version": int(time.time()),
    "stat": re.sub(r"&middot;", "·", stat.group(1)).strip() if stat else "",
}]
idx.sort(key=lambda g: g["id"])
index.write_text(json.dumps({"guides": idx}, indent=1, ensure_ascii=False) + "\n")
print(f"{gid}: {dest.relative_to(ROOT)} ({dest.stat().st_size // 1024} KB) identical to source")

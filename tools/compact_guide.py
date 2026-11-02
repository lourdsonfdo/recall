#!/usr/bin/env python3
"""Make a Final guide quicker to read without removing anything.

Usage: compact_guide.py <in.html> <out.html>

Source lines become tap-to-open <details>, and the two reference sections
(Conflicting Numbers, Still Not Covered) are folded closed. Card bodies and
the "Why it matters" / Book fill / Exam anchor blocks are left untouched.
The page stays static (import_guide.py rejects scripts). Run on a copy, then
pass that copy to import_guide.py.
"""
import re, sys

CSS = """
details.src{padding:0;background:var(--surface);border-top:1px solid var(--line)}
details.src>summary{cursor:pointer;list-style:none;padding:7px 15px;font-family:"IBM Plex Mono",monospace;font-size:9.6px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3)}
details.src>summary::-webkit-details-marker{display:none}
details.src>summary::before{content:"\\25B8  "}
details.src[open]>summary::before{content:"\\25BE  "}
details.src>div{padding:2px 15px 9px;font-family:"IBM Plex Mono",monospace;font-size:11px;line-height:1.5;color:var(--ink-3)}
details.fold>summary{cursor:pointer;margin:10px 0;padding:10px 14px;border:1px solid var(--line);border-radius:4px;background:var(--surface);font-weight:600;list-style:none}
details.fold>summary::before{content:"\\25B8  "}
details.fold[open]>summary::before{content:"\\25BE  "}
@media print{details.src>summary{display:none}}
"""

def main(src, dst):
    h = open(src, encoding="utf8").read()
    if "<!--compact-->" in h:
        open(dst, "w", encoding="utf8").write(h); return
    n_src = 0
    def src_sub(m):
        nonlocal n_src; n_src += 1
        return '<details class="src"><summary>Source</summary><div>%s</div></details>' % m.group(1)
    h = re.sub(r'<div class="src"><strong>Source</strong>(.*?)</div>', src_sub, h, flags=re.S)
    folds = 0
    for sid, label in (("conflicts", "Show the source-conflict tables"), ("gaps", "Show what is still not covered")):
        m = re.search(r'(<section id="%s">.*?<p class="sdek">.*?</p>)(.*?)(</section>)' % sid, h, re.S)
        assert m, sid
        h = h[:m.start()] + m.group(1) + '<details class="fold"><summary>%s</summary>%s</details>' % (label, m.group(2)) + m.group(3) + h[m.end():]
        folds += 1
    assert "</style>" in h
    h = h.replace("</style>", CSS + "</style>", 1)
    h = h.replace("<head>", "<head><!--compact-->", 1)
    open(dst, "w", encoding="utf8").write(h)
    print("source lines folded: %d, sections folded: %d" % (n_src, folds))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

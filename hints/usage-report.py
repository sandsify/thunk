#!/usr/bin/env python3
"""A table of the usage counts (hints/server.py, EVENT_LOG): one row per
page and block, with the button presses on it. "visits" is the number of
page visits (a random number per page load) that pressed any button on
the block; "visits passed" those of them whose Check passed.

    hints/usage-report.py events.jsonl [--since 2026-11-12] [--page 02B]

To get the log from the server:
    ssh SERVER 'cd thunk/deploy && docker compose exec -T hints cat /var/log/hints/events.jsonl' > events.jsonl
"""
import argparse, json, re
from collections import Counter, defaultdict

COLUMNS = [("load", "loads"), ("visits", "visits"), ("visits-passed", "visits passed"), ("run", "runs"), ("run-edited", "edited runs"), ("run-error", "run errors"),
           ("check", "checks"), ("check-pass", "passes"), ("hint", "Hint"), ("ai-fix", "AI hints"),
           ("ai-explain", "explain"), ("show-solution", "solution"), ("show-definition", "definition"),
           ("reset", "resets")]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("log")
    ap.add_argument("--since", default="")
    ap.add_argument("--page", default="")
    a = ap.parse_args()
    rows = defaultdict(Counter)
    visits, passed = defaultdict(set), defaultdict(set)
    for line in open(a.log, encoding="utf-8"):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e["time"] < a.since or a.page not in e["page"]:
            continue
        # A block page (build-canvas.sh) (/02B/5.html) is block 5 of 02B; a whole
        # page (02B.html, meetings/02B.1.html) keeps its own numbering.
        page, block = e["page"], e["block"]
        m = re.search(r"/(\w+)/(\d+)\.html$", page)
        if m and not page.endswith("/meetings/" + m.group(2) + ".html"):
            page, block = m.group(1), int(m.group(2))
        else:
            page = re.sub(r"^.*/notes/", "", page).lstrip("/").removesuffix(".html")
        c = rows[(page, block)]
        act = e["action"]
        c[act] += 1
        if act == "run":
            c["run-edited"] += e.get("edited", False)
            c["run-error"] += e.get("outcome") == "error"
        if act in ("check", "hint"):
            c["check-pass"] += e.get("outcome") == "pass"
        if act != "load" and e.get("visit"):
            visits[(page, block)].add(e["visit"])
            if act in ("check", "hint") and e.get("outcome") == "pass":
                passed[(page, block)].add(e["visit"])
    print("| page | block | " + " | ".join(h for _, h in COLUMNS) + " |")
    print("|---|---:|" + "---:|" * len(COLUMNS))
    for (page, block) in sorted(rows):
        c = rows[(page, block)]
        c["visits"], c["visits-passed"] = len(visits[(page, block)]), len(passed[(page, block)])
        print(f"| {page} | {block or ''} | " + " | ".join(str(c[k] or "") for k, _ in COLUMNS) + " |")

if __name__ == "__main__":
    main()

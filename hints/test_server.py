#!/usr/bin/env python3
"""Offline tests of the hint service: the checks on answers, the limits,
and the HTTP side with the mock provider. No model is called."""
import json, os, subprocess, sys, time, urllib.request, urllib.error
from pathlib import Path

os.environ.update(HINT_PROVIDER="mock", HINT_PER_MINUTE="2", HINT_PER_DAY="3", HINT_TOTAL_PER_DAY="5")
sys.path.insert(0, str(Path(__file__).parent))
import server

req = {"page": "p", "mode": "", "level": "", "previous": "", "exercise": "Define `hanoi`.", "code": "hanoi n = undefined", "context": "",
       "tests": "prop_hanoi n = ...", "output": "Falsified: 3",
       "solution": "hanoi 0 = 0\nhanoi n = 2 * hanoi (n - 1) + 1  -- twice, plus one"}
fails = 0
def expect(name, got, want):
    global fails
    if got != want:
        fails += 1
        print(f"FAIL {name}: got {got!r}, want {want!r}")

# Checks on the answer.
expect("fine", server.problem("For n = 3 your `hanoi` gives an error: think about the base case.", req), None)
expect("empty", server.problem("  ", req), "empty")
expect("fence", server.problem("Try:\n```haskell\nhanoi 0 = 0\n```", req), "code block")
expect("indented", server.problem("Try:\n    hanoi 0 = 0", req), "code block")
expect("link", server.problem("See https://hoogle.haskell.org", req), "link")
expect("long", server.problem("word " * 250, req), "too long")
expect("solution", server.problem("Write hanoi n = 2 * hanoi (n - 1) + 1 instead.", req), "solution")
expect("own code ok", server.problem("Your line `hanoi n = undefined` is still there.", req), None)
expect("long quote", server.problem("Use `hanoi n = if n == 0 then 0 else 1 + 2 * hanoi (n - 1) * 1`.", req), "long code")

# The user message has numbered code and every part.
m = server.user_message({**req, "code": "a = 1\nb = 2"})
expect("numbered", "  2 | b = 2" in m, True)
expect("parts", all(t in m for t in ["YOUR TASK", "EXERCISE", "STUDENT'S CODE", "OTHER CODE", "HIDDEN TESTS", "OUTPUT", "REFERENCE"]), True)
expect("default task", "a short nudge" in m, True)
m = server.user_message({**req, "mode": "fix", "level": "2", "previous": "Look at line 2."})
expect("level 2", "more specific" in m and "EARLIER HINTS" in m and "Look at line 2." in m, True)
m = server.user_message({**req, "mode": "fix", "level": "9", "previous": ""})
expect("level capped", "step by step" in m, True)
m = server.user_message({**req, "mode": "style", "level": "3", "previous": "x"})
expect("style", "feedback on style" in m and "EARLIER HINTS" not in m, True)
m = server.user_message({**req, "mode": "explain", "level": "1", "tests": "", "solution": ""})
expect("explain", "pressed Run" in m and "HIDDEN TESTS" not in m and "REFERENCE" not in m, True)
m = server.user_message({**req, "mode": "bogus", "level": "x"})
expect("bad mode", "a short nudge" in m, True)

# Limits: 2 a minute and 3 a day per IP, 5 a day in all.
t = 1_000_000.0
expect("1", server.allow("a", t), None)
expect("2", server.allow("a", t + 1), None)
expect("3 in a minute", server.allow("a", t + 2) is not None, True)
expect("3 later", server.allow("a", t + 120), None)
expect("4 a day", server.allow("a", t + 300) is not None, True)
expect("b1", server.allow("b", t + 301), None)
expect("c1", server.allow("c", t + 302), None)
expect("total", server.allow("d", t + 303) is not None, True)

# HTTP, with the mock provider.
EVENT_LOG = Path(os.environ.get("TMPDIR", "/tmp")) / "events-test.jsonl"
EVENT_LOG.unlink(missing_ok=True)
port = "18124"
proc = subprocess.Popen([sys.executable, str(Path(__file__).with_name("server.py"))],
                        env={**os.environ, "PORT": port, "HINT_LOG": str(Path(os.environ.get("TMPDIR", "/tmp")) / "hints-test.jsonl"), "HINT_PER_DAY": "40", "HINT_TOTAL_PER_DAY": "40",
                             "HINT_PER_MINUTE": "40", "EVENT_LOG": str(EVENT_LOG)}, stderr=subprocess.DEVNULL)
try:
    time.sleep(0.7)
    def post(origin, body):
        r = urllib.request.Request(f"http://127.0.0.1:{port}/hint", json.dumps(body).encode(),
                                   {"Content-Type": "application/json", "Origin": origin})
        try:
            with urllib.request.urlopen(r) as resp:
                return resp.status, json.load(resp), resp.headers.get("Access-Control-Allow-Origin")
        except urllib.error.HTTPError as e:
            return e.code, json.load(e), None
    status, body, cors = post("http://localhost:8000", req)
    expect("ok status", status, 200)
    expect("ok hint", bool(body["hint"]), True)
    expect("cors", cors, "http://localhost:8000")
    status, body, _ = post("https://evil.example", req)
    expect("origin", status, 403)

    # Usage counts (POST /event), sent as text/plain like sendBeacon does.
    def event(origin, data):
        r = urllib.request.Request(f"http://127.0.0.1:{port}/event", data,
                                   {"Content-Type": "text/plain", "Origin": origin})
        try:
            with urllib.request.urlopen(r) as resp:
                return resp.status
        except urllib.error.HTTPError as e:
            return e.code
    ev = {"page": "/~dave/fp/notes/02B/5.html", "block": 1, "kind": "exercise",
          "action": "check", "outcome": "pass", "edited": True, "visit": "a1b2c3d4e5f6", "code": "secret"}
    expect("event ok", event("http://localhost:8000", json.dumps(ev).encode()), 204)
    expect("event origin", event("https://evil.example", json.dumps(ev).encode()), 403)
    expect("event bad", event("http://localhost:8000", b"not json"), 400)
    logged = [json.loads(l) for l in EVENT_LOG.read_text().splitlines()]
    expect("event logged", [(e["action"], e["outcome"], e["edited"], e["visit"]) for e in logged], [("check", "pass", True, "a1b2c3d4e5f6")])
    expect("event no code", "code" in logged[0], False)
finally:
    proc.terminate()

print("all hint tests passed" if not fails else f"{fails} failed")
sys.exit(1 if fails else 0)

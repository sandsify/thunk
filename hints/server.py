#!/usr/bin/env python3
"""Hints: AI feedback on a failed Check, for the lecture pages.

POST /hint with JSON {page, mode, level, previous, exercise, code,
context, tests, output, solution}: what to do (mode "fix" after a failed
Check, with level 1-3 and the earlier hints in previous; "style" after a
passing Check; "explain" for an error from Run), the exercise text, the
reader's code, code in scope from hidden or earlier blocks, the hidden
tests, the full output (GHC's errors and warnings, the failing tests
with their counterexamples, or GHCi's results), and the reference
solution.
gives {"hint": "..."} or {"hint": null, "why": "..."}. The widget calls
it only when the reader asks, after a failed Check.

Standard library only. Settings (environment):

  HINT_PROVIDER   gemini (default), openrouter, or mock (for tests)
  HINT_MODEL      the model, or several separated by commas: tried in
                  order when one is busy or out of quota (default for
                  gemini: gemini-3.5-flash,gemini-3.5-flash-lite)
  GEMINI_API_KEY / OPENROUTER_API_KEY
  HINT_ORIGINS    pages allowed to ask, comma-separated
                  (default http://localhost:8000; host:* for any port)
  HINT_PER_MINUTE  per IP address (30): only a script gets there. Many
                   readers can share one address (a campus network), so
                   keep it high
  HINT_PER_DAY     per IP address (0: no limit, for the same reason)
  HINT_TOTAL_PER_DAY  for everybody (0: no limit). On a free tier the
                   provider's own daily quota is the limit; with a paid
                   model, set it: it caps the cost
  HINT_TRUST_PROXY=1              take the IP from X-Forwarded-For (set
                                  only behind our own proxy)
  HINT_LOG        file for one JSON line per request (no code, no IP)
  PORT            8124
"""

import json
import os
import re
import sys
import time
import threading
import urllib.error
import urllib.request
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PROVIDER = os.environ.get("HINT_PROVIDER", "gemini")
MODEL = os.environ.get("HINT_MODEL") or {
    "gemini": "gemini-3.5-flash,gemini-3.5-flash-lite",
    "openrouter": "google/gemini-2.5-flash",
    "mock": "mock",
}.get(PROVIDER, "")
ORIGINS = {o.strip() for o in os.environ.get("HINT_ORIGINS", "http://localhost:8000").split(",") if o.strip()}
PER_MINUTE = int(os.environ.get("HINT_PER_MINUTE", "30"))
PER_DAY = int(os.environ.get("HINT_PER_DAY", "0"))
TOTAL_PER_DAY = int(os.environ.get("HINT_TOTAL_PER_DAY", "0"))
TRUST_PROXY = os.environ.get("HINT_TRUST_PROXY") == "1"
LOG = os.environ.get("HINT_LOG")
EVENT_LOG = os.environ.get("EVENT_LOG")
EVENTS_PER_MINUTE = int(os.environ.get("EVENTS_PER_MINUTE", "600"))
PROMPT = (Path(__file__).with_name("prompt.md")).read_text()

# The most we accept of each field, in characters.
LIMITS = {"page": 200, "mode": 10, "level": 2, "previous": 4000, "exercise": 6000, "code": 10000, "context": 10000, "tests": 8000,
          "output": 8000, "solution": 8000}
MAX_BODY = 80000
MAX_WORDS = 200

# What to do, per mode (and level for "fix"). Chosen here, not by the page.
TASKS = {
    ("fix", 1): "The student pressed Check and it failed, then asked for a hint. Give a short nudge "
                "(at most 60 words): where the problem is and what to look at, not how to fix it.",
    ("fix", 2): "The student pressed Check and it failed. They have had the hint under EARLIER HINTS "
                "and asked for more help. Be more specific (at most 100 words): what is wrong, and the "
                "idea of a fix, in words. Do not repeat the earlier hint.",
    ("fix", 3): "The student pressed Check and it failed. They have had the hints under EARLIER HINTS "
                "and are still stuck. Explain the fix step by step in words (at most 140 words): which "
                "cases or parts to change and how, naming functions where that helps. Still no code.",
    ("style", 1): "All the tests pass. The student asked for feedback on style. Give up to three "
                  "concrete suggestions (at most 120 words) that would make the code clearer or more "
                  "idiomatic Haskell for this point in the course: for example a library function or "
                  "pattern matching instead of hand-written recursion or guards, redundant cases or "
                  "brackets, names, or repeated code. Only real improvements: if the code is already "
                  "good, say so in one or two sentences and stop. Do not rewrite the code.",
    ("explain", 1): "The student pressed Run (not Check) and got an error. Explain the error in plain "
                    "words (at most 100 words): what it means and where in the code it comes from, and "
                    "hint at a fix. There may be no exercise: the code can be an example from the page.",
}


# --- Limits per IP address and per day --------------------------------

lock = threading.Lock()
recent = defaultdict(deque)          # ip -> times of requests in the last day
event_times = defaultdict(deque)  # per IP, for /event
today = {"day": None, "count": 0}


def allow(ip, now=None):
    """None if this request may go ahead, otherwise the reason."""
    now = now or time.time()
    day = time.strftime("%Y-%m-%d", time.gmtime(now))
    with lock:
        if today["day"] != day:
            today["day"], today["count"] = day, 0
            recent.clear()
        if TOTAL_PER_DAY and today["count"] >= TOTAL_PER_DAY:
            return "Hints are used up for today. Try again tomorrow."
        times = recent[ip]
        while times and times[0] < now - 86400:
            times.popleft()
        if PER_DAY and len(times) >= PER_DAY:
            return "That is all the hints for today from here. Try again tomorrow."
        if PER_MINUTE and sum(1 for t in times if t > now - 60) >= PER_MINUTE:
            return "Too many hints in a minute. Wait a little and try again."
        times.append(now)
        today["count"] += 1
        return None


# --- The model ---------------------------------------------------------

def numbered(code):
    """The code with line numbers, as GHC counts them in its messages."""
    return "\n".join(f"{i:3} | {line}" for i, line in enumerate(code.splitlines(), 1))


def task(req):
    mode = req["mode"] if req["mode"] in ("fix", "style", "explain") else "fix"
    level = int(req["level"]) if req["level"].isdigit() else 1
    return mode, max(1, min(level, 3)) if mode == "fix" else 1


def user_message(req):
    part = lambda title, text: f"=== {title} ===\n{text.strip() or '(empty)'}\n"
    mode, level = task(req)
    return "\n".join([
        part("YOUR TASK", TASKS[(mode, level)]),
        *([part("EARLIER HINTS", req["previous"])] if mode == "fix" and level > 1 else []),
        part("EXERCISE" if mode != "explain" else "TEXT ON THE PAGE", req["exercise"]),
        part("STUDENT'S CODE (Main.hs; the line numbers are GHC's)", numbered(req["code"])),
        part("OTHER CODE IN SCOPE (given on the page, not written by the student)", req["context"]),
        *([part("HIDDEN TESTS (added after the student's code)", req["tests"])] if req["tests"] else []),
        part("OUTPUT (compiler messages, failing tests, or GHCi's results)", req["output"]),
        *([part("REFERENCE SOLUTION (for you only)", req["solution"])] if req["solution"] else []),
    ])


def post(url, body, headers, timeout=40):
    data = json.dumps(body).encode()
    r = urllib.request.Request(url, data, {"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return json.load(resp)


def ask(system, user):
    """The answer of the first model in MODEL that gives one."""
    models = [m.strip() for m in MODEL.split(",") if m.strip()]
    for i, model in enumerate(models):
        try:
            return ask_model(model, system, user)
        except urllib.error.HTTPError as e:
            # Busy, out of quota, or gone: try the next model.
            if e.code not in (404, 429, 500, 503) or i == len(models) - 1:
                raise
            print(f"provider: {model}: {e.code}, trying the next model", file=sys.stderr)


def ask_model(model, system, user):
    if PROVIDER == "mock":
        return os.environ.get("HINT_MOCK_ANSWER", "Look at the counterexample: what does your code give for it?")
    if PROVIDER == "gemini":
        key = os.environ["GEMINI_API_KEY"]
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        r = post(url, {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 4000},
        }, {"x-goog-api-key": key})
        parts = r["candidates"][0]["content"]["parts"]
        return "".join(p.get("text", "") for p in parts if not p.get("thought"))
    if PROVIDER == "openrouter":
        key = os.environ["OPENROUTER_API_KEY"]
        r = post("https://openrouter.ai/api/v1/chat/completions", {
            "model": model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": 0.2,
            "max_tokens": 4000,
        }, {"Authorization": "Bearer " + key})
        return r["choices"][0]["message"]["content"]
    raise ValueError("unknown HINT_PROVIDER " + PROVIDER)


# --- Checks on the answer before the reader sees it -------------------

def norm(s):
    return re.sub(r"\s+", " ", s).strip()


def problem(answer, req):
    """None if the answer may be shown, otherwise why not."""
    if not answer.strip():
        return "empty"
    if "```" in answer or re.search(r"^( {4}|\t)\S", answer, re.M):
        return "code block"
    if re.search(r"https?://|www\.", answer):
        return "link"
    if len(answer.split()) > MAX_WORDS:
        return "too long"
    # No line of the reference solution (that is not already in the
    # reader's code or the exercise text) may appear in the answer.
    flat, known = norm(answer), norm(req["code"]) + " " + norm(req["exercise"])
    for line in req["solution"].splitlines():
        line = norm(line.split("--")[0])
        if len(line) >= 16 and line in flat and line not in known:
            return "solution"
    for m in re.finditer(r"`([^`]+)`", answer):
        quoted = norm(m.group(1))
        if len(quoted) > 40 and quoted not in known:
            return "long code"
    return None


def hint(req):
    try:
        answer = ask(PROMPT, user_message(req)).strip()
    except urllib.error.HTTPError as e:
        print("provider:", repr(e), file=sys.stderr)
        if e.code == 429:  # the provider's quota (on a free tier, for the day)
            return None, "Hints are used up for now. Try again later, or tomorrow."
        if e.code in (500, 502, 503):
            return None, "The AI service is busy. Try again in a minute."
        return None, "The AI service did not answer. Try again later."
    except Exception as e:  # network, timeout, an unexpected answer
        print("provider:", repr(e), file=sys.stderr)
        return None, "The AI service did not answer. Try again later."
    why = problem(answer, req)
    if why:
        print(f"held back ({why}): {answer[:300]!r}", file=sys.stderr)
        return None, f"No hint this time (the answer was held back: {why}). Try again, or ask a TA."
    return answer, None


# --- HTTP ----------------------------------------------------------------

def allowed(origin):
    """An origin in HINT_ORIGINS; "http://127.0.0.1:*" allows any port
    (for the tests)."""
    return origin in ORIGINS or any(
        o.endswith(":*") and origin.startswith(o[:-1]) and origin[len(o) - 1:].isdigit() for o in ORIGINS)


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        origin = self.headers.get("Origin", "")
        if allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        return allowed(origin)

    def reply(self, status, obj):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        if self.cors():
            self.send_header("Access-Control-Allow-Methods", "POST")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def event(self):
        """POST /event: one button press on a page (widget/notes.js, track),
        appended to EVENT_LOG. No code, no IP address, and no identity: a
        "visit" is a random number for one page load, kept only in the
        page's memory. A "visitor" id is accepted if the pages ever send one."""
        if not allowed(self.headers.get("Origin", "")):
            return self.reply(403, {"why": "only for the course pages"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > 2000:
            return self.reply(413, {"why": "too long"})
        try:
            raw = json.loads(self.rfile.read(n))
            ev = {"time": time.strftime("%Y-%m-%dT%H:%M:%S"),
                  "page": str(raw["page"])[:200], "block": int(raw.get("block", 0)),
                  "kind": str(raw.get("kind", ""))[:10], "action": str(raw["action"])[:20],
                  "outcome": str(raw.get("outcome", ""))[:10], "edited": bool(raw.get("edited"))}
            if raw.get("visit"):
                ev["visit"] = str(raw["visit"])[:16]
            if raw.get("visitor"):
                ev["visitor"] = str(raw["visitor"])[:64]
        except Exception:
            return self.reply(400, {"why": "bad request"})
        ip = self.client_address[0]
        if TRUST_PROXY and self.headers.get("X-Forwarded-For"):
            ip = self.headers["X-Forwarded-For"].split(",")[-1].strip()
        now = time.time()
        with lock:
            times = event_times[ip]
            while times and times[0] < now - 60:
                times.popleft()
            if len(times) >= EVENTS_PER_MINUTE:
                return self.reply(429, {"why": "too many"})
            times.append(now)
        if EVENT_LOG:
            with lock, open(EVENT_LOG, "a") as f:
                f.write(json.dumps(ev) + "\n")
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_POST(self):
        if self.path == "/event":
            return self.event()
        if self.path != "/hint":
            return self.reply(404, {"hint": None, "why": "not found"})
        if not allowed(self.headers.get("Origin", "")):
            return self.reply(403, {"hint": None, "why": "Hints are only for the course pages."})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            return self.reply(413, {"hint": None, "why": "The code is too long for a hint."})
        try:
            raw = json.loads(self.rfile.read(n))
            req = {k: str(raw.get(k, ""))[:limit] for k, limit in LIMITS.items()}
        except Exception:
            return self.reply(400, {"hint": None, "why": "bad request"})
        ip = self.client_address[0]
        if TRUST_PROXY and self.headers.get("X-Forwarded-For"):
            ip = self.headers["X-Forwarded-For"].split(",")[-1].strip()
        why = allow(ip)
        if why:
            print("limit:", why, file=sys.stderr)
            return self.reply(429, {"hint": None, "why": why})
        t0 = time.time()
        text, why = hint(req)
        if LOG:
            with open(LOG, "a") as f:
                f.write(json.dumps({"time": time.strftime("%Y-%m-%dT%H:%M:%S"), "page": req["page"],
                                    "task": "%s %d" % task(req),
                                    "model": MODEL, "ok": text is not None, "why": why,
                                    "seconds": round(time.time() - t0, 1)}) + "\n")
        self.reply(200, {"hint": text, "why": why})

    def log_message(self, fmt, *args):  # no IP addresses in the logs
        pass


def main():
    port = int(os.environ.get("PORT", "8124"))
    print(f"hints on port {port}: {PROVIDER} {MODEL}, origins {sorted(ORIGINS)}", file=sys.stderr)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()

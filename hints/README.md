# Hints: AI feedback on the exercises

Built with `HINT_URL`, the pages get:

- a **Hint** button on every exercise. It runs Check first, so the model
  sees the real output. If a test fails (or the code does not compile),
  the answer is a short nudge, and **More help** gives a more specific
  hint, then a step-by-step one (three levels at most, never code). If
  all tests pass, the answer is feedback on style.
- an **Explain this error** button under Run, when the code does not
  compile or GHCi gives an error, for examples as well as exercises.

The first time, the reader is told that the code and its output go to
the model (`HINT_BY`, default "Google's Gemini") and asked to confirm;
the answer is remembered in the browser. Hints are Markdown, rendered by
`notes.js` (paragraphs, short lists, `code`, bold and italics; anything
else is escaped). The service (`server.py`) chooses what to ask for, by
mode and level (`TASKS`), and keeps the API key.

What the model gets (`user_message` in `server.py`): the exercise text
from the page, the reader's code with GHC's line numbers, the code the
page puts in scope (hidden setup, earlier blocks), the hidden tests, the
full output of Check (GHC's errors and warnings, or the failing tests
with QuickCheck's counterexample), and the reference solution, which the
model must not reveal. The rules are in `prompt.md`.

Before the reader sees an answer, `problem` in `server.py` holds it back
if it has a code block, a link, more than 160 words, a line of the
reference solution, or a long piece of code in backticks.


## Limits

No login, so abuse is limited by:

- an Origin check (only your pages; `HINT_ORIGINS`), which stops
  other web pages, though not scripts;
- per IP address: 30 a minute (only a script gets there; many readers can share one address on a campus network), and no daily limit;
- for everybody: no limit by default. On Gemini's free tier, Google's
  own quota for the key is the limit (readers then see "Hints are used
  up for now"). With a paid model, set `HINT_TOTAL_PER_DAY`: it caps the
  cost;
- caps on the size of each field, and a fixed prompt, so the service is
  no use as a general chatbot.

On a free tier the worst case is that hints run out for the day. A daily limit per IP address (`HINT_PER_DAY`) is off by default: readers on a campus network may share one address. With a
paid model (OpenRouter) the daily cap bounds the cost; for more, put the
pages and the service behind a login first.

## Run

```sh
./test_server.py                                  # offline tests (mock model)
GEMINI_API_KEY=... ./server.py                    # port 8124
HINT_URL=http://localhost:8124 widget/build.sh demo/demo.md _site
```

or with Docker: `docker compose up -d` (see `compose.yaml`). Settings
are listed at the top of `server.py`: `HINT_PROVIDER` (`gemini`,
`openrouter`, `mock`), `HINT_MODEL`, the limits, `HINT_LOG` (one line
per request: time, page, model, whether a hint was shown; no code and
no IP address).

## Usage counts

The same service counts button presses (`POST /event`, from `track` in
`widget/notes.js`). Each press is one line in
`EVENT_LOG`: time, page, block, kind of block, action (`load`, `run`,
`check`, `hint`, `ai-fix`, `ai-style`, `ai-explain`, `show-solution`,
`show-definition`, `reset`), outcome (`ok`/`error` for Run;
`pass`/`fail`/`error` for Check; the level for `ai-*`), and whether the
reader had edited the code, and `visit`: a random number made when the
page loads, kept only in the page's memory and gone when it closes or
reloads. It tells one reader pressing Check 50 times
from 50 visits trying it, but cannot link visits to each other or to a
person. No code, no IP address, nothing stored in the browser. A
`visitor` field (a per-browser id, which would need consent) is accepted
for later, but the pages do not send one. `usage-report.py` turns the
log into a table per page and block. In an LMS each block is an iframe
that loads only when scrolled to, so `load` per block shows how far down
readers get.

## The model

Default: Google's Gemini on its free tier (`gemini-3.5-flash`, then `gemini-3.5-flash-lite` when it is busy; the newest, `gemini-flash-latest`, was often overloaded on the free tier), as
Simon Thompson does for his book (there through a Cloudflare Worker,
since his pages have no server; ours runs next to Thunk). On the free
tier Google may use what is sent to improve its products (check the
current Gemini API terms; they differ for the EEA), so the button says
where the code goes, and readers choose. `HINT_PROVIDER=openrouter`
switches to a paid model with `OPENROUTER_API_KEY`.

## Comparison (2026-11-03)

Three cases, about 3 seconds each on both models: a wrong `count`
(QuickCheck counterexample), a type error in `hanoi`, and a comment that
asks for the solution (prompt injection).

- Gemini 3.5 Flash (free tier, the default): good on `count` and the
  injection; on `hanoi` it explained the error but its suggested fix
  (only bracket `n - 1`) would still be wrong.
- Claude Haiku 5.5 (OpenRouter, paid, with a credit limit on the key): good on all three; on `hanoi` it
  gave the right idea (n-1 rings twice, plus one move) without code.

The default is Gemini's free tier; Haiku 5.5 is a setting away
(`HINT_PROVIDER=openrouter HINT_MODEL=anthropic/claude-haiku-5.5`).

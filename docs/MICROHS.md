# Design: running code in the browser with MicroHs

Status: proposal (2026-11-23), not built. The current pages and the
course server are unchanged by it.

[MicroHs](https://github.com/augustss/MicroHs) (Lennart Augustsson,
Apache-2.0) is a Haskell compiler that also builds to WebAssembly. With
it, a page can run code in the reader's browser, without Thunk. A trial
(tools/mhs-server.mjs, a stand-in for Thunk that runs mhs) passed 477 of
564 checks of the fp-notes test suite, and 105 of 112 solutions; the
differences are listed at the end. Speed with QuickCheck loaded, in
WebAssembly: about 2.7 s for the first Run on a page, then about 1 s
per Run (Thunk: about 0.35 s). Download: about 3 MB, once.

So MicroHs is a second engine, not a replacement: GHC on the server
stays the reference, and MicroHs serves pages that have no server, or
pages that must keep working when the server does not.

## 1. The program format as a contract

The format was defined only by server/patches/ghci-mode.patch (gawk)
and by notes.js. docs/PROTOCOL.md (done, 2026-11-23) writes it down as
the spec both engines implement:

- the program: definitions, then `>>>` inputs, `...` continuation lines,
  `<<<` stdin lines, `:{ ... :}` blocks;
- the answer: `{ec, ghcout, sout, serr, timesecs}` or `{err}`; `sout`
  has a `\x1e` line after each input's output; errors in the
  definitions go in `ghcout` with `ec` 1;
- new: `engine` in the answer (`"ghc-9.8.4"`, `"mhs-0.17.3"`), so that
  pages and tests know which engine answered.

## 2. One engine module

The logic of tools/mhs-server.mjs moves to widget/mhs-engine.js, used
both in the browser (a Web Worker) and in Node (the stand-in, for tests).
It papers over what is not a difference in Haskell:

- a module without a header gets `module Main where`, and error line
  numbers are moved back;
- the module's imports are repeated at the prompt;
- `:t e` prints `e :: type`, without `forall`;
- an error in an input says `no location: error:`; it becomes
  `<interactive>:1:1: error:`, which notes.js recognises;
- an `IO a` result that mhs will not show is run again as `e >>= print`;
- the timeout note.

It does not hide real differences: error wording, overloaded string
literals, missing `:info`.

## 3. Choosing the engine: a page setting

A new page setting, `hs-mhs`: where the MicroHs bundle is. With it,
`hs-engine` says how it is used:

- `only`: always MicroHs; no server. (A page without `hs-thunk` that
  has `hs-mhs` works this way by default.)
- `fallback`: Thunk first; MicroHs when Thunk cannot answer.
- `off` (the default when the page has `hs-thunk`): never MicroHs.

So there is no automatic switch unless the page asks for one. The
order: the recording (`hs-replay`), then the engine as above, then the
"needs a server" note.

**When `fallback` switches**: Thunk unreachable (network error, or no
answer within a short limit, 10 s instead of today's 60 s), or an
answer other than 200, or still busy (503/429) after the retries. Not
on a compile error or a timeout of the program itself: those are
answers. Once switched, the page stays on MicroHs for a few minutes
before trying Thunk again, so that every Run does not wait 10 s first.

**Loading**: with `only`, the bundle loads on the first Run. With
`fallback`, a setting `hs-mhs-preload` loads it when the page opens, so
that it is already there if the server goes down later (an exam: the
page opens while the network is fine).

**The reader sees which engine ran**: a small label under the output,
"Ran in your browser (MicroHs)", whenever it was not GHC. With
`fallback`, also a one-line note the first time: "The Haskell server is
not answering; your code now runs in your browser, where some messages
and results differ."

## 4. Exams (Inspera)

The use case for `fallback`: an exam page that keeps working when
thunk.cse is down or overloaded during the exam.

- With `only` (or `fallback` after the switch), the page talks to no
  Haskell server, only fetches static files. If the bundle is served
  from the same place as the page, an exam environment needs one origin
  allowed instead of two, and no server that accepts requests from it
  (today Thunk allows only `Origin: https://www.cse.chalmers.se`).
  Still to check: how Inspera embeds the page and what it lets a page
  fetch.
- Before an exam, run the exam pages' tests with both engines
  (section 6), so that every question is known to work under MicroHs,
  or known not to.
- Grading: Check's verdict should not depend on the engine; the tests
  must show that for each exam question.

## 5. In the browser

- A Web Worker runs mhs; its interface: `init()`, `run(code)` returning
  the answer of section 1.
- The whole input is known before a run, so stdin is a string: no
  xterm, no ASYNCIFY (the playground needs both; we do not).
- The time limit stops the run by terminating the worker; a new one is
  started for the next Run (about 2 s). The limit is 10 s (decided
  2026-11-23), a setting: MicroHs in WebAssembly is about 1.5 times
  slower than natively, where three fp-notes solutions already took more
  than 3.5 s; the reader's own computer pays for the wait.
- The worker stays warm between Runs: packages loaded once.

## 6. The bundle, the build and the tests

- `mhs/build.sh` pins the MicroHs commit, the emscripten version and the
  packages: base, QuickCheck, containers, random, splitmix, (mtl,
  transformers). Packages that cannot be built into the binary
  (ghc-compat) go into the in-memory file system, as the MicroHs
  playground does.
- The bundle (about 3 MB) is not committed: the Pages workflow builds it
  (the demo uses it), and releases carry it, so a page anywhere can load
  it from a CDN, or a site can serve its own copy.
- `widget/build.sh`: `THUNK_MHS=URL-or-dir` and `THUNK_ENGINE=only|fallback`,
  as `THUNK_REPLAY` today.
- tests/visual.mjs gets `--engine mhs` (the Node stand-in) and reports
  per page what passes; one headless-Chrome test checks the real worker
  and the fallback switch (a server that stops answering).
- MicroHs is Apache-2.0: add its NOTICE.

## 7. The demo page

The GitHub Pages demo can run live with `only`, instead of showing
recorded results; the recording stays as what it falls back to when
the bundle fails to load.

## 8. Known differences, and what to ask upstream

From the trial (fp-notes, 2026-11-22):

| Difference | Where it shows | Fix |
|---|---|---|
| `IO a` results (not `IO ()`) are not run at the prompt | 3A, 3B: `readFile`, `sample'`, `generate` | ours (section 2); upstream would be better |
| QuickCheck has no `Fn`, `Fn2` | 2B exercises | upstream, or `Fun _ f` |
| String literals are overloaded (`IsString a => a`) | 1A types | upstream: a switch to turn the extension off |
| `:t length` is `[a] -> Int`; other type variable names | types shown in lectures | none needed |
| no `:info` | 2B fixity | upstream |
| `maxBound :: Int` alone at the prompt is read as a declaration | 1A | upstream |
| derived `Show` puts no brackets around a record argument | data types | upstream (a bug against the Report) |
| error messages: other wording, first error only, no warnings | 1A, 1B | none; documented |
| speed and memory behaviour (stack overflow vs. timeout) | 4B laziness | none; such pages stay on GHC |

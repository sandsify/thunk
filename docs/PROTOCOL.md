# The engine protocol

What notes.js sends to an engine, and what it expects back. Two engines
implement it: GHC on a play-haskell server with the ghci mode
(server/patches/ghci-mode.patch), and MicroHs (docs/MICROHS.md; planned).
A recording (tools/record-replay.mjs) holds answers in the same form.

## Request

`POST /submit` with a JSON body:

    { "code": "...", "version": "9.8.4", "opt": "O0", "output": "ghci" }

`version` and `opt` choose GHC and its optimisation; MicroHs ignores
them. An engine in the browser is a function from `code` to the answer,
with no HTTP.

## The code

The code is a Haskell module mixed with REPL input. Each line is one of:

- **input**: starts with `>>>`. The rest of the line (after `>>>` and one
  optional space) is one REPL input.
- **continuation**: starts with `...`, right after an input or another
  continuation: it adds a line to that input.
- **block**: `>>> :{`, then `>>>` lines, then `>>> :}`: the lines in
  between are one input.
- **stdin**: starts with `<<<`, right after an input (not inside a block):
  a line the program reads (`getLine`) while it runs that input.
- **module**: any other line. A module line ends a run of continuation
  and stdin lines.

The module is the code with every input, continuation, block and stdin
line replaced by an empty line, so that line numbers stay the same.

Requirements on the module:

- It may have a `module` header or not, and need not define `main`, even
  with `module Main where`.
- notes.js builds it from several parts (setup code, earlier blocks, the
  reader's code): pragmas, the header and imports first, then each part
  after a `{-# LINE 1 "NAME" #-}` pragma, where NAME is `Main.hs`,
  `setup`, `block 2`, ... Positions in messages must follow these
  pragmas (GHC and MicroHs both do).

## What the engine does

1. **Compile check** of the module. Messages (errors and warnings) go to
   `ghcout`. If there is an error, `ec` is not 0 and nothing runs.
2. **Load** the module in the REPL. Output while loading is dropped
   (the warnings are already in `ghcout`).
3. **Run each input** in order: the input, then its stdin lines on the
   REPL's standard input, then a line containing only `\x1e` (record
   separator) is printed. The REPL's prompt prints nothing.
   The imports of the module are in scope at the prompt.
4. **Time limit** on steps 2 and 3 together: GHC on the server 3.5 s;
   MicroHs in the browser 10 s. When it is reached, the run stops, the
   output so far is kept, and
   `\n*** Stopped: took more than N seconds.\n` is added.

What the REPL prints for an input is GHCi's behaviour; engines should
match it where the difference is not one of Haskell itself:

- an expression of type `IO a`: run, and its result printed unless
  `a` is `()`; any other expression: printed with `show`;
- `:t e` prints `e :: type`;
- an error in an input starts with `<interactive>:LINE:COL: error`;
  an exception with `*** Exception`.

## Answer

    { "ec": 0, "ghcout": "...", "sout": "...", "serr": "", "timesecs": 0.4,
      "engine": "ghc-9.8.4" }

- `ec`: 0 if the module compiled.
- `ghcout`: the compile check's messages.
- `sout`: the REPL output from step 3: one part per input, each followed
  by `\x1e\n`. After a timeout, fewer parts than inputs, the last ending
  with the Stopped line.
- `serr`: unused (the REPL's errors are in `sout`).
- `timesecs`: the time the engine took.
- `engine` (new; optional for old recordings): which engine answered,
  `ghc-VERSION` or `mhs-VERSION`.

Or, when the engine could not run the code at all:

    { "err": "..." }

`"timeout"` means the server's own limit (5 s) stopped it before the
ghci mode's.

## How notes.js reads the answer

- **Compile error**: `ghcout` has a line matching
  `^\S.*?:\d+:\d+(-\d+)?: error`, or `ec` is not 0 and `ghcout` is not
  empty. It is shown between the panels; nothing runs.
- Otherwise `sout` is split at `\x1e\n`; part i is the output of input i,
  shown under it. A part is an error if it has a line starting with
  `<interactive>:N:N: error`, `*** Exception` or `*** Stopped`.
  Non-empty `ghcout` is shown as warnings.
- **Check** passes when every output of the `.check` block's inputs
  starts with `+++ OK` (QuickCheck's wording).
- Message positions name the parts by their LINE pragma names; notes.js
  replaces GHC's quoted source line with the right one (fixExcerpts).

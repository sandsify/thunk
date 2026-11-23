# Patches to play-haskell

Applied in the Dockerfile, in name order, to the pinned submodule.

- `ghci-mode.patch`: a fourth output mode, `"output": "ghci"`, next to
  `run`, `core` and `asm`. The code is a module plus lines starting with
  `>>>`; the module is loaded in GHCi (no `main` needed) and each `>>>`
  line is given to GHCi as input. Compile errors are in `ghcout`; the
  GHCi output (including errors for an input) is in `sout`, with a line
  containing only `\x1e` after each input.

- `sandbox-dev.patch`: the sandbox that runs the code gets a minimal
  `/dev` of its own (bwrap `--dev /dev`: null, zero, random, urandom,
  tty). Without it, bash cannot start the ghci mode's background timer
  ("cannot redirect standard input from /dev/null") on hosts where the
  container's `/dev` is not visible: so on the RHEL 9 server, though
  not under Docker Desktop on a Mac.

To change a patch: apply it in the submodule, edit, then
`git diff > ../patches/NAME.patch` and `git checkout .` in the submodule.

Details of the ghci mode (the protocol, for any engine: docs/PROTOCOL.md):

- Lines starting with `...` continue the `>>>` line before; `>>> :{` to
  `>>> :}` is one input as well.
- Lines starting with `<<<` after an input are written into GHCi's input
  right after that input, so that the program reads them (`getLine`).
- GHCi is killed after 3.5 s (the worker's own limit is 5 s), so the
  outputs of the inputs before a slow one are kept, followed by
  `*** Stopped: took more than 3.5 seconds.` GHCi runs in its own
  session and the whole process group is killed: Ubuntu 26.04's
  `timeout` (uutils) only kills its direct child, which is `sh`.
- `-main-is NoSuchModule` for both the compile check and GHCi, so that
  no `main` is needed, even with `module Main where`.
- GHCi loads the module with its own `:load` followed by a separator,
  and its output up to that separator is dropped: the warnings are
  already in `ghcout` from the compile check (`-w` does not help when
  the file has `{-# OPTIONS_GHC -Wall #-}`).

- `queue-size.patch`: the server queues up to 200 jobs instead of 10
  while all workers are busy (it answers 503 beyond that). With 10, a
  class clicking Run at the same moment gets "Service busy".

# Thunk

Thunk is the server that compiles and runs the readers' code. This
folder is a local [play-haskell](https://github.com/tomsmeding/play-haskell) for
development: the server and one worker in one Docker container.
play-haskell is a submodule pinned to a known commit; our changes to it
are patches in `patches/` (currently: a `ghci` output mode).

```bash
git submodule update --init --recursive
docker compose up --build
```

The first start builds the packages available to user code (see
`SANDBOX_PACKAGES` in the Dockerfile), which takes a few minutes; they
are kept in a Docker volume afterwards. Then:

- playground UI: http://localhost:8123
- API: `POST http://localhost:8123/submit` with
  `{"code": "...", "version": "9.8.4", "opt": "O0", "output": "run"}`

```bash
curl -s localhost:8123/submit -H 'Content-Type: application/json' \
  -d '{"code":"main = print (sum [1..10])","version":"9.8.4","opt":"O0","output":"run"}'
```

Checked: output, GHC errors, QuickCheck, the 5 s timeout
(`{"err":"timeout"}`), the 500 MB heap limit, and no access to the
container's files. The process limit (`pids.max`) is set but not tested.

Known issue: apart from the first job after a start, `serr` begins with
three `bash: warning: setlocale ... en_US.UTF-8` lines. The locale works
inside the sandbox and the results are not affected; cause not found yet.

## Differences from an upstream installation

- The sandbox root file system (`bwrap-files/ubuntu-base`) is built as a
  Docker build stage instead of with `make chroot`.
- Upstream limits each job with `systemd-run` (via setuid shims). There
  is no systemd in the container, so `docker/systemd-run-shim` and
  `docker/systemd-kill-shim` set the same limits with cgroup v2 directly.
  This is why the container runs with `privileged: true`.
- One GHC version, a short package list, and no LLVM.
- Ubuntu 26.04 instead of 24.04, because `stage-1.sh` uses `trap -P`
  (bash 5.3).
- Newer ghcup keeps the cabal binary outside `~/.ghcup/bin`, which the
  sandbox does not mount, so the image copies it into `bin/`.
- The whole thing runs as root inside the container. Fine on a laptop;
  for a real deployment use a Linux VM set up as upstream describes.

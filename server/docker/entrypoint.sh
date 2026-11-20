#!/bin/bash
# Starts a play-haskell worker and server in one container.
set -euo pipefail

W=/opt/play-haskell/play-haskell-worker
S=/opt/play-haskell/play-haskell-server
state=/var/lib/play-haskell
mkdir -p "$state"

# cgroup v2: move our processes out of the root so that the cpu, memory
# and pids controllers can be enabled for the per-job cgroups.
mkdir -p /sys/fs/cgroup/init
while read -r pid; do
  echo "$pid" >/sys/fs/cgroup/init/cgroup.procs 2>/dev/null || true
done </sys/fs/cgroup/cgroup.procs
echo "+cpu +memory +pids" >/sys/fs/cgroup/cgroup.subtree_control
mkdir -p /sys/fs/cgroup/sandbox
echo "+cpu +memory +pids" >/sys/fs/cgroup/sandbox/cgroup.subtree_control

# Build the packages available to user code (slow the first time; kept in
# a volume afterwards).
if [ ! -x "$W/bwrap-files/builders/build-$GHC.sh" ]; then
  echo "[entrypoint] Building sandbox packages for GHC $GHC: $SANDBOX_PACKAGES"
  "$W/bwrap-files/mkbuildscript.sh" "$GHC" "$SANDBOX_PACKAGES"
fi

# Keys: the worker only accepts jobs signed by the server.
[ -f "$state/server.key" ] || gen-secret-key "$state/server.key" 2>"$state/server.pub.txt"
[ -f "$state/worker.key" ] || gen-secret-key "$state/worker.key" 2>"$state/worker.pub.txt"
server_pub=$(sed 's/Public key: //' "$state/server.pub.txt")
worker_pub=$(sed 's/Public key: //' "$state/worker.pub.txt")
echo "$server_pub" >"$state/trusted-keys.txt"
echo "http://localhost:8124 $worker_pub" >"$state/preload-workers.txt"

cd "$W"
play-haskell-worker --secretkey "$state/worker.key" \
  --trustedkeys "$state/trusted-keys.txt" --port 8124 +RTS -N &

cd "$S"
exec play-haskell-server --secretkey "$state/server.key" \
  --preloadworkers "$state/preload-workers.txt" --dbdir "$state" --port 8123

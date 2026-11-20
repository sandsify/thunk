#!/bin/bash
# One-time setup of a fresh RHEL 9 VM for fp-notes (run as root, in the
# repo's deploy/ directory). Installs Docker CE, opens http and https,
# and starts Thunk, the hint service and Caddy.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "First: cp env.example .env, fill it in, chmod 600 .env"; exit 1; }

# Docker CE from Docker's repository (RHEL's own podman is not tested with
# Thunk's privileged sandbox).
if ! command -v docker >/dev/null; then
  dnf -y install dnf-plugins-core
  dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
  dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

# Thunk needs cgroup v2 (the RHEL 9 default).
[ "$(stat -fc %T /sys/fs/cgroup)" = cgroup2fs ] || { echo "cgroup v2 is needed"; exit 1; }

# http (for the certificate) and https.
if systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http --add-service=https
  firewall-cmd --reload
fi

# The first start builds the images and, inside Thunk, the Haskell packages
# for the sandbox: this takes a while (20-40 minutes).
docker compose up -d --build
docker compose ps
echo "Follow the first start with: docker compose logs -f thunk"

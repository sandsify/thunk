# Development image for play-haskell: the server and one worker in one
# container. Build and run with docker compose (see server/README.md).
#
# The worker must run with --privileged: it starts bubblewrap sandboxes
# and puts each job in its own cgroup.

# 26.04 for bash 5.3: the worker's stage-1.sh uses `trap -P`.
ARG UBUNTU=ubuntu:26.04

# The root file system that the sandboxed GHC runs in. Upstream builds
# this with `make chroot` (bubblewrap + apt); here it is a build stage.
FROM ${UBUNTU} AS sandbox-root
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      build-essential curl libffi-dev libffi8 libgmp-dev libgmp10 \
      libncurses-dev libtinfo6 locales zlib1g-dev gawk \
 && sed -i "s/^# *en_US.UTF-8/en_US.UTF-8/" /etc/locale.gen && locale-gen \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /usr/lib64 \
 && { [ -e /lib64 ] || ln -s usr/lib64 /lib64; }

FROM ${UBUNTU}
ARG GHC=9.8.4
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      bubblewrap build-essential ca-certificates curl git jq npm \
      libffi-dev libgmp-dev libncurses-dev zlib1g-dev pkg-config \
 && rm -rf /var/lib/apt/lists/*

# GHC and cabal via ghcup. The sandbox uses this same GHC installation.
ENV BOOTSTRAP_HASKELL_NONINTERACTIVE=1 \
    BOOTSTRAP_HASKELL_GHC_VERSION=${GHC} \
    BOOTSTRAP_HASKELL_CABAL_VERSION=recommended \
    BOOTSTRAP_HASKELL_INSTALL_NO_STACK=1 \
    PATH=/root/.ghcup/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://get-ghcup.haskell.org | sh \
 && mkdir -p /root/.ghcup/cache /root/.cabal/bin /root/.cabal/store /root/.cabal/packages \
 && cabal update

WORKDIR /opt/play-haskell
COPY play-haskell/ ./

# Haskell dependencies first, so that changing the sources does not
# rebuild them.
RUN cabal build --only-dependencies all

# Our changes to play-haskell (see patches/README.md).
COPY patches/ /tmp/patches/
RUN for p in /tmp/patches/*.patch; do patch -p1 <"$p"; done

RUN cabal build all \
 && for exe in play-haskell-server play-haskell-worker gen-secret-key; do \
      cp "$(cabal list-bin "$exe")" /usr/local/bin/; \
    done

RUN cd play-haskell-server/static && npm install && npx tsc --lib dom,es2015 play-index.ts

COPY --from=sandbox-root / play-haskell-worker/bwrap-files/ubuntu-base/

# Instead of the setuid systemd-run shims: cgroup v2 directly.
COPY docker/systemd-run-shim docker/systemd-kill-shim play-haskell-worker/bwrap-files/
COPY docker/entrypoint.sh /usr/local/bin/

# The sandbox only mounts ~/.ghcup/{bin,ghc,cache}, but newer ghcup puts
# the cabal binary in ~/.ghcup/cabal/, so copy it into bin/.
RUN cp --remove-destination "$(readlink -f /root/.ghcup/bin/cabal)" /root/.ghcup/bin/cabal

ENV GHC=${GHC} LANG=C.UTF-8 \
    SANDBOX_PACKAGES="base, array, containers, deepseq, mtl, QuickCheck, random, text, transformers"
EXPOSE 8123
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

#!/usr/bin/env bash
# Builds the optional preinstalled tools from sibling checkouts of the forks into tools/:
#   ../superfile → spf (both machines), ../opencode → opencode (Ubuntu), ../container → container (both).
# A missing checkout or toolchain is skipped, so TabShell still builds without them.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.bun/bin:$PATH"

case "$(uname -m)" in arm64 | aarch64) ARCH=arm64 ;; *) ARCH=amd64 ;; esac
OC_TARGET=opencode-linux-$([ "$ARCH" = arm64 ] && echo arm64 || echo x64)
mkdir -p tools/alpine tools/ubuntu
skip() { echo "build-tools: skipping $1"; }

if [ -f ../superfile/main.go ] && command -v go >/dev/null; then
  for t in alpine:386 ubuntu:$ARCH; do
    if (cd ../superfile && CGO_ENABLED=0 GOOS=linux GOARCH=${t#*:} go build -trimpath -ldflags "-s -w" -o "$OLDPWD/tools/${t%%:*}/spf" .); then
      echo "build-tools: spf for ${t%%:*}"
    else skip "spf for ${t%%:*} (build failed)"; fi
  done
else skip "spf (no ../superfile or go)"; fi

# The Ubuntu machine has the same CPU architecture as this computer (Docker Desktop and container both run native VMs).
if [ -f ../opencode/packages/cli/script/build.ts ] && command -v bun >/dev/null; then
  out=$(mktemp -d)  # build.ts deletes its --outdir first, so give it a fresh one
  pkg=../opencode/packages/cli/package.json
  cp "$pkg" "$out.pkg"  # build.ts runs bun install, which rewrites package.json; leave the fork untouched
  if (cd ../opencode/packages/cli && bun run script/build.ts --target="$OC_TARGET" --skip-web-ui --outdir="$out") >"$out.log" 2>&1 \
    && cp "$out/cli-linux-${OC_TARGET##*-}/bin/opencode" tools/ubuntu/opencode; then
    echo "build-tools: opencode for ubuntu"
  else skip "opencode (build failed, log in $out.log)"; fi
  cp "$out.pkg" "$pkg" && rm -rf "$out" "$out.pkg"
else skip "opencode (no ../opencode or bun)"; fi

if [ -f ../container/scripts/linux/container.sh ]; then
  install -m 755 ../container/scripts/linux/container.sh tools/alpine/container
  install -m 755 ../container/scripts/linux/container.sh tools/ubuntu/container
  echo "build-tools: container for both"
else skip "container (no ../container)"; fi
exit 0

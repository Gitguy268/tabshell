#!/bin/bash
# Double-click to run TabShell. It builds what's missing, starts the local server and opens your browser.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH:$PWD/../container/bin"  # last: a built ../container fork, if not installed
PORT=8686

command -v node >/dev/null || { echo "TabShell needs Node.js 20 or newer: https://nodejs.org"; read -rp "Press Enter to close."; exit 1; }

docker_up() { docker info >/dev/null 2>&1; }
if command -v docker >/dev/null; then
  if ! docker_up; then
    echo "Starting Docker Desktop..."
    open -a Docker 2>/dev/null
    for _ in $(seq 1 60); do docker_up && break; sleep 2; done
  fi
fi

[ -d node_modules ] || npm ci || exit 1
# spf, opencode and container from sibling checkouts of the forks; skipped when they aren't there.
[ -e tools/ubuntu/container ] || ./scripts/build-tools.sh

# Each image remembers a hash of the files it was built from, so an update that changes them
# rebuilds it. A rebuilt Browser VM image starts fresh VMs, as on the hosted page.
src_hash() { find "$@" -type f ! -name '._*' 2>/dev/null | LC_ALL=C sort | xargs cat | shasum | cut -c1-16; }
VM_SRC=$(src_hash image scripts/build-image.sh scripts/fs2json.py scripts/copy-to-sha256.py)
UBUNTU_SRC=$(src_hash docker image/shell)
if [ ! -f public/alpine/fs.json ] || [ "$(cat public/alpine/.source 2>/dev/null)" != "$VM_SRC" ]; then
  if docker_up; then
    [ -f public/alpine/fs.json ] && echo "TabShell's Linux image changed; rebuilding it (a few minutes)..."
    ./scripts/build-image.sh && echo "$VM_SRC" > public/alpine/.source || exit 1
  elif [ ! -f public/alpine/fs.json ]; then
    echo "Building the Browser VM image needs Docker the first time. Install Docker Desktop and run this again."; read -rp "Press Enter to close."; exit 1
  fi
fi
if docker_up && [ "$(docker image inspect -f '{{index .Config.Labels "tabshell.source"}}' tabshell-ubuntu 2>/dev/null)" != "$UBUNTU_SRC" ]; then
  echo "Building the Ubuntu image for Docker mode (a few minutes)..."
  docker build --label "tabshell.source=$UBUNTU_SRC" -t tabshell-ubuntu -f docker/Dockerfile . || exit 1
fi
# Without Docker, Docker mode runs on apple/container when its services are started.
container_up() { command -v container >/dev/null && container system status >/dev/null 2>&1; }
if ! docker_up && container_up && ! container image inspect tabshell-ubuntu >/dev/null 2>&1; then
  echo "Building the Ubuntu image with container (one time, a few minutes)..."
  container build -t tabshell-ubuntu -f docker/Dockerfile . || exit 1
fi
docker_up || container_up || echo "Neither Docker nor container is running, so only Browser VM mode will work."

# Rebuild when any source is newer than the last build.
if [ ! -f dist/index.html ] || [ -n "$(find index.html src public vite.config.js package.json -newer dist/index.html 2>/dev/null | head -1)" ]; then
  npm run build || exit 1
fi

if curl -s -o /dev/null "http://localhost:$PORT/api/status"; then
  echo "TabShell is already running."
else
  node server.mjs &
  trap 'kill $! 2>/dev/null' EXIT
  for _ in $(seq 1 25); do curl -s -o /dev/null "http://localhost:$PORT/api/status" && break; sleep 0.2; done
fi
open "http://localhost:$PORT"
echo "Close this window to stop TabShell. Your Docker container keeps its files until you press Reset."
wait

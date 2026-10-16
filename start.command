#!/bin/bash
# Double-click to run TabShell. It builds what's missing, starts the local server and opens your browser.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
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

if [ ! -f public/alpine/fs.json ]; then
  if docker_up; then ./scripts/build-image.sh || exit 1
  else echo "Building the Browser VM image needs Docker the first time. Install Docker Desktop and run this again."; read -rp "Press Enter to close."; exit 1; fi
fi
if docker_up && ! docker image inspect tabshell-ubuntu >/dev/null 2>&1; then
  echo "Building the Ubuntu image for Docker mode (one time, a few minutes)..."
  docker build -t tabshell-ubuntu docker || exit 1
fi
docker_up || echo "Docker isn't running, so only Browser VM mode will work."

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

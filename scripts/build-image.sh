#!/usr/bin/env bash
# Builds the Alpine 9p image for v86 into public/alpine/. Needs only Docker.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=public/alpine
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"; docker rm -f tabshell-alpine-export >/dev/null 2>&1 || true' EXIT

docker build image --platform linux/386 --tag tabshell-alpine
docker rm -f tabshell-alpine-export >/dev/null 2>&1 || true
docker create --platform linux/386 --name tabshell-alpine-export tabshell-alpine >/dev/null
docker export tabshell-alpine-export -o "$TMP/rootfs.tar"

rm -rf "$OUT" && mkdir -p "$OUT/flat"
# Python 3.14 has zstd built in, so the conversion runs in a container instead of needing pip packages.
docker run --rm -v "$PWD/scripts:/scripts:ro" -v "$TMP:/in" -v "$PWD/$OUT:/out" python:3.14-slim sh -c '
  (tar -f /in/rootfs.tar --delete .dockerenv || true) &&
  python3 -I /scripts/fs2json.py --zstd --out /out/fs.json /in/rootfs.tar &&
  python3 -I /scripts/copy-to-sha256.py --zstd /in/rootfs.tar /out/flat'
echo "Built $OUT ($(du -sh "$OUT" | cut -f1))"

#!/usr/bin/env bash
# Start the backend (uvicorn), frontend (vite) and Nostr relay (docker compose)
# together. Ctrl-C stops them all.
#   --lan       serve the frontend over HTTPS on the network (phone testing)
#   --no-relay  skip the relay (no Docker needed)
# BACKEND_PORT=8001 ./dev.sh runs the backend on another port (default 8000).
set -euo pipefail
set -m  # job control: each server gets its own process group, so we can kill the whole tree

cd "$(dirname "$0")"

front_script=dev
with_relay=true
for arg in "$@"; do
  case "$arg" in
    --lan) front_script=dev:lan ;;
    --no-relay) with_relay=false ;;
    *) echo "usage: $0 [--lan] [--no-relay]" >&2; exit 2 ;;
  esac
done

backend_port=${BACKEND_PORT:-8000}
ports=("$backend_port" 5173)
if $with_relay; then ports+=(7777); fi
for port in "${ports[@]}"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "dev.sh: port $port is already in use by:" >&2
    lsof -nP -iTCP:"$port" -sTCP:LISTEN -Fc 2>/dev/null | sed -n 's/^c/  /p' | sort -u >&2
    exit 1
  fi
done

if $with_relay && ! docker info >/dev/null 2>&1; then
  echo "dev.sh: Docker is not running; start it, or pass --no-relay" >&2
  exit 1
fi

pids=()
cleanup() {
  trap - INT TERM EXIT
  for pid in "${pids[@]}"; do
    kill -- -"$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  if $with_relay; then docker compose stop relay >/dev/null 2>&1 || true; fi
}
trap cleanup INT TERM EXIT

(cd backend && exec uv run uvicorn stede.main:app --reload --port "$backend_port") &
pids+=($!)

(cd frontend && API_URL="http://localhost:$backend_port" exec npm run "$front_script") &
pids+=($!)

if $with_relay; then
  # Development relay: accepts writes from any pubkey (ws://localhost:7777).
  # --menu=false: compose's interactive menu puts the terminal in raw mode, which
  # stops a background job (SIGTTOU) and the relay never starts.
  (exec env STEDE_RELAY_OPEN_WRITES=1 docker compose up --build --menu=false relay) &
  pids+=($!)
fi

# Exit as soon as any server dies, so a crash isn't hidden.
# (macOS bash 3.2 has no `wait -n`, so poll the running jobs.)
while [[ "$(jobs -rp | wc -l)" -eq "${#pids[@]}" ]]; do sleep 1; done

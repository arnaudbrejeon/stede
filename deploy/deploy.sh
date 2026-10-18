#!/usr/bin/env bash
# Deploy stede to Google Cloud and Cloudflare (see docs/deploy.md).
#
#   deploy/deploy.sh create    # once: the VM
#   deploy/deploy.sh setup     # once: Docker and swap on the VM
#   deploy/deploy.sh relay     # the relay: copy HEAD to the VM, rebuild, restart
#   deploy/deploy.sh app       # the app and its API: build and upload to Cloudflare
#
# gcloud runs with its own configuration ("stede" unless STEDE_GCLOUD_CONFIG
# says otherwise), so the account and project active in your shell are never used.
set -euo pipefail

export CLOUDSDK_ACTIVE_CONFIG_NAME="${STEDE_GCLOUD_CONFIG:-stede}"
VM="${STEDE_VM:-stede}"
# e2-micro VMs are in Google Cloud's free tier in us-west1, us-central1 and us-east1.
ZONE="${STEDE_ZONE:-us-central1-a}"
REGION="${ZONE%-*}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

on_vm() { gcloud compute ssh "$VM" --zone "$ZONE" --quiet --command "$1"; }

create() {
  gcloud compute instances create "$VM" --zone "$ZONE" \
    --machine-type e2-micro \
    --image-family debian-12 --image-project debian-cloud \
    --boot-disk-size 30GB --boot-disk-type pd-standard
}

setup() {
  on_vm 'set -e
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "$USER"
    # 1 GB of memory is little: swap, in case.
    if [ ! -f /swapfile ]; then
      sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
      sudo mkswap /swapfile && sudo swapon /swapfile
      echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab
    fi'
}

relay() {
  for f in deploy/.env deploy/tunnel.json; do
    [ -f "$ROOT/$f" ] || { echo "Missing $f (see docs/deploy.md)" >&2; exit 1; }
  done
  if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
    echo "Note: uncommitted changes are not deployed, only HEAD."
  fi
  git -C "$ROOT" archive HEAD | on_vm 'mkdir -p stede && tar -x -C stede'
  gcloud compute scp --zone "$ZONE" --quiet "$ROOT/deploy/.env" "$ROOT/deploy/tunnel.json" "$VM:stede/deploy/"
  # cloudflared runs as an unprivileged user and must read its credentials.
  # strfry reads relay/authors.txt when it starts: restart it when the file changed.
  on_vm 'set -e; cd stede && chmod 644 deploy/tunnel.json
    docker compose -f deploy/compose.yml up -d --build --remove-orphans
    authors=$(sha256sum relay/authors.txt)
    if [ "$authors" != "$(cat .authors.sha256 2>/dev/null)" ]; then
      docker compose -f deploy/compose.yml restart relay
      echo "$authors" > .authors.sha256
    fi'
}

app() {
  (cd "$ROOT/frontend" && npm run deploy)
}

case "${1:-}" in
  create | setup | relay | app) "$1" ;;
  *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac

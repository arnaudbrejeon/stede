#!/usr/bin/env bash
# Deploy stede to Google Cloud and Cloudflare (see docs/deploy.md).
#
#   deploy/deploy.sh create    # once: the VM
#   deploy/deploy.sh setup     # once: Docker and swap on the VM
#   deploy/deploy.sh relay     # the relay: copy HEAD to the VM, rebuild, restart
#   deploy/deploy.sh app       # the app and its API: build and upload to Cloudflare
#   deploy/deploy.sh backup-setup   # once: the backup bucket, and the nightly backup on the VM
#   deploy/deploy.sh backup    # back the relay up now, and list the latest backups
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
# The relay's backups (deploy/backup.sh): the bucket, and how long it keeps them.
BACKUP_DAYS=30
backup_bucket() { echo "${STEDE_BACKUP_BUCKET:-$(gcloud config get-value project 2>/dev/null)-relay-backups}"; }

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

# The bucket, an account for the VM that may only add files to it, and the
# timer that runs deploy/backup.sh each night. Safe to run again.
backup_setup() {
  local project bucket account lifecycle
  project="$(gcloud config get-value project 2>/dev/null)"
  bucket="$(backup_bucket)"
  account="stede-relay@$project.iam.gserviceaccount.com"

  # gsutil rather than `gcloud storage`, which doesn't start on every Python.
  gsutil ls -b "gs://$bucket" >/dev/null 2>&1 ||
    gsutil mb -l "$REGION" -b on --pap enforced "gs://$bucket"
  lifecycle="$(mktemp)"
  echo "{\"rule\": [{\"action\": {\"type\": \"Delete\"}, \"condition\": {\"age\": $BACKUP_DAYS}}]}" > "$lifecycle"
  gsutil lifecycle set "$lifecycle" "gs://$bucket"
  rm -f "$lifecycle"

  gcloud iam service-accounts describe "$account" >/dev/null 2>&1 ||
    gcloud iam service-accounts create stede-relay --display-name "The stede relay's VM"
  gsutil iam ch "serviceAccount:$account:objectCreator" "gs://$bucket"

  # A VM's account only changes while it is stopped: the relay is away a minute or two.
  if [ "$(gcloud compute instances describe "$VM" --zone "$ZONE" --format 'value(serviceAccounts[0].email)')" != "$account" ]; then
    gcloud compute instances stop "$VM" --zone "$ZONE"
    gcloud compute instances set-service-account "$VM" --zone "$ZONE" \
      --service-account "$account" --scopes cloud-platform
    gcloud compute instances start "$VM" --zone "$ZONE"
    until on_vm true 2>/dev/null; do sleep 5; done
  fi

  # As root, which may use Docker; deploy/.env may hold STEDE_BACKUP_PING.
  on_vm "set -e
    sudo tee /etc/systemd/system/stede-backup.service >/dev/null <<UNIT
[Unit]
Description=Back up the stede relay to gs://$bucket
[Service]
Type=oneshot
Environment=HOME=/root STEDE_BACKUP_BUCKET=$bucket
EnvironmentFile=-\$HOME/stede/deploy/.env
ExecStart=\$HOME/stede/deploy/backup.sh
UNIT
    sudo tee /etc/systemd/system/stede-backup.timer >/dev/null <<UNIT
[Unit]
Description=Back up the stede relay each night
[Timer]
OnCalendar=*-*-* 09:00:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT
    sudo systemctl daemon-reload
    sudo systemctl enable --now stede-backup.timer"
}

backup() {
  on_vm 'sudo systemctl start stede-backup.service; sudo journalctl -u stede-backup.service -n 3 --no-pager -o cat'
  gsutil ls -l "gs://$(backup_bucket)" | tail -4
}

case "${1:-}" in
  create | setup | relay | app | backup) "$1" ;;
  backup-setup) backup_setup ;;
  *) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac

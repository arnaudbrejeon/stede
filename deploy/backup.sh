#!/usr/bin/env bash
# Back up the relay: every event it holds, exported by strfry as JSON lines,
# gzipped, to the Cloud Storage bucket named by STEDE_BACKUP_BUCKET. Runs on the
# VM each night, from a systemd timer (`deploy/deploy.sh backup-setup`; see
# docs/deploy.md, which also says how to restore).
#
# The VM may only add files to the bucket: it can't read, replace or delete
# them. The bucket itself deletes them after 30 days.
set -euo pipefail

BUCKET="${STEDE_BACKUP_BUCKET:?set STEDE_BACKUP_BUCKET}"
cd "$(dirname "$0")/.."

# To a file first, so an export that fails halfway is never uploaded.
export_file="$(mktemp)"
trap 'rm -f "$export_file"' EXIT
docker compose -f deploy/compose.yml exec -T relay /app/strfry export | gzip > "$export_file"

events="$(gzip -dc "$export_file" | wc -l)"
if [ "$events" -eq 0 ]; then
  echo "The export is empty: not uploaded." >&2
  exit 1
fi

name="strfry-$(date -u +%Y-%m-%dT%H%M%SZ).jsonl.gz"
# Straight to the storage API as the VM's account: gsutil and gcloud first look
# at what the bucket holds, which this account may not do.
token="$(curl -fsS -m 10 -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token |
  sed -E 's/.*"access_token" *: *"([^"]+)".*/\1/')"
curl -fsS -m 600 -o /dev/null -X POST \
  -H "Authorization: Bearer $token" -H 'Content-Type: application/gzip' \
  --data-binary "@$export_file" \
  "https://storage.googleapis.com/upload/storage/v1/b/$BUCKET/o?uploadType=media&name=$name"
echo "Backed up $events events to gs://$BUCKET/$name"

# Optional (deploy/.env): an address to call after each backup, of a service
# that sends an email when the calls stop.
if [ -n "${STEDE_BACKUP_PING:-}" ]; then
  curl -fsS -m 10 -o /dev/null "$STEDE_BACKUP_PING" || echo "The ping failed." >&2
fi

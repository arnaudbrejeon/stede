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
gsutil -q cp "$export_file" "gs://$BUCKET/$name"
echo "Backed up $events events to gs://$BUCKET/$name"

# Optional (deploy/.env): an address to call after each backup, of a service
# that sends an email when the calls stop.
if [ -n "${STEDE_BACKUP_PING:-}" ]; then
  curl -fsS -m 10 -o /dev/null "$STEDE_BACKUP_PING" || echo "The ping failed." >&2
fi

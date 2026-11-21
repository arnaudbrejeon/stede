# Deploying stede

| Address | What | Where |
|---|---|---|
| `https://stede.cc` | the app | Cloudflare Workers static assets (`frontend/wrangler.jsonc`) |
| `https://stede.cc/api/*` | the API: place search, addresses, photos | the same Cloudflare Worker (`frontend/worker/`) |
| `https://stede.cc/stats` | the relay's figures, counted by the relay (NIP-45) | the same static assets (`frontend/stats.html`) |
| `wss://relay.stede.cc` | the Nostr relay (strfry) | Google Cloud VM, through a Cloudflare Tunnel |

The relay is an ordinary public relay: any Nostr app can read from it, and any
app can write to it, with any key (only place events, see `relay/policy.py`).

The VM runs `deploy/compose.yml`: the relay and `cloudflared`, which connects
out to Cloudflare. Nothing listens on the VM's public address except
SSH; Cloudflare provides HTTPS and `wss://`.

Everything goes through `deploy/deploy.sh`. Its gcloud commands use a gcloud
configuration of their own, `stede`, never the one active in your shell.

## Once

### Google Cloud

Create the `stede` configuration, on your account and the project to use:

```sh
gcloud config configurations create stede --no-activate
CLOUDSDK_ACTIVE_CONFIG_NAME=stede gcloud auth login
CLOUDSDK_ACTIVE_CONFIG_NAME=stede gcloud config set project YOUR_PROJECT
CLOUDSDK_ACTIVE_CONFIG_NAME=stede gcloud services enable compute.googleapis.com
```

Then the VM (an e2-micro in `us-central1-a`, with a 30 GB standard disk), and
Docker on it:

```sh
deploy/deploy.sh create
deploy/deploy.sh setup
```

An e2-micro and 30 GB of standard disk in us-west1, us-central1 or us-east1
are in Google Cloud's free tier, and so is one VM's external IPv4 address.
What may be billed: traffic past the free 1 GB a month (loading 10,000 places
is about 15 MB, about $0.002 each beyond it).

### Cloudflare Tunnel

On your machine, with `cloudflared` (`brew install cloudflared`):

```sh
cloudflared tunnel login                 # pick stede.cc
cloudflared tunnel create stede          # writes ~/.cloudflared/<TUNNEL_ID>.json
cloudflared tunnel route dns stede relay.stede.cc
cp ~/.cloudflared/<TUNNEL_ID>.json deploy/tunnel.json
echo STEDE_TUNNEL_ID=<TUNNEL_ID> > deploy/.env
```

`deploy/tunnel.json` and `deploy/.env` are secrets: both are gitignored, and
`deploy.sh relay` copies them to the VM.

### Cloudflare Workers

`npx wrangler@4 login`. The first `deploy.sh app` attaches `stede.cc` to
the worker (`routes` in `frontend/wrangler.jsonc`); remove any DNS record for
`stede.cc` itself first if Cloudflare refuses.

The API runs on Cloudflare's free Workers plan: 100,000 requests a day and
10 ms of CPU per request (time spent waiting on Photon, OpenStreetMap or
Wikidata doesn't count). The dashboard shows each request's CPU time; the $5 a
month plan lifts the limit to 30 s if place photos ever need more.

## Each release

```sh
deploy/deploy.sh relay   # relay: HEAD copied to the VM, rebuilt, restarted
deploy/deploy.sh app     # app and API: built with VITE_RELAY_URL=wss://relay.stede.cc, uploaded
```

`relay` deploys the last commit, not uncommitted changes.

## Who may write to the relay

Anyone: `STEDE_RELAY_OPEN_WRITES` is `"1"` in `deploy/compose.yml`, so the
policy takes place events from any key.

To close the relay to chosen keys again, set it to `"0"` and add each pubkey
(64-character hex, `nak decode npub1…` gives it) to `relay/authors.txt`,
commit, and `deploy/deploy.sh relay`. strfry reads the file when it starts,
and the deploy restarts it when the file changed. With an empty or missing
file, nobody can write.

## Checking

```sh
curl -H 'Accept: application/nostr+json' https://relay.stede.cc   # the relay's NIP-11 description
curl https://stede.cc/api/health
open https://stede.cc/stats                                        # how many places the relay holds
gcloud compute ssh stede --zone us-central1-a --command 'cd stede && docker compose -f deploy/compose.yml logs --tail 50'
```

(Prefix the gcloud command with `CLOUDSDK_ACTIVE_CONFIG_NAME=stede`.)

## Backups

The relay's data lives in the `stede_relay-db` Docker volume on the VM's disk.
It survives restarts of the relay and of the VM; the backups are for when the
disk or the VM is lost, or the data is damaged (a flood of junk, a bad
deletion).

Each night (09:00 UTC) a timer on the VM runs `deploy/backup.sh`: every event,
exported by strfry as JSON lines, gzipped, into the bucket
`gs://<project>-relay-backups`, which deletes each file after 30 days. The VM
runs as an account of its own (`stede-relay`) that may only add files to the
bucket, not read, replace or delete them.

Once, to make the bucket, the account and the timer (it stops the VM for a
minute or two to change its account):

```sh
deploy/deploy.sh backup-setup
deploy/deploy.sh backup        # a first backup now, and the latest ones listed
```

To hear when backups stop, put `STEDE_BACKUP_PING=<address>` in `deploy/.env`:
the address a service such as healthchecks.io gives, called after each backup,
which emails when a day goes by without a call. Then `deploy/deploy.sh relay`
(it copies the file).

`https://stede.cc/stats` shows the latest backup and when the next is due. The
worker reads the bucket as an account that may only read it, whose key is the
worker's secret `BACKUP_READER_KEY`. Once, after `backup-setup`:

```sh
deploy/deploy.sh backup-status-setup   # again later to replace the key
```

### Restoring

Into the relay as it is (events it already has are skipped), or into a new VM
after `create`, `setup` and `relay`:

```sh
gsutil ls gs://stede-cc-relay-backups | tail -3        # pick one
gsutil cat gs://stede-cc-relay-backups/strfry-<date>.jsonl.gz | gunzip |
  gcloud compute ssh stede --zone us-central1-a --command \
    'cd stede && docker compose -f deploy/compose.yml exec -T relay /app/strfry import'
```

To go back to an earlier state rather than add to the present one, empty the
relay first: `docker compose -f deploy/compose.yml down`, `docker volume rm
stede_relay-db`, `up -d`, then the import. What was written after the backup
is lost: with the stede relay alone, the app drops the places the relay no
longer has.

The file is strfry's export, one signed event a line: `strfry import` takes it
on any strfry, and other relays can be sent its events.

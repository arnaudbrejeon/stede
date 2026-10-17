# Deploying stede

| Address | What | Where |
|---|---|---|
| `https://stede.cc` | the app | Cloudflare Workers static assets (`frontend/wrangler.jsonc`) |
| `https://stede.cc/api/*` | the API, as the app calls it | passed by the worker (`frontend/worker/index.ts`) to `api.stede.cc` |
| `https://api.stede.cc` | the API (FastAPI) | Google Cloud VM, through a Cloudflare Tunnel |
| `wss://relay.stede.cc` | the Nostr relay (strfry) | Google Cloud VM, through a Cloudflare Tunnel |

The relay is an ordinary public relay: any Nostr app can read from it, and any
app can write to it for the pubkeys in `relay/authors.txt` (only place events,
see `relay/policy.py`).

The VM runs `deploy/compose.yml`: the relay, the API and `cloudflared`, which
connects out to Cloudflare. Nothing listens on the VM's public address except
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

Then the VM (an e2-micro in `us-central1-a`, with a 30 GB standard disk and
daily snapshots kept two weeks), and Docker on it:

```sh
deploy/deploy.sh create
deploy/deploy.sh setup
```

An e2-micro and 30 GB of standard disk in us-west1, us-central1 or us-east1
are in Google Cloud's free tier. What may be billed: the VM's external IPv4
address, traffic past the free 1 GB a month (loading 10,000 places is about
10 MB), and snapshot storage (a few cents).

### Cloudflare Tunnel

On your machine, with `cloudflared` (`brew install cloudflared`):

```sh
cloudflared tunnel login                 # pick stede.cc
cloudflared tunnel create stede          # writes ~/.cloudflared/<TUNNEL_ID>.json
cloudflared tunnel route dns stede relay.stede.cc
cloudflared tunnel route dns stede api.stede.cc
cp ~/.cloudflared/<TUNNEL_ID>.json deploy/tunnel.json
echo STEDE_TUNNEL_ID=<TUNNEL_ID> > deploy/.env
```

`deploy/tunnel.json` and `deploy/.env` are secrets: both are gitignored, and
`deploy.sh backend` copies them to the VM.

### Cloudflare Workers

`npx wrangler@4 login`. The first `deploy.sh frontend` attaches `stede.cc` to
the worker (`routes` in `frontend/wrangler.jsonc`); remove any DNS record for
`stede.cc` itself first if Cloudflare refuses.

## Each release

```sh
deploy/deploy.sh backend    # relay and API: HEAD copied to the VM, rebuilt, restarted
deploy/deploy.sh frontend   # app: built with VITE_RELAY_URL=wss://relay.stede.cc, uploaded
```

`backend` deploys the last commit, not uncommitted changes. The first build on
the VM compiles strfry and takes a while; later ones reuse Docker's cache.

## Who may write to the relay

Add the pubkey (64-character hex, `nak decode npub1…` gives it) to
`relay/authors.txt`, commit, and `deploy/deploy.sh backend`. strfry reads the
file when it starts, and the deploy restarts it when the file changed. With an
empty or missing file, nobody can write.

## Checking

```sh
curl -H 'Accept: application/nostr+json' https://relay.stede.cc   # the relay's NIP-11 description
curl https://stede.cc/api/health
gcloud compute ssh stede --zone us-central1-a --command 'cd stede && docker compose -f deploy/compose.yml logs --tail 50'
```

(Prefix the gcloud command with `CLOUDSDK_ACTIVE_CONFIG_NAME=stede`.)

## Backups

The relay's data lives in the `stede_relay-db` Docker volume on the VM's boot
disk, which is snapshotted daily (`stede-daily`, kept 14 days). To restore,
create a disk from a snapshot in the Cloud console and start a VM from it.
Your places are also in any export you made from the app.

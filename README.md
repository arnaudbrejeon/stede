# stede

*Stede* — the old word for a location or place.

## Layout

- `backend/` — Python API (FastAPI, managed with [uv](https://docs.astral.sh/uv/))
- `frontend/` — TypeScript web app (React + Vite)
- `relay/` — Nostr relay ([strfry](https://github.com/hoytech/strfry)) that only stores place events

## Development

Start the backend, frontend and relay at once with `./dev.sh` (add `--lan` for
the phone setup below, or `--no-relay` to skip the relay and Docker), or
separately:

Backend (http://localhost:8000):

```sh
cd backend
uv sync
uv run uvicorn stede.main:app --reload
uv run pytest
```

Frontend (http://localhost:5173, proxies `/api` to the backend):

```sh
cd frontend
npm install
npm run dev
```

To try it on a phone on the same network, run `npm run dev:lan` instead and open
https://<your-mac>.local:5173 (or the "Network" address it prints). It serves
over HTTPS, which browsers require before sharing your location.

Safari only shares your location with a certificate it trusts. With
[mkcert](https://github.com/FiloSottile/mkcert), once:

```sh
cd frontend
mkdir -p .cert
mkcert -key-file .cert/key.pem -cert-file .cert/cert.pem \
  localhost 127.0.0.1 "$(ipconfig getifaddr en0)" "$(scutil --get LocalHostName).local"
```

then send `rootCA.pem` from `mkcert -CAROOT` to the phone (never the key), install
the profile, and turn on full trust in Settings → General → About → Certificate
Trust Settings. Without `.cert/`, `dev:lan` falls back to a self-signed
certificate (fine for everything but location).

## Relay

Places are Nostr events (kind 31300, see the
[NIP-XX Places proposal](https://github.com/nostr-protocol/nips/issues/2492)).
`relay/` holds a [strfry](https://github.com/hoytech/strfry) relay whose write
policy (`relay/policy.py`) accepts only place events, private places (kind
31301), bookmark sets of places (NIP-51, kind 30003) and deletions (NIP-09), and
only from pubkeys listed in `relay/authors.txt`. Reads are open. The policy also
checks that a place has a `d`, a `name` and a well-formed `geo` tag, and that
its `g` geohashes match the coordinates. A private place is a place NIP-44
encrypted to its author: it must show only its `d` tag, with everything else in
its encrypted content.

```sh
docker compose up --build relay          # ws://localhost:7777, writes from relay/authors.txt
STEDE_RELAY_OPEN_WRITES=1 docker compose up relay   # development: writes from anyone
cd backend && uv run pytest ../relay/tests          # policy tests
```

The app reaches the relay through the dev server at `/relay` (proxied to
`ws://localhost:7777`, or `RELAY_URL`), so it also works over HTTPS on a phone.
Your places are private place events (kind 31301), encrypted to your key; see
`frontend/src/placeEvents.ts`. With `./dev.sh` running,
`VITE_RELAY_TEST_HOST=localhost:5173 npm test` in `frontend/` also runs a test
that saves, edits and deletes places on the relay.

The first build compiles strfry from source (a few minutes). Events live in the
`relay-db` Docker volume. The policy is read by strfry at startup, so restart
the relay after editing `relay/authors.txt`.

## Deploying

The app is served by Cloudflare at `https://stede.cc`; the relay
(`wss://relay.stede.cc`) and the API run on a Google Cloud VM behind a
Cloudflare Tunnel. Setup and releases: [docs/deploy.md](docs/deploy.md).

## Importing your Mapstr places

Your key drawer (the padlock) has Export, Import and Delete all. The file they
use holds each place as its NIP-XX Places event, unencrypted (see
`frontend/src/placesFile.ts`). To bring in a Mapstr export enriched by the
scripts in `backend/scripts/`:

```sh
cd backend && uv run python scripts/mapstr_to_stede.py   # data/mapstr.json -> data/stede-places.json
```

then import `data/stede-places.json` in the app. Importing merges duplicates
(same name, and the same OpenStreetMap object or within 100 m) and updates
places you already have instead of copying them.

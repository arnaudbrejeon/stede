# stede

*Stede* — the old word for a location or place.

## Layout

- `frontend/` — TypeScript web app (React + Vite), and its API in
  `frontend/worker/` (a Cloudflare Worker: place search, addresses and photos)
- `backend/` — Python import tools for Mapstr and Pindrop exports (managed with
  [uv](https://docs.astral.sh/uv/))
- `relay/` — Nostr relay ([strfry](https://github.com/hoytech/strfry)) that only stores place events

## Development

Start the app and relay at once with `./dev.sh` (add `--lan` for the phone
setup below, or `--no-relay` to skip the relay and Docker), or the app alone
(http://localhost:5173):

```sh
cd frontend
npm install
npm run dev     # the dev server also answers /api with frontend/worker/
npm test
```

The import tools (see "Importing your Mapstr places"):

```sh
cd backend
uv sync
uv run pytest
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

### Trying a remote signer

To try a remote signer (NIP-46) without a phone, run a relay and a bunker with
[nak](https://github.com/fiatjaf/nak), each in its own terminal:

```sh
nak serve    # a relay in memory, at ws://localhost:10547
```

```sh
# a throwaway test key: never use it for anything real
nak bunker --sec 674887bedf6a4b5238bfd181d1d0f1b70b7d5bc9818e85ea1329990483ee5555 ws://localhost:10547
```

The bunker prints a `bunker://` link and every request it gets. Paste the
link under "Use a remote signer" in the key panel.

## Relay

Places are Nostr events (kind 31300, see the
[NIP-XX Places proposal](https://github.com/nostr-protocol/nips/issues/2492)).
`relay/` holds a [strfry](https://github.com/hoytech/strfry) relay whose write
policy (`relay/policy.py`) accepts only place events, private places (kind
31301), bookmark sets of places (NIP-51, kind 30003), relay sets (NIP-51, kind
30002) and deletions (NIP-09). In production any key may write; without
`STEDE_RELAY_OPEN_WRITES=1`, only the pubkeys listed in `relay/authors.txt`.
Reads are open. The policy also
checks that a place has a `d`, a `name` and a well-formed `geo` tag, and that
its `g` geohashes match the coordinates. A private place is a place NIP-44
encrypted to its author: it must show only its `d` tag, with everything else in
its encrypted content.

```sh
docker compose up --build relay          # ws://localhost:7777, writes from relay/authors.txt
STEDE_RELAY_OPEN_WRITES=1 docker compose up relay   # writes from anyone, as in production
cd backend && uv run pytest ../relay/tests          # policy tests
```

The app reaches the relay through the dev server at `/relay` (proxied to
`ws://localhost:7777`, or `RELAY_URL`), so it also works over HTTPS on a phone.
Your places are private place events (kind 31301), encrypted to your key; see
`frontend/src/placeEvents.ts`. The browser keeps your places as last seen
(`frontend/src/placeCache.ts`), encrypted under a cache key that is itself
NIP-44 encrypted to you, so reading them takes a single decryption (one
extension request). Each visit then asks the relay only for what changed, by
negentropy (NIP-77, `frontend/src/negentropy.ts`), and decrypts only the new
places; with a relay that can't, it loads everything. With `./dev.sh` running,
`VITE_RELAY_TEST_HOST=localhost:5173 npm test` in `frontend/` also runs a test
that saves, edits and deletes places on the relay.

The image adds our configuration to strfry's own (`relay/Dockerfile`). Events live in the
`relay-db` Docker volume. The policy is read by strfry at startup, so restart
the relay after editing `relay/authors.txt`.

## Deploying

The app and its API are served by Cloudflare at `https://stede.cc`; the relay
(`wss://relay.stede.cc`) runs on a Google Cloud VM behind a Cloudflare Tunnel. Setup and releases: [docs/deploy.md](docs/deploy.md).

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

## License

[MIT](LICENSE).

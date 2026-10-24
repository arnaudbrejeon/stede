# To do

## Live since 2026-10-18 (see docs/deploy.md)

- **Back up the relay with exports to a bucket.**
  A nightly `strfry export`, gzipped, to a Cloud Storage bucket in `stede-cc`
  (us-central1), keeping 30 days. Restores with `strfry import`, into strfry or
  any other relay. The VM needs write access to the bucket (a service account,
  or the storage read-write scope). The daily disk snapshots were dropped
  (2026-10-18), so until then there is no backup.

- **Email alert on Google Cloud costs.** A budget of $1 a month on "My
  Billing Account" (`BILLING-ACCOUNT-ID`, the account `stede-cc` bills to),
  emailing me when spending passes it, so anything
  outside the free tier shows up early. `gcloud billing budgets create`
  (needs the Billing Budget API enabled).

- **Rate-limit the API before sharing the app widely.** `/api/search` and
  `/api/address` pass requests on to Photon's free, fair-use server; abuse
  through stede.cc could get it blocked. Cloudflare's rate limiting can cap
  requests per visitor.

- **Check for package upgrades once a week.** Security fixes only reach the
  app when someone looks: `npm audit` in frontend/, `uvx pip-audit` on
  `uv export` of backend/, and Trivy on the relay image (its base, Alpine
  3.18, is end of life, so `apk upgrade` in relay/Dockerfile is all it gets
  until strfry's image moves on). The 2026-10-24 audit found vite, certifi
  and OpenSSL/musl behind. Either a weekly reminder, or GitHub's Dependabot
  for npm and uv, which opens pull requests by itself.

## Later

- **First visit on a new device decrypts every place.** Repeat visits read the
  browser's cache with one decryption, but a browser with no cache yet decrypts
  each place once (about 5 s for 12,000 places through an extension, shown as
  they come; longer on a phone). If that matters: an encrypted snapshot of all
  places on the relay, under the same cache key, so a new device needs one
  decryption and a download.

- **Save places to more than one relay.** Private places are encrypted and
  signed, so any relay can hold them: also writing to a relay from your NIP-65
  list (kind 10002) would keep a copy independent of the stede relay.

- **Post the comment on the Places NIP** (nostr-protocol/nips#2492) about
  private places on kind 31301, once the design has settled. Possibly also a
  note that `t` labels keep their case.

- **Opening status in the place's own time zone.** The status is judged by
  the browser's clock, so a place in another time zone is off by the
  difference. Needs the zone of a position (a lookup, or a small library).

- **Public holidays for saved places.** Search results carry Photon's country
  code, which opening_hours.js needs for `PH` rules; a saved place has none,
  so its holidays count as ordinary days. Store the code (or the country) on
  save.

- **A page in stede showing the relay's database.** Total events, number of
  pubkeys, a histogram of events per pubkey, by kind, and the size of the
  database on disk, so growth and abuse show up before the VM's 30 GB disk
  does. The API on Cloudflare can't see the VM, so the figures come from the
  relay side: a job next to the relay (cron on the VM, `strfry scan` or
  `strfry export | jq`, `du` on strfry-db/) publishes them regularly as an
  event the relay itself serves, say a replaceable kind 30078 signed by a
  relay key. For the page only to be readable with my key: encrypt the
  content with NIP-44 to my pubkey, as private places already are, so the
  event is public but the numbers are not; NIP-42 AUTH on the relay would be
  the stricter alternative. The page lives under a route like /relay in the
  app and renders the latest event.

## Ideas, not decided

- Remove `misc/chaucer.jpg` (a watermarked stock image; the about dialog uses
  the public-domain Ellesmere portrait).
- A dark interface to go with the Night map.
- Editing a place's other OpenStreetMap details (opening hours, phone…), stored
  as your own overrides of the fetched data, as the website already is.
- A Content-Security-Policy header for stede.cc.

## Done since going live (2026-10-18)

- A place's website: stored and editable, filled from OpenStreetMap, then found
  through the API rather than stored from OSM (2026-10-19, 2026-10-22).
- Opening hours from OpenStreetMap, with whether the place is open, closing
  soon or closed right now (2026-10-22, opening_hours.js, loaded on demand).
- iOS Safari: the map runs behind the floating toolbar, text fields don't zoom
  the page, and the page stays put when a field is focused.
- A reason when your position can't be found.

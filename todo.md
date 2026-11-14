# To do

## Live since 2026-10-18 (see docs/deploy.md)

- **Email alert on Google Cloud costs.** A budget of $1 a month on "My
  Billing Account" (`BILLING-ACCOUNT-ID`, the account `stede-cc` bills to),
  emailing me when spending passes it, so anything
  outside the free tier shows up early. `gcloud billing budgets create`
  (needs the Billing Budget API enabled).

- **A limit on Photon requests that holds.** The API counts its requests to
  Photon against a Cloudflare rate limit (70 per 10 s, all visitors together,
  2026-11-14), but a test of 12 searches a second for 20 s was never refused
  by it: Cloudflare counts loosely, on each of its machines. Photon then
  refused the API for about three minutes (the app shows search as
  unavailable). A single counter (a Durable Object) would hold. Until then
  Photon's own refusals are answered as "busy", so the app asks again.

- **Check for package upgrades once a week.** Security fixes only reach the
  app when someone looks: `npm audit` in frontend/, `uvx pip-audit` on
  `uv export` of backend/, and Trivy on the relay image (its base, Alpine
  3.18, is end of life, so `apk upgrade` in relay/Dockerfile is all it gets
  until strfry's image moves on). The 2026-10-24 audit found vite, certifi
  and OpenSSL/musl behind; all three fixed and deployed the same day. Either
  a weekly reminder, or GitHub's Dependabot for npm and uv, which opens pull
  requests by itself.

## Later

- **First visit on a new device decrypts every place.** Repeat visits read the
  browser's cache with one decryption, but a browser with no cache yet decrypts
  each place once (about 5 s for 12,000 places through an extension, shown as
  they come; longer on a phone). If that matters: an encrypted snapshot of all
  places on the relay, under the same cache key, so a new device needs one
  decryption and a download.

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

## Ideas, not decided

- A dark interface to go with the Night map.
- Editing a place's other OpenStreetMap details (opening hours, phone…), stored
  as your own overrides of the fetched data, as the website already is.
- A Content-Security-Policy header for stede.cc.
- The pie marker (2026-10-24) may go back to a ring if the smaller icon
  reads badly on busy maps; the designs are compared on icons.html.
- A street-level picture of a place: Mapillary's open imagery through the
  API (cacheable, CC BY-SA), or just a "Look around" link opening Apple or
  Google Maps at the spot. Apple's Look Around can't be captured from a web
  app, and its imagery may not be stored.
- On phones the full-screen page hides the map's zoom, locate and map-type
  buttons while it is open; they could move to the bottom right.
- The relay database's size on disk, which the stats page can't ask the
  relay for: a job on the VM (`du` on strfry-db/) publishing it as an event
  the relay serves, if the event count ever stops being a good enough proxy
  (about 1.1 kB an event, so 30 GB is some 25 million places).

## Done since going live (2026-10-18)

- A place's website: stored and editable, filled from OpenStreetMap, then found
  through the API rather than stored from OSM (2026-10-19, 2026-10-22).
- Opening hours from OpenStreetMap, with whether the place is open, closing
  soon or closed right now (2026-10-22, opening_hours.js, loaded on demand).
- iOS Safari: the map runs behind the floating toolbar, text fields don't zoom
  the page, and the page stays put when a field is focused.
- A reason when your position can't be found.
- Phones (2026-10-24): a place's details stay in the bottom sheet, but your
  key, editing a place and adding one open as a page over the whole screen,
  as tall as what the keyboard leaves, a focused field brought to the top.
  Adding a place: the search field pinned at the top, a row to drop a pin
  instead, which closes the page onto the map until the tap.
- Markers (2026-10-24): the tags' colours as a pie around the icon on a
  white core, instead of the thin ring.
- Adding a place: a result you already have is ticked and opens that place,
  the map flying to it (2026-10-24). Repeated searches answered from caches.
- Dependencies (2026-10-24): vite, certifi and the relay's Alpine packages
  taken past their advisories.
- A place's details open it in Apple Maps or Google Maps (2026-10-24).
- The relay's figures at stede.cc/stats (2026-10-25): private places, counted
  by the relay itself through NIP-45 when the page opens, so nothing runs on
  the VM and nothing is stored (authors dropped 2026-11-14, when the relay
  opened to every key).
- The relay takes places from any key (2026-11-14).
- Nightly backups of the relay to a Cloud Storage bucket, kept 30 days
  (2026-11-14, see docs/deploy.md).

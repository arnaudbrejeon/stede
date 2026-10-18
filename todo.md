# To do

## Go live (see docs/deploy.md)

- **Finish the deployment.** The Google Cloud side is ready but the VM
  (`stede` in project `stede-cc`) is stopped. Left to do: start it, log in to
  Cloudflare (`cloudflared tunnel login`, `npx wrangler@4 login`), create the
  tunnel and the `relay.stede.cc` DNS record, then `deploy/deploy.sh relay` and
  `deploy/deploy.sh app`. The relay picks up `relay/authors.txt` (three
  pubkeys) when it starts.

- **Remove the unused API image on the VM** (`stede-backend`, built before the
  API moved to Cloudflare): `docker image rm stede-backend` once it's running.

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

## Ideas, not decided

- Remove `misc/chaucer.jpg` (a watermarked stock image; the about dialog uses
  the public-domain Ellesmere portrait).
- A dark interface to go with the Night map.
- Editing a place's OpenStreetMap details (opening hours, website…), stored as
  your own overrides of the fetched data.
- A Content-Security-Policy header for stede.cc.

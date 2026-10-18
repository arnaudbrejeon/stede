# To do

- **Back up the relay with exports to a bucket.**
  A nightly `strfry export`, gzipped, to a Cloud Storage bucket in `stede-cc`
  (us-central1), keeping 30 days. Restores with `strfry import`, into strfry or
  any other relay. The VM needs write access to the bucket (a service account,
  or the storage read-write scope). The daily disk snapshots were dropped
  (2026-10-18), so until then there is no backup.

- **The app loads only what it needs, not every place on each visit.**
  Keep the places in the browser and fetch only what changed. Fetching newer
  events with `since` misses deletions and replaced versions, so it needs a
  proper solution: negentropy (NIP-77), which strfry supports, would compare
  what the browser holds with what the relay holds and transfer only the
  difference.

- **Email alert on Google Cloud costs.** A budget of $1 a month on "My
  Billing Account" (`BILLING-ACCOUNT-ID`, the account `stede-cc` bills to),
  emailing me when spending passes it, so anything
  outside the free tier shows up early. `gcloud billing budgets create`
  (needs the Billing Budget API enabled).

- **Add to allowlist.*
  npub147pj8hxkv5gygyk8vs3ckx3qjlgs45zf2s3fz0snxzh57hszk24sujd9hy

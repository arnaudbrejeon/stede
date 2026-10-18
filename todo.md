# To do

- **Back up the relay with exports to a bucket.**
  A nightly `strfry export`, gzipped, to a Cloud Storage bucket in `stede-cc`
  (us-central1), keeping 30 days. Restores with `strfry import`, into strfry or
  any other relay. The VM needs write access to the bucket (a service account,
  or the storage read-write scope). The daily disk snapshots were dropped
  (2026-10-18), so until then there is no backup.

- **First visit on a new device decrypts every place.** Repeat visits read the
  browser's cache with one decryption, but a browser with no cache yet decrypts
  each place once (about 5 s for 12,000 places through an extension, shown as
  they come; longer on a phone). If that matters: an encrypted snapshot of all
  places on the relay, under the same cache key, so a new device needs one
  decryption and a download.

- **Email alert on Google Cloud costs.** A budget of $1 a month on "My
  Billing Account" (`BILLING-ACCOUNT-ID`, the account `stede-cc` bills to),
  emailing me when spending passes it, so anything
  outside the free tier shows up early. `gcloud billing budgets create`
  (needs the Billing Budget API enabled).

- **Add to allowlist.*
  npub147pj8hxkv5gygyk8vs3ckx3qjlgs45zf2s3fz0snxzh57hszk24sujd9hy

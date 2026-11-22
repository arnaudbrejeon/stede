// The relay's backups (deploy/backup.sh), as the stats page shows them: the
// latest one in the Cloud Storage bucket, and when the next is due. The bucket
// isn't public, so the worker reads it as an account of its own that may only
// read it (`deploy/deploy.sh backup-status-setup`), whose key is a secret.

import type { Fetch } from './http'

// When the VM's timer runs deploy/backup.sh (OnCalendar in deploy/deploy.sh).
export const BACKUP_HOUR_UTC = 9

export type Backups = {
  // `events` and `authors` (people with private places) were counted by the
  // backup; older backups don't have them.
  latest: { at: string; bytes: number; events?: number; authors?: number } | null
  // Backups the bucket keeps (it deletes each after 30 days).
  kept: number
  next: string
}

// A Google service account key, as `gcloud iam service-accounts keys create` writes it.
type ServiceAccountKey = { client_email: string; private_key: string; token_uri?: string }

type StorageObject = {
  name: string
  size: string
  timeCreated: string
  metadata?: { events?: string; authors?: string }
}

export async function backupStatus(
  fetch: Fetch,
  bucket: string,
  keyJson: string,
  now = new Date(),
): Promise<Backups> {
  const token = await accessToken(fetch, JSON.parse(keyJson) as ServiceAccountKey, now)
  const query = new URLSearchParams({
    prefix: 'strfry-',
    fields: 'items(name,size,timeCreated,metadata)',
  })
  const response = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?${query}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!response.ok) throw new Error(`Cloud Storage answered ${response.status}`)
  const items = ((await response.json()) as { items?: StorageObject[] }).items ?? []
  // ISO times in UTC sort as text.
  const newest = items.reduce<StorageObject | null>(
    (a, b) => (a && a.timeCreated >= b.timeCreated ? a : b),
    null,
  )
  return {
    latest: newest && {
      at: newest.timeCreated,
      bytes: Number(newest.size),
      ...counted('events', newest.metadata?.events),
      ...counted('authors', newest.metadata?.authors),
    },
    kept: items.length,
    next: nextBackup(now).toISOString(),
  }
}

function counted(name: string, value: string | undefined) {
  const count = Number(value)
  return value && Number.isInteger(count) ? { [name]: count } : {}
}

export function nextBackup(now: Date): Date {
  const next = new Date(now)
  next.setUTCHours(BACKUP_HOUR_UTC, 0, 0, 0)
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
  return next
}

// An OAuth access token for the account: a JWT signed with its key, exchanged
// at Google's token endpoint (https://developers.google.com/identity/protocols/oauth2/service-account).
async function accessToken(fetch: Fetch, key: ServiceAccountKey, now: Date): Promise<string> {
  const tokenUri = key.token_uri ?? 'https://oauth2.googleapis.com/token'
  const iat = Math.floor(now.getTime() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(
    JSON.stringify({
      iss: key.client_email,
      scope: 'https://www.googleapis.com/auth/devstorage.read_only',
      aud: tokenUri,
      iat,
      exp: iat + 3600,
    }),
  )
  const signingKey = await crypto.subtle.importKey(
    'pkcs8',
    pemBytes(key.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    signingKey,
    new TextEncoder().encode(`${header}.${claims}`),
  )
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${base64url(signature)}`,
    }),
  })
  if (!response.ok) throw new Error(`Google's token endpoint answered ${response.status}`)
  return ((await response.json()) as { access_token: string }).access_token
}

function pemBytes(pem: string): ArrayBuffer {
  const base64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer
}

function base64url(data: string | ArrayBuffer): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

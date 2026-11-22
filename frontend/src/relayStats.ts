import { SimplePool } from 'nostr-tools/pool'

// The relay's figures, asked of the relay itself: strfry answers NIP-45 COUNT
// requests from its index, so nothing is stored or scheduled and the numbers
// are those of the moment. A count can't say whose the events are: the people
// with private places are counted by the nightly backup (deploy/backup.sh).

// The one kind the relay holds today: private places (see relay/policy.py).
export const PRIVATE_PLACE_KIND = 31301
const TIMEOUT_MS = 10_000

export type RelayStats = {
  // Private place events on the relay.
  events: number
  at: Date
}

const pool = new SimplePool()

export async function fetchRelayStats(url: string): Promise<RelayStats> {
  const relay = await pool.ensureRelay(url, { connectionTimeout: TIMEOUT_MS })
  const events = await Promise.race([
    relay.count([{ kinds: [PRIVATE_PLACE_KIND] }], {}),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('the relay did not answer')), TIMEOUT_MS),
    ),
  ])
  return { events, at: new Date() }
}

// The relay's backups, from the worker (worker/backups.ts), which reads the
// backup bucket. Null when the worker can't tell.
export type BackupStatus = {
  // `authors`: people with private places, counted by the backup.
  latest: { at: Date; bytes: number; authors?: number } | null
  kept: number
  next: Date
  // When this was asked.
  at: Date
}

export async function fetchBackupStatus(): Promise<BackupStatus | null> {
  const response = await fetch('/api/backups')
  if (!response.ok) return null
  const body = (await response.json()) as {
    latest: { at: string; bytes: number; authors?: number } | null
    kept: number
    next: string
  }
  return {
    latest: body.latest && {
      at: new Date(body.latest.at),
      bytes: body.latest.bytes,
      authors: body.latest.authors,
    },
    kept: body.kept,
    next: new Date(body.next),
    at: new Date(),
  }
}

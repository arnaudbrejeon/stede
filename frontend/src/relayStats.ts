import { SimplePool } from 'nostr-tools/pool'

// The relay's figures, asked of the relay itself: strfry answers NIP-45 COUNT
// requests from its index, so nothing is stored or scheduled and the numbers
// are those of the moment. The relay doesn't say who writes to it, so the
// authors come from relay/authors.txt (the policy's list), put into the build.

// The one kind the relay holds today: private places (see relay/policy.py).
export const PRIVATE_PLACE_KIND = 31301
const TIMEOUT_MS = 10_000

export type AuthorCount = { pubkey: string; count: number }
export type RelayStats = {
  // Private place events on the relay.
  events: number
  // Every registered author, with their number of events.
  authors: AuthorCount[]
  at: Date
}

// relay/authors.txt: a hex pubkey a line, "#" comments, as relay/policy.py reads it.
export function parseAuthors(text: string): string[] {
  const authors = new Set<string>()
  for (const line of text.split('\n')) {
    const value = line.split('#', 1)[0].trim().toLowerCase()
    if (value) authors.add(value)
  }
  return [...authors]
}

const pool = new SimplePool()

export async function fetchRelayStats(url: string, authors: string[]): Promise<RelayStats> {
  const relay = await pool.ensureRelay(url, { connectionTimeout: TIMEOUT_MS })
  const count = (filter: { authors?: string[] }) =>
    Promise.race([
      relay.count([{ kinds: [PRIVATE_PLACE_KIND], ...filter }], {}),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('the relay did not answer')), TIMEOUT_MS),
      ),
    ])
  const [events, ...counts] = await Promise.all([
    count({}),
    ...authors.map((pubkey) => count({ authors: [pubkey] })),
  ])
  return {
    events,
    authors: authors.map((pubkey, i) => ({ pubkey, count: counts[i] })),
    at: new Date(),
  }
}

export type Bucket = {
  label: string
  // Authors holding between min and max events, both included.
  min: number
  max: number
  authors: number
}

// Authors by how many events they hold, a bucket per power of ten, so the
// shape reads the same with ten authors or ten thousand: one with a lot, many
// with a few.
const BUCKETS: [number, number][] = [
  [0, 0],
  [1, 9],
  [10, 99],
  [100, 999],
  [1_000, 9_999],
  [10_000, Infinity],
]

export function histogram(authors: AuthorCount[]): Bucket[] {
  return BUCKETS.map(([min, max]) => ({
    label: bucketLabel(min, max),
    min,
    max,
    authors: authors.filter(({ count }) => count >= min && count <= max).length,
  }))
}

function bucketLabel(min: number, max: number): string {
  if (max === Infinity) return `${min.toLocaleString()}+`
  if (min === max) return min.toLocaleString()
  return `${min.toLocaleString()}–${max.toLocaleString()}`
}

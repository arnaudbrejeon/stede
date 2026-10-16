import { useSyncExternalStore } from 'react'
import { getPublicKey, type NostrEvent } from 'nostr-tools'
import { AbstractSimplePool } from 'nostr-tools/abstract-pool'
import { SimplePool } from 'nostr-tools/pool'
import { getKeyState, getSecretKey, subscribeKey } from './keystore'
import {
  conversationKey,
  deletionEvent,
  innerPlace,
  keepUnmanagedTags,
  openPlace,
  placeFromInner,
  PRIVATE_PLACE_KIND,
  sealPlace,
  type InnerPlace,
  type PlaceDraft,
} from './placeEvents'
import { NO_PLACES, type Place, type Places } from './places'
import {
  buildPlacesFile,
  parsePlacesFile,
  planImport,
  type PlaceRecord,
  type PlacesFile,
} from './placesFile'

// Your places, kept on the stede relay as private place events (see
// placeEvents.ts). They load when the key is unlocked and are dropped when it
// locks. Saving and deleting update the map at once, then publish.

// Served through the dev server (/relay, see vite.config.ts), so the app reaches
// the relay on the same origin, over wss:// when the page is HTTPS.
const RELAY_URL =
  import.meta.env.VITE_RELAY_URL ??
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/relay`
// The relay's maxFilterLimit: larger collections load in pages.
const PAGE_SIZE = 500
// Imports date at most this many places per second, so a page (dated from the
// newest back) never ends inside a second it can't get past.
const PER_SECOND = 400
// Addresses per deletion event (well under the relay's 64 KiB event limit).
const DELETE_BATCH = 400
// Events published at once during an import or a delete-all.
const CONCURRENCY = 16

export type PlacesStatus = 'idle' | 'loading' | 'ready' | 'error'
export type PlacesState = {
  status: PlacesStatus
  places: Places
  error: string | null
  // Events read so far while loading.
  loaded: number
}

let state: PlacesState = { status: 'idle', places: NO_PLACES, error: null, loaded: 0 }
const listeners = new Set<() => void>()
const pool = new SimplePool()
// Reads your private places without checking signatures, which would take
// seconds for thousands of places. Nothing is lost: a place only counts once it
// decrypts, and its NIP-44 MAC is keyed by your own secret key, so no one else
// can make one (see openPlace for the outer tags).
const placesPool = new AbstractSimplePool({ verifyEvent: () => true, maxWaitForConnection: 3000 })
// Bumped on every load and lock, so a slow load can't overwrite newer state.
let generation = 0
// Each place's latest version, by d. Relays keep the newest version of a place
// (on a tie the lower event id), so a new version is dated after the last one.
const records = new Map<string, PlaceRecord & { place: Place }>()
// Relays refuse versions of a deleted place dated up to its deletion, so what's
// published after a deletion is dated after it.
let lastDeletion = 0

function setState(next: Partial<PlacesState>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getPlacesState(): PlacesState {
  return state
}

export function usePlaces(): PlacesState {
  return useSyncExternalStore(subscribe, getPlacesState)
}

function showRecords() {
  const features = [...records.values()].map((r) => r.place)
  setState({ places: { type: 'FeatureCollection', features } })
}

function keep(inner: InnerPlace, createdAt: number): Place | null {
  const place = placeFromInner(inner)
  if (place) records.set(place.properties.id, { inner, createdAt, place })
  return place
}

// Follows the key: load on unlock, forget on lock.
let loadedFor: string | null = null
function onKeyChange() {
  const key = getKeyState()
  const pubkey = key.status === 'unlocked' ? key.pubkey : null
  if (pubkey === loadedFor) return
  loadedFor = pubkey
  generation++
  if (pubkey) void loadPlaces()
  else {
    records.clear()
    setState({ status: 'idle', places: NO_PLACES, error: null, loaded: 0 })
  }
}
subscribeKey(onKeyChange)
onKeyChange()

export async function loadPlaces(): Promise<void> {
  const secretKey = requireKey()
  const run = ++generation
  setState({ status: 'loading', error: null, loaded: 0 })
  try {
    const events = await fetchAll(getPublicKey(secretKey), (loaded) => {
      if (run === generation) setState({ loaded })
    })
    if (run !== generation) return
    readEvents(events, conversationKey(secretKey))
    setState({ status: 'ready' })
    showRecords()
  } catch (error) {
    if (run !== generation) return
    console.error(error)
    setState({ status: 'error', error: 'Your places could not be loaded from the relay.' })
  }
}

// Saves a new place (no id) or a new version of one; returns the saved place.
// Tags the app doesn't manage (another app's labels…) are kept.
export async function savePlace(draft: PlaceDraft): Promise<Place> {
  const secretKey = requireKey()
  const id = draft.id ?? crypto.randomUUID()
  const previous = records.get(id)
  const inner = keepUnmanagedTags(innerPlace({ ...draft, id }), previous?.inner)
  if (!placeFromInner(inner)) throw new Error('This place is missing its name or position.')
  const createdAt = Math.max(nowSeconds(), (previous?.createdAt ?? 0) + 1, lastDeletion + 1)
  await publish(sealPlace(inner, secretKey, createdAt))
  const place = keep(inner, createdAt)!
  showRecords()
  return place
}

export async function deletePlace(id: string): Promise<void> {
  await deleteIds([id])
  showRecords()
}

// Deletes every place; returns how many.
export async function deleteAllPlaces(onProgress?: (done: number, total: number) => void) {
  const ids = [...records.keys()]
  await deleteIds(ids, onProgress)
  showRecords()
  return ids.length
}

async function deleteIds(ids: string[], onProgress?: (done: number, total: number) => void) {
  const secretKey = requireKey()
  // Dated after every version it deletes, or the newer ones would survive it.
  const latest = Math.max(0, ...ids.map((id) => records.get(id)?.createdAt ?? 0))
  const createdAt = Math.max(nowSeconds(), latest, lastDeletion)
  const batches = chunks(ids, DELETE_BATCH)
  let done = 0
  await runAll(batches, undefined, async (batch) => {
    await publish(deletionEvent(batch, secretKey, createdAt))
    for (const id of batch) records.delete(id)
    done += batch.length
    onProgress?.(done, ids.length)
  })
  lastDeletion = Math.max(lastDeletion, createdAt)
}

// The places file of everything you have (see placesFile.ts).
export function exportPlaces(): PlacesFile {
  return buildPlacesFile(records.values(), nowSeconds())
}

export type ImportResult = {
  added: number
  updated: number
  merged: number
  unchanged: number
  invalid: number
  failed: number
  // Stopped before the end: only `saved` of `total` places were written.
  cancelled: boolean
  saved: number
  total: number
}

// Imports a places file: new places are added, newer versions of yours replace
// them, and duplicates are merged into the place you have (see planImport).
// Aborting stops it between places; what was saved stays, and importing the
// same file again skips those and carries on with the rest.
export async function importPlaces(
  text: string,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ImportResult> {
  const secretKey = requireKey()
  const { places, invalid } = parsePlacesFile(text)
  const plan = planImport(records, places)
  // Dated forward from now (after any deletion), a few hundred per second. The
  // relay accepts events up to 15 minutes ahead: room for 360,000 places.
  let slot = Math.max(nowSeconds(), lastDeletion + 1) * PER_SECOND
  const nextDate = (previous?: PlaceRecord) => {
    const at = Math.max(Math.floor(slot++ / PER_SECOND), (previous?.createdAt ?? 0) + 1)
    slot = Math.max(slot, at * PER_SECOND)
    return at
  }
  const dated = plan.writes.map((write) => ({ ...write, createdAt: nextDate(write.previous) }))

  let done = 0
  let failed = 0
  let saved = 0
  onProgress?.(0, dated.length)
  await runAll(dated, signal, async ({ inner, createdAt }) => {
    let event = inner
    try {
      await publish(sealPlace(inner, secretKey, createdAt))
    } catch (error) {
      // A place deleted from this relay can't come back under its address.
      if (!String(error).includes('deleted')) {
        failed++
        return
      }
      event = withNewId(inner)
      try {
        await publish(sealPlace(event, secretKey, createdAt))
      } catch {
        failed++
        return
      }
    } finally {
      onProgress?.(++done, dated.length)
    }
    keep(event, createdAt)
    saved++
  })
  showRecords()
  const { added, updated, merged, unchanged } = plan
  const cancelled = !!signal?.aborted && done < dated.length
  return {
    added,
    updated,
    merged,
    unchanged,
    invalid,
    failed,
    cancelled,
    saved,
    total: dated.length,
  }
}

function withNewId(inner: InnerPlace): InnerPlace {
  const id = crypto.randomUUID()
  return { ...inner, tags: inner.tags.map((t) => (t[0] === 'd' ? ['d', id] : t)) }
}

function requireKey(): Uint8Array {
  const secretKey = getSecretKey()
  if (!secretKey) throw new Error('Unlock your key first.')
  return secretKey
}

async function publish(event: NostrEvent): Promise<void> {
  try {
    await Promise.any(pool.publish([RELAY_URL], event))
  } catch (error) {
    const reason = error instanceof AggregateError ? error.errors[0] : error
    throw new Error(`The relay refused it: ${reason instanceof Error ? reason.message : reason}`)
  }
}

// Runs `work` over every item, CONCURRENCY at a time, until `signal` aborts.
async function runAll<T>(
  items: readonly T[],
  signal: AbortSignal | undefined,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length && !signal?.aborted) await work(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker))
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

// Every private place of an author, a page at a time from the newest back.
async function fetchAll(pubkey: string, onPage?: (loaded: number) => void): Promise<NostrEvent[]> {
  const byId = new Map<string, NostrEvent>()
  let until: number | undefined
  for (;;) {
    const page = await placesPool.querySync([RELAY_URL], {
      kinds: [PRIVATE_PLACE_KIND],
      authors: [pubkey],
      limit: PAGE_SIZE,
      ...(until !== undefined && { until }),
    })
    const fresh = page.filter((e) => !byId.has(e.id))
    for (const event of fresh) byId.set(event.id, event)
    onPage?.(byId.size)
    // A page ends on a second it may not have exhausted, so the next page starts
    // on that same second; it's done when a page brings nothing new.
    if (fresh.length === 0 || page.length < PAGE_SIZE) break
    until = Math.min(...page.map((e) => e.created_at))
  }
  return [...byId.values()]
}

// Keeps the newest version of each place; events that don't decrypt are skipped.
function readEvents(events: NostrEvent[], key: Uint8Array) {
  const newest = new Map<string, NostrEvent>()
  for (const event of events) {
    const d = event.tags.find((t) => t[0] === 'd')?.[1]
    if (!d) continue
    const seen = newest.get(d)
    if (!seen || event.created_at > seen.created_at) newest.set(d, event)
  }
  records.clear()
  for (const event of newest.values()) {
    try {
      if (!keep(openPlace(event, key), event.created_at))
        console.warn('Skipping an invalid place', event.id)
    } catch (error) {
      console.warn('Skipping a place that does not decrypt', event.id, error)
    }
  }
}

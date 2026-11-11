import { useSyncExternalStore } from 'react'
import type { NostrEvent } from 'nostr-tools'
import { AbstractSimplePool } from 'nostr-tools/abstract-pool'
import { SimplePool } from 'nostr-tools/pool'
import { getKeyState, getNostr, subscribeKey } from './keystore'
import { reconcile } from './negentropy'
import { clearCache, lockCache, readCache, writeCache, type CachedPlace } from './placeCache'
import {
  DELETION_KIND,
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
import { getRelays, subscribeRelays } from './relayList'
import type { Nostr } from './signer'
import {
  buildPlacesFile,
  parsePlacesFile,
  planImport,
  type PlaceRecord,
  type PlacesFile,
} from './placesFile'

// Your places, kept as private place events (see placeEvents.ts) on your
// relays: the stede relay, or those you chose (relayList.ts). They load when
// the key is unlocked and are dropped when it locks. Saving and deleting update
// the map at once, then publish to every relay; it's done once one takes it.
//
// Your places are also kept in this browser, encrypted (placeCache.ts): a visit
// shows those at once, then asks each relay only for what changed
// (negentropy.ts), falling back to loading everything from a relay that can't
// sync that way. Only new places are decrypted one by one, shown as they come.
//
// Relays can disagree: one was down when a place was saved, or was just added.
// Then the deletions on them settle which places are gone, and each relay is
// sent the places and deletions it's missing (see syncWithRelays).

// The relay's maxFilterLimit: larger collections load in pages.
const PAGE_SIZE = 500
// While decrypting, the map is updated at most this often.
const SHOW_EVERY_MS = 400
// The cache is saved this long after the last change.
const SAVE_CACHE_AFTER_MS = 1000
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
  // While loading: events read from the relay, then how many of them are
  // decrypted (slow with an extension, which decrypts one at a time).
  loaded: number
  opened: number
  // Checking with the relays for changes, while showing what this browser holds.
  syncing: boolean
  // Places and deletions still to send to relays missing them.
  copying: number
}

let state: PlacesState = {
  status: 'idle',
  places: NO_PLACES,
  error: null,
  loaded: 0,
  opened: 0,
  syncing: false,
  copying: 0,
}
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
const records = new Map<string, PlaceRecord & { place: Place; eventId: string }>()
// Your private place events, by id: what the relay holds, as far as we know.
// `inner` is the decrypted place (null: not a valid place); until it's
// decrypted, `event` is kept to decrypt it.
type Known = CachedPlace | (Omit<CachedPlace, 'inner'> & { inner?: undefined; event: NostrEvent })
const known = new Map<string, Known>()
// Versions replaced or deleted here since the load began: a sync that started
// before must not bring them back.
const superseded = new Set<string>()
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

function keep(inner: InnerPlace, createdAt: number, eventId: string): Place | null {
  const place = placeFromInner(inner)
  if (place) records.set(place.properties.id, { inner, createdAt, place, eventId })
  return place
}

function dOf(event: NostrEvent): string {
  return event.tags.find((t) => t[0] === 'd')?.[1] ?? ''
}

// A version just published: known, decrypted, and replacing `previous`.
function remember(event: NostrEvent, inner: InnerPlace, previous?: string) {
  known.set(event.id, { id: event.id, created_at: event.created_at, d: dOf(event), inner })
  if (previous) forget([previous])
  else saveCacheSoon()
}

function forget(eventIds: string[]) {
  for (const id of eventIds) {
    known.delete(id)
    superseded.add(id)
  }
  saveCacheSoon()
}

// Saves the decrypted places to the cache shortly after the last change.
let saveTimer: ReturnType<typeof setTimeout> | undefined
function saveCacheSoon() {
  clearTimeout(saveTimer)
  const run = generation
  saveTimer = setTimeout(() => {
    const key = getKeyState()
    const nostr = getNostr()
    if (run !== generation || !nostr || !key.pubkey) return
    const places = [...known.values()].filter((k): k is CachedPlace => k.inner !== undefined)
    void writeCache(key.pubkey, nostr, places)
  }, SAVE_CACHE_AFTER_MS)
}

// Follows the key: load on unlock, forget on lock.
let loadedFor: string | null = null
// Removing a key from this browser also removes its cached events.
let keyPubkey: string | null = null
function onKeyChange() {
  const key = getKeyState()
  if (key.status !== 'loading' && key.pubkey !== keyPubkey) {
    if (keyPubkey) void clearCache(keyPubkey)
    keyPubkey = key.pubkey
    // Deletions so far were another key's.
    lastDeletion = 0
  }
  const pubkey = key.status === 'unlocked' ? key.pubkey : null
  if (pubkey === loadedFor) return
  loadedFor = pubkey
  generation++
  if (pubkey) void loadPlaces()
  else {
    lockCache()
    records.clear()
    known.clear()
    setState({
      status: 'idle',
      places: NO_PLACES,
      error: null,
      loaded: 0,
      opened: 0,
      syncing: false,
      copying: 0,
    })
  }
}
subscribeKey(onKeyChange)
onKeyChange()

// A change of relays loads again: from the new ones, and copying your places
// to those missing them.
let relaysLoaded = getRelays().relays.join(' ')
subscribeRelays(() => {
  const relays = getRelays().relays.join(' ')
  if (relays === relaysLoaded) return
  relaysLoaded = relays
  if (loadedFor) void loadPlaces()
})

export async function loadPlaces(): Promise<void> {
  const { nostr, pubkey } = requireKey()
  const run = ++generation
  records.clear()
  known.clear()
  superseded.clear()
  setState({ status: 'loading', error: null, loaded: 0, opened: 0, syncing: true, copying: 0 })
  try {
    const cached = await readCache(pubkey, nostr)
    if (run !== generation) return
    for (const place of cached) known.set(place.id, place)
    if (cached.length > 0) {
      showKnown()
      setState({ status: 'ready' })
    }
    const { changed, copies } = await syncWithRelays(pubkey, run)
    if (run !== generation) return
    await openNew(run, nostr)
    if (run !== generation) return
    if (changed || cached.length === 0) showKnown()
    setState({ status: 'ready', syncing: false })
    if (changed || cached.length === 0) saveCacheSoon()
    await sendCopies(copies, run)
  } catch (error) {
    if (run !== generation) return
    console.error(error)
    if (state.status === 'ready') {
      setState({
        syncing: false,
        error: 'Your relays could not be reached: these are your places as last seen here.',
      })
    } else {
      setState({
        status: 'error',
        syncing: false,
        error: 'Your places could not be loaded from your relays.',
      })
    }
  }
}

// Shows the newest version of each place, among those decrypted.
function showKnown() {
  records.clear()
  for (const entry of newestByPlace(known.values())) {
    if (entry.inner) keep(entry.inner, entry.created_at, entry.id)
  }
  showRecords()
}

// Decrypts the places not decrypted yet, showing them as they come.
async function openNew(run: number, nostr: Nostr) {
  const newest = newestByPlace(known.values())
  const toOpen = newest.flatMap((entry) => (entry.inner === undefined ? [entry] : []))
  let opened = newest.length - toOpen.length
  setState({ loaded: newest.length, opened })
  let shownAt = performance.now()
  await runAll(toOpen, undefined, async ({ event }) => {
    let inner: InnerPlace | null = null
    try {
      inner = await openPlace(event, nostr)
      if (!placeFromInner(inner)) {
        console.warn('Skipping an invalid place', event.id)
        inner = null
      }
    } catch (error) {
      console.warn('Skipping a place that does not decrypt', event.id, error)
    }
    if (run !== generation || !known.has(event.id)) return
    known.set(event.id, { id: event.id, created_at: event.created_at, d: dOf(event), inner })
    opened++
    if (performance.now() - shownAt > SHOW_EVERY_MS) {
      shownAt = performance.now()
      showKnown()
      setState({ opened })
    }
  })
  setState({ opened })
}

// What a relay holds, next to what this browser knows: the known events it
// lacks, and its events not known here (fetched).
type RelayHolding = { url: string; lacks: Set<string>; events: NostrEvent[] }

// An event to send to relays missing it.
type Copy = { event: NostrEvent; to: string[] }

// Brings `known` in line with the relays. Changed: anything was added or
// dropped. Copies: what to send to relays missing it, once the places show.
async function syncWithRelays(
  pubkey: string,
  run: number,
): Promise<{ changed: boolean; copies: Copy[] }> {
  const relays = getRelays().relays
  const results = await Promise.allSettled(relays.map((url) => readRelay(url, pubkey, run)))
  const holdings = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  if (holdings.length === 0) throw (results[0] as PromiseRejectedResult).reason
  for (const r of results) if (r.status === 'rejected') console.warn('A relay could not be read', r.reason)
  if (run !== generation) return { changed: false, copies: [] }

  const fetched = new Map<string, NostrEvent>()
  for (const { events } of holdings)
    for (const event of events) if (!superseded.has(event.id)) fetched.set(event.id, event)
  // Which relays (of those reached) hold each event.
  const holders = new Map<string, string[]>()
  for (const id of known.keys()) {
    holders.set(id, holdings.flatMap(({ url, lacks }) => (lacks.has(id) ? [] : [url])))
  }
  for (const { url, events } of holdings) {
    for (const { id } of events) if (fetched.has(id)) holders.set(id, [...(holders.get(id) ?? []), url])
  }
  const before = known.size
  let changed = false
  for (const [id, event] of fetched) {
    if (known.has(id)) continue
    known.set(id, { id, created_at: event.created_at, d: dOf(event), event })
    changed = true
  }
  // Gone from every relay reached: replaced or deleted.
  for (const [id, on] of holders) if (on.length === 0 && known.delete(id)) changed = true
  if (holdings.length === 1 || [...holders.values()].every((on) => on.length === holdings.length))
    return { changed, copies: [] }

  // The relays disagree. Deletions settle which places are gone; of the rest,
  // each place's newest version is kept, and sent where it's missing, with
  // the deletions.
  const deletions = await Promise.all(holdings.map(({ url }) => fetchDeletions(url, pubkey)))
  if (run !== generation) return { changed: false, copies: [] }
  const deletedAt = new Map<string, number>()
  const deletionCopies = new Map<string, Copy>()
  deletions.forEach((events, i) => {
    for (const event of events) {
      for (const [name, value] of event.tags) {
        const prefix = `${PRIVATE_PLACE_KIND}:${pubkey}:`
        if (name !== 'a' || !value?.startsWith(prefix)) continue
        const d = value.slice(prefix.length)
        deletedAt.set(d, Math.max(deletedAt.get(d) ?? 0, event.created_at))
      }
      const copy = deletionCopies.get(event.id) ?? { event, to: holdings.map((h) => h.url) }
      copy.to = copy.to.filter((url) => url !== holdings[i].url)
      deletionCopies.set(event.id, copy)
    }
  })
  for (const entry of [...known.values()]) {
    if (entry.created_at <= (deletedAt.get(entry.d) ?? -1)) {
      known.delete(entry.id)
      changed = true
    }
  }
  const newest = new Set(newestByPlace(known.values()).map((entry) => entry.id))
  for (const id of known.keys()) {
    if (!newest.has(id)) {
      known.delete(id)
      changed = true
    }
  }
  // Each place's newest version, by the relays missing it. Its event is
  // fetched from a relay that has it, unless it was just fetched.
  const missing = new Map<string, string[]>()
  const toFetch = new Map<string, string[]>()
  const placeCopies: Copy[] = []
  for (const id of newest) {
    const on = holders.get(id) ?? []
    const to = holdings.map((h) => h.url).filter((url) => !on.includes(url))
    if (to.length === 0) continue
    missing.set(id, to)
    const event = fetched.get(id)
    if (event) placeCopies.push({ event, to })
    else toFetch.set(on[0], [...(toFetch.get(on[0]) ?? []), id])
  }
  for (const [from, ids] of toFetch) {
    for (const event of await fetchByIds(from, pubkey, ids).catch(() => [])) {
      placeCopies.push({ event, to: missing.get(event.id)! })
    }
  }
  if (run !== generation) return { changed: false, copies: [] }
  const copies = [...[...deletionCopies.values()].filter((c) => c.to.length > 0), ...placeCopies]
  return { changed: changed || known.size !== before, copies }
}

// What a relay holds of your places, next to what's known here.
async function readRelay(url: string, pubkey: string, run: number): Promise<RelayHolding> {
  const filter = { kinds: [PRIVATE_PLACE_KIND], authors: [pubkey] }
  try {
    const { have, need } = await reconcile(url, filter, [...known.values()])
    return { url, lacks: new Set(have), events: await fetchByIds(url, pubkey, need) }
  } catch (error) {
    // No NIP-77 sync: load everything, as without a cache.
    console.warn(`Loading all places from ${url}: the relay could not sync changes.`, error)
    const all = await fetchAll(url, pubkey, (loaded) => {
      if (run === generation) setState({ loaded })
    })
    const onRelay = new Set(all.map((event) => event.id))
    return {
      url,
      lacks: new Set([...known.keys()].filter((id) => !onRelay.has(id))),
      events: all.filter((event) => !known.has(event.id)),
    }
  }
}

// Your deletions of private places on a relay.
function fetchDeletions(url: string, pubkey: string): Promise<NostrEvent[]> {
  return placesPool
    .querySync([url], { kinds: [DELETION_KIND], authors: [pubkey], '#k': [String(PRIVATE_PLACE_KIND)] })
    .catch(() => [])
}

// Sends each relay the places and deletions it's missing. Deletions go first,
// so a relay never takes a version of a place it should delete.
async function sendCopies(copies: Copy[], run: number) {
  if (copies.length === 0) return
  let left = copies.length
  setState({ copying: left })
  const deletions = copies.filter((c) => c.event.kind === DELETION_KIND)
  const places = copies.filter((c) => c.event.kind !== DELETION_KIND)
  for (const batch of [deletions, places]) {
    await runAll(batch, undefined, async ({ event, to }) => {
      if (run !== generation) return
      const results = await Promise.allSettled(pool.publish(to, event))
      for (const r of results) if (r.status === 'rejected') console.warn('A relay refused a copy', r.reason)
      if (run === generation) setState({ copying: --left })
    })
  }
}

// Your private place events with these ids on a relay, PAGE_SIZE at a time.
async function fetchByIds(url: string, pubkey: string, ids: string[]): Promise<NostrEvent[]> {
  const events: NostrEvent[] = []
  for (const batch of chunks(ids, PAGE_SIZE)) {
    events.push(
      ...(await placesPool.querySync([url], {
        ids: batch,
        kinds: [PRIVATE_PLACE_KIND],
        authors: [pubkey],
      })),
    )
  }
  return events
}

// The newest version of each place (by d). Relays keep the latest, and on a
// tie the lower id.
function newestByPlace(entries: Iterable<Known>): Known[] {
  const newest = new Map<string, Known>()
  for (const entry of entries) {
    if (!entry.d) continue
    const seen = newest.get(entry.d)
    if (
      !seen ||
      entry.created_at > seen.created_at ||
      (entry.created_at === seen.created_at && entry.id < seen.id)
    ) {
      newest.set(entry.d, entry)
    }
  }
  return [...newest.values()]
}

// Saves a new place (no id) or a new version of one; returns the saved place.
// Tags the app doesn't manage (another app's labels…) are kept.
export async function savePlace(draft: PlaceDraft): Promise<Place> {
  const { nostr, pubkey } = requireKey()
  const id = draft.id ?? crypto.randomUUID()
  const previous = records.get(id)
  const inner = keepUnmanagedTags(innerPlace({ ...draft, id }), previous?.inner)
  if (!placeFromInner(inner)) throw new Error('This place is missing its name or position.')
  const createdAt = Math.max(nowSeconds(), (previous?.createdAt ?? 0) + 1, lastDeletion + 1)
  const event = await sealPlace(inner, nostr, pubkey, createdAt)
  await publish(event)
  remember(event, inner, previous?.eventId)
  const place = keep(inner, createdAt, event.id)!
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
  const { nostr, pubkey } = requireKey()
  // Dated after every version it deletes, or the newer ones would survive it.
  const latest = Math.max(0, ...ids.map((id) => records.get(id)?.createdAt ?? 0))
  const createdAt = Math.max(nowSeconds(), latest, lastDeletion)
  const batches = chunks(ids, DELETE_BATCH)
  let done = 0
  await runAll(batches, undefined, async (batch) => {
    await publish(await deletionEvent(batch, nostr, pubkey, createdAt))
    forget(batch.flatMap((id) => records.get(id)?.eventId ?? []))
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
  // Told how many places will be written before any is; false stops the import.
  beforeWrite?: (count: number) => Promise<boolean>,
): Promise<ImportResult> {
  const { nostr, pubkey } = requireKey()
  const { places, invalid } = parsePlacesFile(text)
  const plan = planImport(records, places)
  if (plan.writes.length > 0 && beforeWrite && !(await beforeWrite(plan.writes.length))) {
    const { added, updated, merged, unchanged } = plan
    const total = plan.writes.length
    return {
      added,
      updated,
      merged,
      unchanged,
      invalid,
      failed: 0,
      cancelled: true,
      saved: 0,
      total,
    }
  }
  // Dated forward from now (after any deletion), a few hundred per second. The
  // relay accepts events up to 15 minutes ahead: room for 360,000 places.
  let slot = Math.max(nowSeconds(), lastDeletion + 1) * PER_SECOND
  const nextDate = (previous?: PlaceRecord) => {
    const at = Math.max(Math.floor(slot++ / PER_SECOND), (previous?.createdAt ?? 0) + 1)
    slot = Math.max(slot, at * PER_SECOND)
    return at
  }
  const dated = plan.writes.map((write) => ({ ...write, createdAt: nextDate(write.previous) }))
  // Each place's current event, to replace when a new version is saved.
  const eventIdOf = (inner: InnerPlace) => {
    const d = inner.tags.find((t) => t[0] === 'd')?.[1]
    return d ? records.get(d)?.eventId : undefined
  }

  let done = 0
  let failed = 0
  let saved = 0
  onProgress?.(0, dated.length)
  await runAll(dated, signal, async ({ inner, createdAt }) => {
    let saving = inner
    let event: NostrEvent
    try {
      event = await sealPlace(saving, nostr, pubkey, createdAt)
      await publish(event)
    } catch (error) {
      // A place deleted from this relay can't come back under its address.
      if (!String(error).includes('deleted')) {
        failed++
        return
      }
      saving = withNewId(inner)
      try {
        event = await sealPlace(saving, nostr, pubkey, createdAt)
        await publish(event)
      } catch {
        failed++
        return
      }
    } finally {
      onProgress?.(++done, dated.length)
    }
    remember(event, saving, saving === inner ? eventIdOf(inner) : undefined)
    keep(saving, createdAt, event.id)
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

// Your key (see getNostr) and its public key.
function requireKey(): { nostr: Nostr; pubkey: string } {
  const nostr = getNostr()
  const { pubkey } = getKeyState()
  if (!nostr || !pubkey) throw new Error('Unlock your key first.')
  return { nostr, pubkey }
}

// Sends an event to every relay; done once one takes it. Those that didn't get
// it are sent it on the next load (see syncWithRelays).
async function publish(event: NostrEvent): Promise<void> {
  const relays = getRelays().relays
  try {
    await Promise.any(pool.publish([...relays], event))
  } catch (error) {
    const reason = error instanceof AggregateError ? error.errors[0] : error
    const message = reason instanceof Error ? reason.message : String(reason)
    throw new Error(
      relays.length === 1 ? `The relay refused it: ${message}` : `No relay took it: ${message}`,
    )
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

// Every private place of an author on a relay, a page at a time from the newest back.
async function fetchAll(
  url: string,
  pubkey: string,
  onPage?: (loaded: number) => void,
): Promise<NostrEvent[]> {
  const byId = new Map<string, NostrEvent>()
  let until: number | undefined
  for (;;) {
    const page = await placesPool.querySync([url], {
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

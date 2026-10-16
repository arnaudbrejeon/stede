import { useSyncExternalStore } from 'react'
import { getPublicKey, type NostrEvent } from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'
import { getKeyState, getSecretKey, subscribeKey } from './keystore'
import {
  conversationKey,
  deletionEvent,
  innerPlace,
  openPlace,
  placeFromInner,
  PRIVATE_PLACE_KIND,
  sealPlace,
  type PlaceDraft,
} from './placeEvents'
import { NO_PLACES, type Place, type Places } from './places'

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

export type PlacesStatus = 'idle' | 'loading' | 'ready' | 'error'
export type PlacesState = { status: PlacesStatus; places: Places; error: string | null }

let state: PlacesState = { status: 'idle', places: NO_PLACES, error: null }
const listeners = new Set<() => void>()
const pool = new SimplePool()
// Bumped on every load and lock, so a slow load can't overwrite newer state.
let generation = 0
// created_at of each place's latest version. Relays keep the newest version of
// a place, and on a tie the lower event id, so a quick edit has to be dated later.
const versions = new Map<string, number>()

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
    versions.clear()
    setState({ status: 'idle', places: NO_PLACES, error: null })
  }
}
subscribeKey(onKeyChange)
onKeyChange()

export async function loadPlaces(): Promise<void> {
  const secretKey = requireKey()
  const run = ++generation
  setState({ status: 'loading', error: null })
  try {
    const events = await fetchAll(getPublicKey(secretKey))
    if (run !== generation) return
    setState({ status: 'ready', places: toPlaces(events, conversationKey(secretKey)) })
  } catch (error) {
    if (run !== generation) return
    console.error(error)
    setState({ status: 'error', error: 'Your places could not be loaded from the relay.' })
  }
}

// Saves a new place (no id) or a new version of one; returns the saved place.
export async function savePlace(draft: PlaceDraft): Promise<Place> {
  const secretKey = requireKey()
  const inner = innerPlace({ ...draft, id: draft.id ?? crypto.randomUUID() })
  const place = placeFromInner(inner)
  if (!place) throw new Error('This place is missing its name or position.')
  const id = place.properties.id
  const previous = versions.get(id)
  const createdAt = Math.max(Math.floor(Date.now() / 1000), previous === undefined ? 0 : previous + 1)
  await publish(sealPlace(inner, secretKey, createdAt))
  versions.set(id, createdAt)
  const others = state.places.features.filter((f) => f.properties.id !== id)
  setState({ places: { ...state.places, features: [...others, place] } })
  return place
}

export async function deletePlace(id: string): Promise<void> {
  const secretKey = requireKey()
  const latest = versions.get(id) ?? 0
  await publish(deletionEvent(id, secretKey, Math.max(Math.floor(Date.now() / 1000), latest)))
  versions.delete(id)
  setState({
    places: {
      ...state.places,
      features: state.places.features.filter((f) => f.properties.id !== id),
    },
  })
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
    console.error(reason)
    throw new Error(`The relay refused it: ${reason instanceof Error ? reason.message : reason}`)
  }
}

// Every private place of an author, a page at a time from the newest back.
async function fetchAll(pubkey: string): Promise<NostrEvent[]> {
  const byId = new Map<string, NostrEvent>()
  let until: number | undefined
  for (;;) {
    const page = await pool.querySync([RELAY_URL], {
      kinds: [PRIVATE_PLACE_KIND],
      authors: [pubkey],
      limit: PAGE_SIZE,
      ...(until !== undefined && { until }),
    })
    const fresh = page.filter((e) => !byId.has(e.id))
    for (const event of fresh) byId.set(event.id, event)
    // A page ends on a second it may not have exhausted, so the next page starts
    // on that same second; it's done when a page brings nothing new.
    if (fresh.length === 0 || page.length < PAGE_SIZE) break
    until = Math.min(...page.map((e) => e.created_at))
  }
  return [...byId.values()]
}

// The newest version of each place; events that don't decrypt are skipped.
function toPlaces(events: NostrEvent[], key: Uint8Array): Places {
  const newest = new Map<string, NostrEvent>()
  for (const event of events) {
    const d = event.tags.find((t) => t[0] === 'd')?.[1]
    if (!d) continue
    const seen = newest.get(d)
    if (!seen || event.created_at > seen.created_at) newest.set(d, event)
  }
  const features: Place[] = []
  versions.clear()
  for (const [d, event] of newest) versions.set(d, event.created_at)
  for (const event of newest.values()) {
    try {
      const place = placeFromInner(openPlace(event, key))
      if (place) features.push(place)
      else console.warn('Skipping an invalid place', event.id)
    } catch (error) {
      console.warn('Skipping a place that does not decrypt', event.id, error)
    }
  }
  return { type: 'FeatureCollection', features }
}

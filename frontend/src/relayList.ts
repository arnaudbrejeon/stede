import { useSyncExternalStore } from 'react'
import type { EventTemplate, NostrEvent } from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'
import { normalizeURL } from 'nostr-tools/utils'
import { getKeyState, getNostr, subscribeKey } from './keystore'
import { RELAY_URL } from './relayUrl'

// The relays your places are kept on: a NIP-51 relay set (kind 30002) named
// "stede", so other Nostr apps using your key keep their own relay list
// (NIP-65). Without one, it's the stede relay alone. The stede relay can be
// left out once there's another relay, never leaving none.
//
// The set itself always goes to the stede relay as well as to every relay in
// it, so a new device finds it there; and it's kept in this browser, so the
// places load from the right relays at once, and a set no relay took is sent
// again next time.
//
// The relays you write to in your NIP-65 list, if you have one, are offered to
// add (see loadNostrRelays).

export const RELAY_SET_KIND = 30002
const RELAY_SET_D = 'stede'
export const STEDE_RELAY = normalizeURL(RELAY_URL)
export const RELAY_LIST_KIND = 10002
// Where to look for your NIP-65 list, besides your own relays: relays that keep
// many people's lists. The stede relay doesn't keep them.
const RELAY_LIST_INDEXERS = [
  'wss://purplepag.es/',
  'wss://relay.damus.io/',
  'wss://nos.lol/',
  'wss://relay.primal.net/',
]

export type RelayListState = {
  relays: readonly string[]
  // When the set was saved, in seconds; 0 for the default (no set yet).
  createdAt: number
  // The relays you write to in your NIP-65 list; null until looked for.
  nostrRelays: readonly string[] | null
}

const DEFAULT: RelayListState = { relays: [STEDE_RELAY], createdAt: 0, nostrRelays: null }

let state: RelayListState = DEFAULT
// The set as last signed, kept to send again to relays that don't have it.
let saved: NostrEvent | null = null
// The key whose NIP-65 list was looked for (see loadNostrRelays).
let nostrRelaysFor: string | null = null
const listeners = new Set<() => void>()
const pool = new SimplePool()

function setState(next: Partial<RelayListState>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

export function subscribeRelays(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getRelays(): RelayListState {
  return state
}

export function useRelays(): RelayListState {
  return useSyncExternalStore(subscribeRelays, getRelays)
}

// A relay address as typed: wss:// is added when there's no scheme, and only
// secure relays are taken, but for one on this computer.
export function parseRelay(input: string): string {
  const text = input.trim()
  if (!text) throw new Error('Type a relay address, like wss://relay.example.com.')
  let url: URL
  try {
    url = new URL(normalizeURL(text))
  } catch {
    throw new Error(`“${text}” isn’t a relay address.`)
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && local))
    throw new Error('Relays are reached over wss://.')
  return url.toString()
}

// The relays named in a relay set, in order, without repeats.
export function relaysOf(event: Pick<NostrEvent, 'tags'>): string[] {
  const relays: string[] = []
  for (const [name, value] of event.tags) {
    if (name !== 'relay' || !value) continue
    try {
      const url = normalizeURL(value)
      if (!relays.includes(url)) relays.push(url)
    } catch {
      // Not a URL: skipped.
    }
  }
  return relays
}

export function relaySetTemplate(relays: readonly string[], createdAt: number): EventTemplate {
  return {
    kind: RELAY_SET_KIND,
    created_at: createdAt,
    tags: [['d', RELAY_SET_D], ['title', 'Stede places'], ...relays.map((url) => ['relay', url])],
    content: '',
  }
}

// The relays you write to in a NIP-65 list (marked "write", or not marked):
// those marked "read" only are where others send things to you.
export function writeRelaysOf(event: Pick<NostrEvent, 'tags'>): string[] {
  const relays: string[] = []
  for (const [name, value, marker] of event.tags) {
    if (name !== 'r' || !value || marker === 'read') continue
    try {
      const url = parseRelay(value)
      if (!relays.includes(url)) relays.push(url)
    } catch {
      // Not a secure relay address: skipped.
    }
  }
  return relays
}

// The list with a relay added, at the end.
export function withRelay(relays: readonly string[], url: string): string[] {
  return relays.includes(url) ? [...relays] : [...relays, url]
}

// The list without a relay. Leaving none brings back the stede relay.
export function withoutRelay(relays: readonly string[], url: string): string[] {
  const rest = relays.filter((r) => r !== url)
  return rest.length > 0 ? rest : [STEDE_RELAY]
}

// The list with the stede relay in or out. It stays in when it's the only one.
export function withStede(relays: readonly string[], on: boolean): string[] {
  if (on) return relays.includes(STEDE_RELAY) ? [...relays] : [STEDE_RELAY, ...relays]
  return relays.some((r) => r !== STEDE_RELAY) ? relays.filter((r) => r !== STEDE_RELAY) : [...relays]
}

// Saves the list: signs a new relay set and sends it to the stede relay and to
// every relay in the list (old and new). Fails when none takes it.
export async function saveRelays(relays: readonly string[]): Promise<void> {
  const nostr = getNostr()
  const { pubkey } = getKeyState()
  if (!nostr || !pubkey) throw new Error('Unlock your key first.')
  if (relays.length === 0) throw new Error('Keep at least one relay.')
  const createdAt = Math.max(Math.floor(Date.now() / 1000), state.createdAt + 1)
  const event = await nostr.signEvent(relaySetTemplate(relays, createdAt))
  try {
    await Promise.any(pool.publish(targets(event, state.relays), event))
  } catch (error) {
    const reason = error instanceof AggregateError ? error.errors[0] : error
    throw new Error(`No relay took the list: ${reason instanceof Error ? reason.message : reason}`)
  }
  adopt(pubkey, event)
}

// Where a relay set goes: the stede relay, the relays in it, and `also`.
function targets(event: NostrEvent, also: readonly string[] = []): string[] {
  return [...new Set([STEDE_RELAY, ...relaysOf(event), ...also])]
}

function adopt(pubkey: string, event: NostrEvent) {
  saved = event
  try {
    localStorage.setItem(storageKey(pubkey), JSON.stringify(event))
  } catch {
    // Kept for this visit only.
  }
  const relays = relaysOf(event)
  setState({ relays: relays.length > 0 ? relays : [STEDE_RELAY], createdAt: event.created_at })
}

const storageKey = (pubkey: string) => `stede.relays.${pubkey}`

function stored(pubkey: string): NostrEvent | null {
  try {
    const event = JSON.parse(localStorage.getItem(storageKey(pubkey)) ?? 'null') as NostrEvent | null
    return event?.kind === RELAY_SET_KIND && event.pubkey === pubkey ? event : null
  } catch {
    return null
  }
}

// Follows the key: the list kept here at once, then the newest one on the relays.
let loadedFor: string | null = null
function onKeyChange() {
  const { pubkey } = getKeyState()
  if (pubkey === loadedFor) return
  loadedFor = pubkey
  saved = null
  nostrRelaysFor = null
  if (!pubkey) return setState(DEFAULT)
  setState({ nostrRelays: null })
  const here = stored(pubkey)
  if (here) adopt(pubkey, here)
  else setState(DEFAULT)
  void fetchRelays(pubkey)
}
subscribeKey(onKeyChange)
onKeyChange()

async function fetchRelays(pubkey: string) {
  const events = await pool
    .querySync(
      targets(saved ?? (relaySetTemplate(state.relays, 0) as NostrEvent)),
      { kinds: [RELAY_SET_KIND], authors: [pubkey], '#d': [RELAY_SET_D] },
      { maxWait: 5000 },
    )
    .catch(() => [])
  if (getKeyState().pubkey !== pubkey) return
  const newest = events.reduce<NostrEvent | null>(
    (best, e) => (!best || e.created_at > best.created_at ? e : best),
    null,
  )
  if (newest && newest.created_at > state.createdAt) adopt(pubkey, newest)
  // A set saved here that the relays don't have yet (none took it, or they've
  // lost it): sent again.
  else if (saved && (!newest || newest.created_at < saved.created_at)) {
    const event = saved
    void Promise.allSettled(pool.publish(targets(event), event))
  }
}

// Looks for your NIP-65 list, once per key: asked when the relay settings show,
// as it tells the relays it's asked of who you are.
export async function loadNostrRelays(): Promise<void> {
  const { pubkey } = getKeyState()
  if (!pubkey || nostrRelaysFor === pubkey) return
  nostrRelaysFor = pubkey
  const events = await pool
    .querySync(
      [...new Set([...RELAY_LIST_INDEXERS, ...state.relays])],
      { kinds: [RELAY_LIST_KIND], authors: [pubkey] },
      { maxWait: 5000 },
    )
    .catch(() => [])
  if (getKeyState().pubkey !== pubkey) return
  const newest = events.reduce<NostrEvent | null>(
    (best, e) => (!best || e.created_at > best.created_at ? e : best),
    null,
  )
  setState({ nostrRelays: newest ? writeRelaysOf(newest).filter((url) => url !== STEDE_RELAY) : [] })
}

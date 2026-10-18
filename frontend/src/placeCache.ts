import type { InnerPlace } from './placeEvents'
import type { Nostr } from './signer'

// Your places as last seen, kept in this browser so a visit shows them at once
// and only asks the relay for what changed (see negentropy.ts).
//
// They're kept decrypted, but encrypted as a whole with AES-GCM under a random
// cache key, and that key is itself NIP-44 encrypted to you. Reading the cache
// takes one NIP-44 decryption (one request to an extension) instead of one per
// place; the rest is the browser's own crypto, fast even on a phone. Without
// your key, or your extension unlocked, the cache can't be read. Without
// IndexedDB or WebCrypto (some private windows), nothing is kept and each visit
// loads everything.

// One place event: what negentropy needs (id, date), its address (d), and its
// decrypted content (null: it doesn't decrypt to a valid place).
export type CachedPlace = { id: string; created_at: number; d: string; inner: InnerPlace | null }

type CacheRecord = {
  pubkey: string
  version: 1
  // The cache key (base64), NIP-44 encrypted to the pubkey.
  key: string
  iv: Uint8Array<ArrayBuffer>
  // The places as JSON, AES-GCM encrypted under the cache key.
  data: ArrayBuffer
}

const DB_NAME = 'stede-places'
const STORE = 'caches'

// The cache key while your key is unlocked, so saving doesn't ask the extension again.
let unlocked: { pubkey: string; key: CryptoKey; sealed: string } | null = null

let opening: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'pubkey' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).catch((error) => {
    opening = null
    throw error
  })
  return opening
}

function asPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
// Ties the encrypted places to their owner: a record moved to another pubkey won't decrypt.
const owner = (pubkey: string) => new TextEncoder().encode(`stede-places:${pubkey}`)

function importKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

// Your cached places; none when there's no cache or it can't be read.
export async function readCache(pubkey: string, nostr: Nostr): Promise<CachedPlace[]> {
  try {
    const store = (await db()).transaction(STORE).objectStore(STORE)
    const record = (await asPromise(store.get(pubkey))) as CacheRecord | undefined
    if (!record || record.version !== 1) return []
    const key = await importKey(fromBase64(await nostr.nip44.decrypt(pubkey, record.key)))
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv, additionalData: owner(pubkey) },
      key,
      record.data,
    )
    unlocked = { pubkey, key, sealed: record.key }
    return JSON.parse(new TextDecoder().decode(plain))
  } catch (error) {
    console.warn('The place cache could not be read', error)
    return []
  }
}

// Replaces your cached places. A failure only costs a fuller load next time.
export async function writeCache(pubkey: string, nostr: Nostr, places: readonly CachedPlace[]) {
  try {
    if (unlocked?.pubkey !== pubkey) {
      const raw = crypto.getRandomValues(new Uint8Array(32))
      const sealed = await nostr.nip44.encrypt(pubkey, toBase64(raw))
      unlocked = { pubkey, key: await importKey(raw), sealed }
    }
    const { key, sealed } = unlocked
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const data = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: owner(pubkey) },
      key,
      new TextEncoder().encode(JSON.stringify(places)),
    )
    const record: CacheRecord = { pubkey, version: 1, key: sealed, iv, data }
    const transaction = (await db()).transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put(record)
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = transaction.onabort = () => reject(transaction.error)
    })
  } catch (error) {
    console.warn('The place cache could not be saved', error)
  }
}

// Forgets the cache key held in memory (when your key locks).
export function lockCache() {
  unlocked = null
}

// Deletes your cache (when your key is removed from this browser).
export async function clearCache(pubkey: string) {
  if (unlocked?.pubkey === pubkey) unlocked = null
  try {
    const transaction = (await db()).transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).delete(pubkey)
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = transaction.onabort = () => reject(transaction.error)
    })
  } catch (error) {
    console.warn('The place cache could not be cleared', error)
  }
}

// The cache of encrypted events this replaced, if a browser still has it.
try {
  indexedDB.deleteDatabase('stede-events')
} catch {
  // No IndexedDB: nothing to remove.
}

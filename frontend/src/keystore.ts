import { useSyncExternalStore } from 'react'
import { getPublicKey } from 'nostr-tools'
import * as nip19 from 'nostr-tools/nip19'
import * as nip49 from 'nostr-tools/nip49'
import { asNostr, findExtension, localNostr, type Nostr } from './signer'

// The user's Nostr key, kept in this browser.
//
// localStorage holds only the NIP-49 encryption of the key (ncryptsec) and its
// public key, so a copy of the browser's storage needs the password to be any use.
// The password unlocks the key once per browser session: the unlocked key is
// kept in memory, and, so a reload or a new tab doesn't ask again, also in
// sessionStorage wrapped with a non-extractable AES key from IndexedDB. Locking
// deletes that AES key, which makes every tab's wrapped copy useless. Tabs
// opened later ask the open ones for their wrapped copy over a BroadcastChannel.
//
// localStorage is only readable by this origin, but anything running on it
// can read the unlocked key, so the app must not load untrusted scripts.
//
// Or the key stays in a NIP-07 browser extension (nos2x, Alby…): the app only
// remembers which public key it used, and asks the extension each time.

// scrypt cost of the NIP-49 encryption: 2^17 rounds, 128 MiB, a fraction of a
// second on a laptop and still bearable on a phone, once per browser session.
const SCRYPT_LOG_N = 17

const STORED = 'stede.key' // localStorage: {pubkey, ncryptsec}
const EXTENSION = 'stede.extension' // localStorage: the extension's pubkey
const SESSION = 'stede.session' // sessionStorage: the key wrapped with the session key
const DB_NAME = 'stede-keystore'
const DB_STORE = 'keys'
const SESSION_KEY_ID = 'session'
const CHANNEL = 'stede-keystore'
// How long a new tab waits for an unlocked tab to share the key.
const SHARE_TIMEOUT_MS = 300

export type KeyStatus = 'loading' | 'none' | 'locked' | 'unlocked'
// Where the key is: in this browser, encrypted with a password, or in an extension.
export type KeyKind = 'local' | 'extension'
export type KeyState = { status: KeyStatus; pubkey: string | null; kind: KeyKind | null }

const NO_KEY: KeyState = { status: 'none', pubkey: null, kind: null }

type Stored = { pubkey: string; ncryptsec: string }
type Message = { type: 'request' } | { type: 'share'; wrapped: string } | { type: 'lock' }

let state: KeyState = { status: 'loading', pubkey: null, kind: null }
let secretKey: Uint8Array | null = null
let nostr: Nostr | null = null
// This tab's wrapped copy, shared with tabs opened later.
let wrappedKey: string | null = null
const listeners = new Set<() => void>()
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL)

function setState(next: KeyState) {
  state = next
  for (const listener of listeners) listener()
}

export function getKeyState(): KeyState {
  return state
}

export function subscribeKey(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useKey(): KeyState {
  return useSyncExternalStore(subscribeKey, getKeyState)
}

// Your key behind the NIP-07 extension API, wherever it is: the extension
// itself, or the key kept here wrapped in the same API. Null when locked.
export function getNostr(): Nostr | null {
  return nostr
}

// Reads the stored key and resumes this browser session's unlock if there is
// one, or reconnects to the extension used last time.
export async function initKey(): Promise<KeyState> {
  const extensionPubkey = readExtension()
  if (extensionPubkey) {
    await reconnectExtension(extensionPubkey)
    return state
  }
  const stored = readStored()
  if (!stored) {
    setState(NO_KEY)
    return state
  }
  const wrapped = sessionStorage.getItem(SESSION) ?? (await askOtherTabs())
  const key = wrapped ? await unwrap(wrapped) : null
  if (key && getPublicKey(key) === stored.pubkey) {
    sessionStorage.setItem(SESSION, wrapped!)
    secretKey = key
    nostr = localNostr(key)
    wrappedKey = wrapped
    setState({ status: 'unlocked', pubkey: stored.pubkey, kind: 'local' })
  } else {
    sessionStorage.removeItem(SESSION)
    setState({ status: 'locked', pubkey: stored.pubkey, kind: 'local' })
  }
  return state
}

// Uses a NIP-07 extension's key instead of one kept here.
export async function connectExtension(): Promise<void> {
  const extension = await findExtension(0)
  if (!extension) throw new Error('No Nostr extension found in this browser.')
  const usable = asNostr(extension)
  const pubkey = await usable.getPublicKey()
  nostr = usable
  localStorage.setItem(EXTENSION, pubkey)
  setState({ status: 'unlocked', pubkey, kind: 'extension' })
}

// Stops using the extension; a key kept here (if any) is offered again.
export function disconnectExtension(): void {
  localStorage.removeItem(EXTENSION)
  nostr = null
  const stored = readStored()
  setState(stored ? { status: 'locked', pubkey: stored.pubkey, kind: 'local' } : NO_KEY)
}

async function reconnectExtension(pubkey: string) {
  const extension = await findExtension()
  try {
    if (!extension) throw new Error('No Nostr extension found')
    const usable = asNostr(extension)
    // The extension may have switched accounts since: use the one it has now.
    const current = await usable.getPublicKey()
    nostr = usable
    localStorage.setItem(EXTENSION, current)
    setState({ status: 'unlocked', pubkey: current, kind: 'extension' })
  } catch (error) {
    console.warn('Nostr extension unavailable', error)
    nostr = null
    setState({ status: 'locked', pubkey, kind: 'extension' })
  }
}

function readExtension(): string | null {
  try {
    return localStorage.getItem(EXTENSION)
  } catch {
    return null
  }
}

// Stores the user's own key (nsec, or 64 hex characters) encrypted with a new password.
export async function importKey(nsec: string, password: string): Promise<void> {
  const key = parseSecretKey(nsec)
  checkPassword(password)
  const stored: Stored = {
    pubkey: getPublicKey(key),
    ncryptsec: nip49.encrypt(key, password, SCRYPT_LOG_N),
  }
  localStorage.setItem(STORED, JSON.stringify(stored))
  await startSession(key, stored.pubkey)
}

export async function unlock(password: string): Promise<void> {
  const stored = readStored()
  if (!stored) throw new Error('No key is stored in this browser.')
  let key: Uint8Array
  try {
    key = nip49.decrypt(stored.ncryptsec, password)
  } catch {
    throw new Error('Wrong password.')
  }
  if (getPublicKey(key) !== stored.pubkey) throw new Error('Wrong password.')
  await startSession(key, stored.pubkey)
}

// Locks every tab; the password is needed again.
export async function lock(): Promise<void> {
  await deleteSessionKey()
  channel?.postMessage({ type: 'lock' } satisfies Message)
  dropSession()
}

// Removes the key from this browser. The user needs their nsec to add it again.
export async function forgetKey(): Promise<void> {
  await lock()
  localStorage.removeItem(STORED)
  setState(NO_KEY)
}

export function parseSecretKey(value: string): Uint8Array {
  const text = value.trim()
  if (/^[0-9a-f]{64}$/i.test(text)) return hexToBytes(text)
  try {
    const decoded = nip19.decode(text)
    if (decoded.type === 'nsec') return decoded.data
  } catch {
    // reported below
  }
  throw new Error('This is not a Nostr secret key (it starts with nsec1).')
}

export function checkPassword(password: string): void {
  // No minimum length yet; an empty password would leave the key unprotected.
  if (password === '') throw new Error('Choose a password.')
}

function readStored(): Stored | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORED) ?? 'null')
    return typeof value?.pubkey === 'string' && typeof value?.ncryptsec === 'string' ? value : null
  } catch {
    return null
  }
}

async function startSession(key: Uint8Array, pubkey: string) {
  const sessionKey = (await loadSessionKey()) ?? (await createSessionKey())
  wrappedKey = await wrap(key, sessionKey)
  sessionStorage.setItem(SESSION, wrappedKey)
  secretKey = key
  nostr = localNostr(key)
  setState({ status: 'unlocked', pubkey, kind: 'local' })
}

function dropSession() {
  sessionStorage.removeItem(SESSION)
  // The extension isn't locked by this; only a key kept here is.
  if (state.kind === 'extension') return
  secretKey?.fill(0)
  secretKey = null
  nostr = null
  wrappedKey = null
  const stored = readStored()
  setState(stored ? { status: 'locked', pubkey: stored.pubkey, kind: 'local' } : NO_KEY)
}

channel?.addEventListener('message', (event: MessageEvent<Message>) => {
  const message = event.data
  if (message.type === 'request') {
    if (wrappedKey) channel.postMessage({ type: 'share', wrapped: wrappedKey } satisfies Message)
  } else if (message.type === 'lock') {
    dropSession()
  }
})

function askOtherTabs(): Promise<string | null> {
  const ch = channel
  if (!ch) return Promise.resolve(null)
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent<Message>) => {
      if (event.data.type !== 'share') return
      done(event.data.wrapped)
    }
    const timer = setTimeout(() => done(null), SHARE_TIMEOUT_MS)
    function done(wrapped: string | null) {
      clearTimeout(timer)
      ch!.removeEventListener('message', onMessage)
      resolve(wrapped)
    }
    ch.addEventListener('message', onMessage)
    ch.postMessage({ type: 'request' } satisfies Message)
  })
}

// The wrapped key is base64(12-byte IV + AES-GCM ciphertext).
async function wrap(key: Uint8Array, sessionKey: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sessionKey, key as BufferSource),
  )
  const out = new Uint8Array(iv.length + sealed.length)
  out.set(iv)
  out.set(sealed, iv.length)
  return btoa(String.fromCharCode(...out))
}

async function unwrap(wrapped: string): Promise<Uint8Array | null> {
  const sessionKey = await loadSessionKey()
  if (!sessionKey) return null
  try {
    const data = Uint8Array.from(atob(wrapped), (c) => c.charCodeAt(0))
    const key = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: data.slice(0, 12) },
      sessionKey,
      data.slice(12),
    )
    return new Uint8Array(key)
  } catch {
    return null
  }
}

async function createSessionKey(): Promise<CryptoKey> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  await dbRequest('readwrite', (store) => store.put(key, SESSION_KEY_ID))
  return key
}

async function loadSessionKey(): Promise<CryptoKey | null> {
  const key = await dbRequest<CryptoKey | undefined>('readonly', (store) =>
    store.get(SESSION_KEY_ID),
  )
  return key ?? null
}

async function deleteSessionKey(): Promise<void> {
  await dbRequest('readwrite', (store) => store.delete(SESSION_KEY_ID))
}

function dbRequest<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(DB_STORE)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction(DB_STORE, mode)
      const request = run(tx.objectStore(DB_STORE))
      tx.oncomplete = () => {
        db.close()
        resolve(request.result as T)
      }
      tx.onerror = () => {
        db.close()
        reject(tx.error)
      }
    }
  })
}

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16))
}

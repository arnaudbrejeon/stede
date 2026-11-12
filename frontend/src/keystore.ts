import { useSyncExternalStore } from 'react'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { BunkerSigner, parseBunkerInput, type BunkerPointer } from 'nostr-tools/nip46'
import * as nip19 from 'nostr-tools/nip19'
import * as nip49 from 'nostr-tools/nip49'
import {
  createPasskey,
  forgetPasskey,
  unlockingKey,
  type PasskeyRecord,
} from './passkey'
import { asNostr, findExtension, localNostr, remoteNostr, signerAnswer, type Nostr } from './signer'

// The user's Nostr key, kept in this browser.
//
// localStorage holds only the key encrypted, and its public key, so a copy of
// the browser's storage is no use without Face ID (or Touch ID, a fingerprint…)
// or the password. A passkey wraps one copy with a secret only it gives back
// (passkey.ts); a password encrypts another with NIP-49 (ncryptsec). Either or
// both: the passkey first where the browser can make one, the password as a
// backup, or instead. Without either, only the nsec brings the key back.
//
// Unlocking happens once per browser session: the unlocked key is
// kept in memory, and, so a reload or a new tab doesn't ask again, also in
// sessionStorage wrapped with a non-extractable AES key from IndexedDB. Locking
// deletes that AES key, which makes every tab's wrapped copy useless. Tabs
// opened later ask the open ones for their wrapped copy over a BroadcastChannel.
//
// Phones close an app they aren't showing, which ends its browser session:
// there the passkey spares typing a password over and over. Or the installed
// app can stay unlocked: its wrapped copy then goes in localStorage instead,
// still useless without the AES key, until Lock deletes that key or the app
// isn't opened for STAY_UNLOCKED_DAYS.
//
// localStorage is only readable by this origin, but anything running on it
// can read the unlocked key, so the app must not load untrusted scripts.
//
// Or the key stays in a NIP-07 browser extension (nos2x, Alby…): the app only
// remembers which public key it used, and asks the extension each time.
//
// Or in a remote signer (NIP-46: Amber, nak bunker…), paired by pasting its
// bunker:// link. The app remembers the signer and the key it made to talk to
// it, and sends it each request over the signer's relays. That client key
// can't sign as you, but the signer answers what it asks, within what it was
// allowed when paired: anything running on this origin could ask too, like an
// extension's.

// scrypt cost of the NIP-49 encryption: 2^17 rounds, 128 MiB, a fraction of a
// second on a laptop and still bearable on a phone, once per browser session.
const SCRYPT_LOG_N = 17

const STORED = 'stede.key' // localStorage: {pubkey, ncryptsec?, passkey?}, at least one
const EXTENSION = 'stede.extension' // localStorage: the extension's pubkey
const REMOTE = 'stede.remote' // localStorage: {pubkey, clientKey, bunker}, the remote signer
// How long reconnecting to a remote signer at start waits for it.
const REMOTE_RECONNECT_MS = 15_000
const SESSION = 'stede.session' // sessionStorage: the key wrapped with the session key
const KEPT = 'stede.kept' // localStorage: {wrapped, lastUsed}, the same, staying unlocked
const STAY_UNLOCKED_DAYS = 30
const DB_NAME = 'stede-keystore'
const DB_STORE = 'keys'
const SESSION_KEY_ID = 'session'
const CHANNEL = 'stede-keystore'
// How long a new tab waits for an unlocked tab to share the key.
const SHARE_TIMEOUT_MS = 300

export type KeyStatus = 'loading' | 'none' | 'locked' | 'unlocked'
// Where the key is: in this browser, encrypted with a password, in an
// extension, or in a remote signer.
export type KeyKind = 'local' | 'extension' | 'remote'
// `passkey`, `password`: what unlocks the key kept here.
export type KeyState = {
  status: KeyStatus
  pubkey: string | null
  kind: KeyKind | null
  passkey: boolean
  password: boolean
}

const NO_KEY: KeyState = {
  status: 'none',
  pubkey: null,
  kind: null,
  passkey: false,
  password: false,
}

type Stored = { pubkey: string; ncryptsec?: string; passkey?: PasskeyRecord }
type Kept = { wrapped: string; lastUsed: number }
// The remote signer paired: whose key, the client key (hex) and the bunker,
// its one-time secret dropped once used.
type Remote = { pubkey: string; clientKey: string; bunker: BunkerPointer }
// `stayUnlocked`: past this browser session, on this device (see KEPT).
export type UnlockOptions = { stayUnlocked?: boolean }
type Message = { type: 'request' } | { type: 'share'; wrapped: string } | { type: 'lock' }

let state: KeyState = { ...NO_KEY, status: 'loading' }
let secretKey: Uint8Array | null = null
let nostr: Nostr | null = null
// The connection to the remote signer, when that's where the key is.
let remoteSigner: BunkerSigner | null = null
// This tab's wrapped copy, shared with tabs opened later.
let wrappedKey: string | null = null
// This tab's unlock is kept past the browser session (KEPT).
let staying = false
// The passkey prompt being shown, so a second ask waits for it instead.
let passkeyUnlock: Promise<void> | null = null
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
// one, or reconnects to the extension or remote signer used last time.
export async function initKey(): Promise<KeyState> {
  const extensionPubkey = readExtension()
  if (extensionPubkey) {
    await reconnectExtension(extensionPubkey)
    return state
  }
  if (readRemote()) {
    await reconnectRemote()
    return state
  }
  const stored = readStored()
  if (!stored) {
    setState(NO_KEY)
    return state
  }
  const wrapped =
    sessionStorage.getItem(SESSION) ?? readKept()?.wrapped ?? (await askOtherTabs())
  const sessionKey = wrapped ? await loadSessionKey() : null
  const key = sessionKey ? await unwrap(wrapped!, sessionKey) : null
  if (key && getPublicKey(key) === stored.pubkey) {
    sessionStorage.setItem(SESSION, wrapped!)
    secretKey = key
    nostr = localNostr(key)
    wrappedKey = wrapped
    staying = readKept()?.wrapped === wrapped
    touchKept()
    setState(localState('unlocked', stored))
  } else {
    sessionStorage.removeItem(SESSION)
    localStorage.removeItem(KEPT)
    setState(localState('locked', stored))
  }
  return state
}

// Whether the key stays unlocked past this browser session.
export function staysUnlocked(): boolean {
  return state.status === 'unlocked' && staying
}

// At start, a locked key with a passkey asks for it straight away, so opening
// the app is one glance at Face ID. Some browsers (Safari) only show the prompt
// after a tap: then it stays locked, and the unlock panel offers the passkey.
export async function unlockAtStart(): Promise<void> {
  if (state.status !== 'locked' || !state.passkey) return
  try {
    await unlockWithPasskey()
  } catch (error) {
    console.info('Passkey unlock at start didn’t happen', error)
  }
}

// Uses a NIP-07 extension's key instead of one kept here.
export async function connectExtension(): Promise<void> {
  const extension = await findExtension(0)
  if (!extension) throw new Error('No Nostr extension found in this browser.')
  const usable = asNostr(extension)
  const pubkey = await usable.getPublicKey()
  nostr = usable
  localStorage.setItem(EXTENSION, pubkey)
  setState({ ...NO_KEY, status: 'unlocked', pubkey, kind: 'extension' })
}

// Stops using the extension; a key kept here (if any) is offered again.
export function disconnectExtension(): void {
  localStorage.removeItem(EXTENSION)
  nostr = null
  const stored = readStored()
  setState(stored ? localState('locked', stored) : NO_KEY)
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
    setState({ ...NO_KEY, status: 'unlocked', pubkey: current, kind: 'extension' })
  } catch (error) {
    console.warn('Nostr extension unavailable', error)
    nostr = null
    setState({ ...NO_KEY, status: 'locked', pubkey, kind: 'extension' })
  }
}

function readExtension(): string | null {
  try {
    return localStorage.getItem(EXTENSION)
  } catch {
    return null
  }
}

// Pairs with a remote signer from its bunker:// link (or NIP-05 name), with a
// new client key. The signer may ask its owner to approve first.
export async function connectRemote(input: string): Promise<void> {
  const bunker = await parseBunkerInput(input.trim())
  if (!bunker) throw new Error('This is not a bunker:// link.')
  const clientKey = generateSecretKey()
  const signer = BunkerSigner.fromBunker(clientKey, bunker)
  try {
    await signerAnswer(signer.connect({ name: 'Stede', url: location.origin }))
    const usable = remoteNostr(signer)
    const pubkey = await usable.getPublicKey()
    writeRemote({ pubkey, clientKey: bytesToHex(clientKey), bunker: { ...bunker, secret: null } })
    startRemote(signer, usable, pubkey)
  } catch (error) {
    void signer.close()
    throw error
  }
}

// Asks the remote signer paired last time, as at start.
export async function reconnectRemote(): Promise<void> {
  const remote = readRemote()
  if (!remote) return
  void remoteSigner?.close()
  remoteSigner = null
  const signer = BunkerSigner.fromBunker(hexToBytes(remote.clientKey), remote.bunker)
  try {
    const usable = remoteNostr(signer, REMOTE_RECONNECT_MS)
    // The signer may have switched accounts since: use the one it has now.
    const pubkey = await usable.getPublicKey()
    if (pubkey !== remote.pubkey) writeRemote({ ...remote, pubkey })
    startRemote(signer, remoteNostr(signer), pubkey)
  } catch (error) {
    console.warn('Remote signer unavailable', error)
    void signer.close()
    nostr = null
    setState({ ...NO_KEY, status: 'locked', pubkey: remote.pubkey, kind: 'remote' })
  }
}

// Stops using the remote signer; a key kept here (if any) is offered again.
// The signer keeps the pairing until its owner removes it there.
export function disconnectRemote(): void {
  localStorage.removeItem(REMOTE)
  void remoteSigner?.close()
  remoteSigner = null
  nostr = null
  const stored = readStored()
  setState(stored ? localState('locked', stored) : NO_KEY)
}

function startRemote(signer: BunkerSigner, usable: Nostr, pubkey: string) {
  remoteSigner = signer
  nostr = usable
  setState({ ...NO_KEY, status: 'unlocked', pubkey, kind: 'remote' })
}

function readRemote(): Remote | null {
  try {
    const value = JSON.parse(localStorage.getItem(REMOTE) ?? 'null')
    const valid =
      typeof value?.pubkey === 'string' &&
      typeof value?.clientKey === 'string' &&
      Array.isArray(value?.bunker?.relays)
    return valid ? value : null
  } catch {
    return null
  }
}

function writeRemote(remote: Remote) {
  localStorage.setItem(REMOTE, JSON.stringify(remote))
}

// Stores the user's own key (nsec, or 64 hex characters) encrypted with a new password.
export async function importKey(
  nsec: string,
  password: string,
  options: UnlockOptions = {},
): Promise<void> {
  const key = parseSecretKey(nsec)
  checkPassword(password)
  const stored: Stored = {
    pubkey: getPublicKey(key),
    ncryptsec: nip49.encrypt(key, password, SCRYPT_LOG_N),
  }
  writeStored(stored)
  await startSession(key, stored, options)
}

// Stores the user's own key (nsec, or 64 hex characters) unlocked by a new
// passkey: Face ID, Touch ID or a fingerprint, no password.
export async function importKeyWithPasskey(nsec: string): Promise<void> {
  const key = parseSecretKey(nsec)
  const pubkey = getPublicKey(key)
  const { wrappingKey, ...passkey } = await createPasskey(pubkey)
  const stored: Stored = { pubkey, passkey: { ...passkey, wrapped: await wrap(key, wrappingKey) } }
  writeStored(stored)
  await startSession(key, stored)
}

export async function unlock(password: string, options: UnlockOptions = {}): Promise<void> {
  const stored = readStored()
  if (!stored) throw new Error('No key is stored in this browser.')
  if (!stored.ncryptsec) throw new Error('No password unlocks this key.')
  let key: Uint8Array
  try {
    key = nip49.decrypt(stored.ncryptsec, password)
  } catch {
    throw new Error('Wrong password.')
  }
  if (getPublicKey(key) !== stored.pubkey) throw new Error('Wrong password.')
  await startSession(key, stored, options)
}

export function unlockWithPasskey(): Promise<void> {
  passkeyUnlock ??= (async () => {
    const stored = readStored()
    if (!stored?.passkey) throw new Error('No passkey unlocks this key.')
    const unwrapped = await unwrap(stored.passkey.wrapped, await unlockingKey(stored.passkey))
    if (!unwrapped || getPublicKey(unwrapped) !== stored.pubkey)
      throw new Error('This passkey doesn’t unlock your key. Use your password.')
    await startSession(unwrapped, stored)
  })().finally(() => (passkeyUnlock = null))
  return passkeyUnlock
}

// Makes a passkey that unlocks the key from now on; the key must be unlocked.
export async function addPasskey(): Promise<void> {
  const stored = readStored()
  if (!stored || !secretKey) throw new Error('Unlock your key first.')
  const { wrappingKey, ...passkey } = await createPasskey(stored.pubkey)
  const wrapped = await wrap(secretKey, wrappingKey)
  if (stored.passkey && stored.passkey.credentialId !== passkey.credentialId)
    forgetPasskey(stored.passkey.credentialId)
  const next = { ...stored, passkey: { ...passkey, wrapped } }
  writeStored(next)
  setState(localState(state.status, next))
}

// A password that unlocks the key too, as a backup for the passkey; the key
// must be unlocked.
export async function addPassword(password: string): Promise<void> {
  checkPassword(password)
  const stored = readStored()
  if (!stored || !secretKey) throw new Error('Unlock your key first.')
  const next = { ...stored, ncryptsec: nip49.encrypt(secretKey, password, SCRYPT_LOG_N) }
  writeStored(next)
  setState(localState(state.status, next))
}

// Back to the password only. The passkey stays in the password manager, which
// may offer to delete it.
export function removePasskey(): void {
  const stored = readStored()
  if (!stored?.passkey) return
  if (!stored.ncryptsec) throw new Error('Add a password first: nothing else would unlock your key.')
  forgetPasskey(stored.passkey.credentialId)
  const rest: Stored = { ...stored }
  delete rest.passkey
  writeStored(rest)
  setState(localState(state.status, rest))
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
  const passkey = readStored()?.passkey
  if (passkey) forgetPasskey(passkey.credentialId)
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
    const unlockable = typeof value?.ncryptsec === 'string' || typeof value?.passkey === 'object'
    return typeof value?.pubkey === 'string' && unlockable ? value : null
  } catch {
    return null
  }
}

function writeStored(stored: Stored) {
  localStorage.setItem(STORED, JSON.stringify(stored))
}

function localState(status: KeyStatus, stored: Stored): KeyState {
  return {
    status,
    pubkey: stored.pubkey,
    kind: 'local',
    passkey: !!stored.passkey,
    password: !!stored.ncryptsec,
  }
}

async function startSession(key: Uint8Array, stored: Stored, options: UnlockOptions = {}) {
  const sessionKey = (await loadSessionKey()) ?? (await createSessionKey())
  wrappedKey = await wrap(key, sessionKey)
  sessionStorage.setItem(SESSION, wrappedKey)
  staying = !!options.stayUnlocked
  if (staying) writeKept({ wrapped: wrappedKey, lastUsed: Date.now() })
  else localStorage.removeItem(KEPT)
  secretKey = key
  nostr = localNostr(key)
  setState(localState('unlocked', stored))
}

function dropSession() {
  sessionStorage.removeItem(SESSION)
  localStorage.removeItem(KEPT)
  staying = false
  // An extension or remote signer isn't locked by this; only a key kept here is.
  if (state.kind !== 'local') return
  secretKey?.fill(0)
  secretKey = null
  nostr = null
  wrappedKey = null
  const stored = readStored()
  setState(stored ? localState('locked', stored) : NO_KEY)
}

// The kept copy, unless the app hasn't been opened for STAY_UNLOCKED_DAYS:
// then it's dropped, and the key asks to be unlocked again.
function readKept(): Kept | null {
  try {
    const kept = JSON.parse(localStorage.getItem(KEPT) ?? 'null')
    if (typeof kept?.wrapped !== 'string' || typeof kept?.lastUsed !== 'number') return null
    if (Date.now() - kept.lastUsed > STAY_UNLOCKED_DAYS * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(KEPT)
      return null
    }
    return kept
  } catch {
    return null
  }
}

function writeKept(kept: Kept) {
  localStorage.setItem(KEPT, JSON.stringify(kept))
}

// Opening the app counts as using it, also when it comes back from the
// background without starting again.
function touchKept() {
  const kept = readKept()
  if (kept) writeKept({ ...kept, lastUsed: Date.now() })
}

// Back from the background: still within STAY_UNLOCKED_DAYS, or locked.
export function resumeKept(): void {
  if (!staying || state.status !== 'unlocked') return
  if (readKept()) touchKept()
  else void lock()
}

if (typeof document !== 'undefined')
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resumeKept()
  })

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

// The wrapped key is base64(12-byte IV + AES-GCM ciphertext), wrapped with the
// session key or the passkey's.
async function wrap(key: Uint8Array, wrappingKey: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, key as BufferSource),
  )
  const out = new Uint8Array(iv.length + sealed.length)
  out.set(iv)
  out.set(sealed, iv.length)
  return btoa(String.fromCharCode(...out))
}

async function unwrap(wrapped: string, wrappingKey: CryptoKey): Promise<Uint8Array | null> {
  try {
    const data = Uint8Array.from(atob(wrapped), (c) => c.charCodeAt(0))
    const key = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: data.slice(0, 12) },
      wrappingKey,
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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

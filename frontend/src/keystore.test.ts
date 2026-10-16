import 'fake-indexeddb/auto'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import * as nip19 from 'nostr-tools/nip19'
import { bytesToHex } from 'nostr-tools/utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Each "tab" is a fresh copy of the module with its own sessionStorage; tabs share
// localStorage, IndexedDB and the BroadcastChannel, as in a browser.
class MemoryStorage {
  private items = new Map<string, string>()
  getItem(key: string) {
    return this.items.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value))
  }
  removeItem(key: string) {
    this.items.delete(key)
  }
}

const tabs: { storage: MemoryStorage; keystore: typeof import('./keystore') }[] = []

async function openTab() {
  const storage = new MemoryStorage()
  vi.stubGlobal('sessionStorage', storage)
  vi.resetModules()
  const keystore = await import('./keystore')
  tabs.push({ storage, keystore })
  return { storage, keystore }
}

// Runs code as if in the given tab (its sessionStorage).
function inTab(tab: { storage: MemoryStorage }) {
  vi.stubGlobal('sessionStorage', tab.storage)
}

const sk = generateSecretKey()
const nsec = nip19.nsecEncode(sk)
const pubkey = getPublicKey(sk)
const PASSWORD = 'correct horse battery'

beforeEach(async () => {
  vi.stubGlobal('localStorage', new MemoryStorage())
  indexedDB.deleteDatabase('stede-keystore')
  tabs.length = 0
})

describe('keystore', () => {
  it('starts with no key', async () => {
    const { keystore } = await openTab()
    expect(await keystore.initKey()).toEqual({ status: 'none', pubkey: null })
  })

  it('stores only the encrypted key and the pubkey', async () => {
    const { keystore, storage } = await openTab()
    await keystore.initKey()
    await keystore.importKey(nsec, PASSWORD)
    expect(keystore.getKeyState()).toEqual({ status: 'unlocked', pubkey })
    expect(keystore.getSecretKey()).toEqual(sk)

    const stored = JSON.parse(localStorage.getItem('stede.key')!)
    expect(stored.pubkey).toBe(pubkey)
    expect(stored.ncryptsec).toMatch(/^ncryptsec1/)
    const hex = bytesToHex(sk)
    for (const value of [localStorage.getItem('stede.key')!, storage.getItem('stede.session')!]) {
      expect(value).not.toContain(nsec)
      expect(value).not.toContain(hex)
    }
  })

  it('accepts a hex secret key', async () => {
    const { keystore } = await openTab()
    await keystore.importKey(bytesToHex(sk), PASSWORD)
    expect(keystore.getKeyState().pubkey).toBe(pubkey)
  })

  it('rejects things that are not secret keys, and empty passwords', async () => {
    const { keystore } = await openTab()
    await expect(keystore.importKey(nip19.npubEncode(pubkey), PASSWORD)).rejects.toThrow(/nsec1/)
    await expect(keystore.importKey('hello', PASSWORD)).rejects.toThrow(/nsec1/)
    await expect(keystore.importKey(nsec, '')).rejects.toThrow('Choose a password.')
    expect(localStorage.getItem('stede.key')).toBeNull()
  })

  it('stays unlocked across a reload', async () => {
    const first = await openTab()
    await first.keystore.importKey(nsec, PASSWORD)
    // Reload: same sessionStorage, fresh module.
    vi.resetModules()
    const reloaded = await import('./keystore')
    expect(await reloaded.initKey()).toEqual({ status: 'unlocked', pubkey })
    expect(reloaded.getSecretKey()).toEqual(sk)
  })

  it('shares the unlock with a new tab', async () => {
    const first = await openTab()
    await first.keystore.importKey(nsec, PASSWORD)
    const second = await openTab()
    expect(await second.keystore.initKey()).toEqual({ status: 'unlocked', pubkey })
    expect(second.keystore.getSecretKey()).toEqual(sk)
  })

  it('asks for the password in a new browser session', async () => {
    const first = await openTab()
    await first.keystore.importKey(nsec, PASSWORD)
    await first.keystore.lock() // stands in for closing the browser: no tab left to share
    const later = await openTab()
    expect(await later.keystore.initKey()).toEqual({ status: 'locked', pubkey })
    expect(later.keystore.getSecretKey()).toBeNull()
  })

  it('unlocks with the right password only', async () => {
    const first = await openTab()
    await first.keystore.importKey(nsec, PASSWORD)
    await first.keystore.lock()
    await expect(first.keystore.unlock('wrong password!')).rejects.toThrow('Wrong password.')
    expect(first.keystore.getKeyState().status).toBe('locked')
    await first.keystore.unlock(PASSWORD)
    expect(first.keystore.getKeyState()).toEqual({ status: 'unlocked', pubkey })
    expect(first.keystore.getSecretKey()).toEqual(sk)
  })

  it('locking one tab locks the others', async () => {
    const first = await openTab()
    await first.keystore.importKey(nsec, PASSWORD)
    const second = await openTab()
    await second.keystore.initKey()

    inTab(first)
    await first.keystore.lock()
    await vi.waitFor(() => expect(second.keystore.getKeyState().status).toBe('locked'))
    expect(second.keystore.getSecretKey()).toBeNull()

    // The second tab's wrapped copy is useless now: its session key is gone.
    inTab(second)
    vi.resetModules()
    const reloaded = await import('./keystore')
    expect((await reloaded.initKey()).status).toBe('locked')
  })

  it('forgets the key', async () => {
    const { keystore } = await openTab()
    await keystore.importKey(nsec, PASSWORD)
    await keystore.forgetKey()
    expect(keystore.getKeyState()).toEqual({ status: 'none', pubkey: null })
    expect(localStorage.getItem('stede.key')).toBeNull()
  })
})

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

// A platform authenticator, as far as stede uses it: passkeys with the PRF
// extension, which gives HMAC-SHA-256(the passkey's own secret, salt). `prf` off
// is a password manager that ignores PRF; `prfOnCreate` off is Chrome on
// Android, which gives the secret only when the passkey is used.
function fakeAuthenticator({ prf = true, prfOnCreate = true } = {}) {
  const secrets = new Map<string, Uint8Array>()
  const idOf = (id: BufferSource) => bytesToHex(new Uint8Array(id as ArrayBuffer))
  const evaluate = async (secret: Uint8Array, salt: BufferSource) => {
    const key = await crypto.subtle.importKey(
      'raw',
      secret as BufferSource,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, salt))
  }
  const credential = (id: Uint8Array, results?: { first: Uint8Array }) => ({
    rawId: id.buffer,
    response: { getTransports: () => ['internal', 'hybrid'] },
    getClientExtensionResults: () => ({ prf: prf ? { enabled: true, results } : undefined }),
  })
  const authenticator = {
    cancel: false,
    create: vi.fn(async ({ publicKey }: CredentialCreationOptions) => {
      if (authenticator.cancel) throw new DOMException('Cancelled', 'NotAllowedError')
      const id = crypto.getRandomValues(new Uint8Array(16))
      const secret = crypto.getRandomValues(new Uint8Array(32))
      secrets.set(idOf(id), secret)
      const salt = publicKey!.extensions!.prf!.eval!.first
      return credential(id, prf && prfOnCreate ? { first: await evaluate(secret, salt) } : undefined)
    }),
    get: vi.fn(async ({ publicKey }: CredentialRequestOptions) => {
      if (authenticator.cancel) throw new DOMException('Cancelled', 'NotAllowedError')
      const id = new Uint8Array(publicKey!.allowCredentials![0].id as ArrayBuffer)
      const secret = secrets.get(idOf(id))
      if (!secret) throw new DOMException('No such passkey', 'NotAllowedError')
      const salt = publicKey!.extensions!.prf!.eval!.first
      return credential(id, prf ? { first: await evaluate(secret, salt) } : undefined)
    }),
    signalUnknownCredential: vi.fn(async () => {}),
  }
  vi.stubGlobal('navigator', { credentials: authenticator })
  vi.stubGlobal('PublicKeyCredential', {
    signalUnknownCredential: authenticator.signalUnknownCredential,
  })
  vi.stubGlobal('location', { hostname: 'stede.cc' })
  return authenticator
}

beforeEach(async () => {
  vi.unstubAllGlobals()
  vi.stubGlobal('localStorage', new MemoryStorage())
  indexedDB.deleteDatabase('stede-keystore')
  tabs.length = 0
})

describe('keystore', () => {
  it('starts with no key', async () => {
    const { keystore } = await openTab()
    expect(await keystore.initKey()).toEqual({ status: 'none', pubkey: null, kind: null, passkey: false, password: false })
  })

  it('stores only the encrypted key and the pubkey', async () => {
    const { keystore, storage } = await openTab()
    await keystore.initKey()
    await keystore.importKey(nsec, PASSWORD)
    expect(keystore.getKeyState()).toEqual({ status: 'unlocked', pubkey, kind: 'local', passkey: false, password: true })
    await expect(keystore.getNostr()?.getPublicKey()).resolves.toBe(pubkey)

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
    expect(await reloaded.initKey()).toEqual({ status: 'unlocked', pubkey, kind: 'local', passkey: false, password: true })
    await expect(reloaded.getNostr()?.getPublicKey()).resolves.toBe(pubkey)
  })

  it('shares the unlock with a new tab', async () => {
    const first = await openTab()
    await first.keystore.importKey(nsec, PASSWORD)
    const second = await openTab()
    expect(await second.keystore.initKey()).toEqual({ status: 'unlocked', pubkey, kind: 'local', passkey: false, password: true })
    await expect(second.keystore.getNostr()?.getPublicKey()).resolves.toBe(pubkey)
  })

  it('asks for the password in a new browser session', async () => {
    const first = await openTab()
    await first.keystore.importKey(nsec, PASSWORD)
    await first.keystore.lock() // stands in for closing the browser: no tab left to share
    const later = await openTab()
    expect(await later.keystore.initKey()).toEqual({ status: 'locked', pubkey, kind: 'local', passkey: false, password: true })
    expect(later.keystore.getNostr()).toBeNull()
  })

  it('unlocks with the right password only', async () => {
    const first = await openTab()
    await first.keystore.importKey(nsec, PASSWORD)
    await first.keystore.lock()
    await expect(first.keystore.unlock('wrong password!')).rejects.toThrow('Wrong password.')
    expect(first.keystore.getKeyState().status).toBe('locked')
    await first.keystore.unlock(PASSWORD)
    expect(first.keystore.getKeyState()).toEqual({ status: 'unlocked', pubkey, kind: 'local', passkey: false, password: true })
    await expect(first.keystore.getNostr()?.getPublicKey()).resolves.toBe(pubkey)
  })

  it('locking one tab locks the others', async () => {
    const first = await openTab()
    await first.keystore.importKey(nsec, PASSWORD)
    const second = await openTab()
    await second.keystore.initKey()

    inTab(first)
    await first.keystore.lock()
    await vi.waitFor(() => expect(second.keystore.getKeyState().status).toBe('locked'))
    expect(second.keystore.getNostr()).toBeNull()

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
    expect(keystore.getKeyState()).toEqual({ status: 'none', pubkey: null, kind: null, passkey: false, password: false })
    expect(localStorage.getItem('stede.key')).toBeNull()
  })

  describe('passkey', () => {
    // An unlocked key with a passkey, then the browser session ends.
    async function withPasskey() {
      const first = await openTab()
      await first.keystore.importKey(nsec, PASSWORD)
      await first.keystore.addPasskey()
      await first.keystore.lock()
      return openTab()
    }

    it('unlocks with the passkey in a new browser session', async () => {
      const authenticator = fakeAuthenticator()
      const later = await withPasskey()
      expect(await later.keystore.initKey()).toEqual({
        status: 'locked',
        pubkey,
        kind: 'local',
        passkey: true,
        password: true,
      })
      await later.keystore.unlockWithPasskey()
      expect(later.keystore.getKeyState()).toEqual({
        status: 'unlocked',
        pubkey,
        kind: 'local',
        passkey: true,
        password: true,
      })
      await expect(later.keystore.getNostr()?.getPublicKey()).resolves.toBe(pubkey)
      // The passkey for this key replaces any older one for the same key.
      const { user } = authenticator.create.mock.calls[0][0].publicKey!
      expect(bytesToHex(new Uint8Array(user.id as ArrayBuffer))).toBe(pubkey)
    })

    it('stores the key only wrapped', async () => {
      fakeAuthenticator()
      await withPasskey()
      const stored = localStorage.getItem('stede.key')!
      expect(JSON.parse(stored).passkey).toMatchObject({ transports: ['internal', 'hybrid'] })
      expect(stored).not.toContain(bytesToHex(sk))
    })

    it('asks for the passkey at start', async () => {
      fakeAuthenticator()
      const later = await withPasskey()
      await later.keystore.initKey()
      await later.keystore.unlockAtStart()
      expect(later.keystore.getKeyState().status).toBe('unlocked')
    })

    it('stays locked when the prompt is cancelled, and the password still works', async () => {
      const authenticator = fakeAuthenticator()
      const later = await withPasskey()
      await later.keystore.initKey()
      authenticator.cancel = true
      await later.keystore.unlockAtStart()
      expect(later.keystore.getKeyState().status).toBe('locked')
      await expect(later.keystore.unlockWithPasskey()).rejects.toThrow(/Cancelled/)
      await later.keystore.unlock(PASSWORD)
      expect(later.keystore.getKeyState().status).toBe('unlocked')
    })

    it('shows a single prompt when asked twice at once', async () => {
      const authenticator = fakeAuthenticator()
      const later = await withPasskey()
      await later.keystore.initKey()
      authenticator.get.mockClear()
      await Promise.all([later.keystore.unlockAtStart(), later.keystore.unlockWithPasskey()])
      expect(authenticator.get).toHaveBeenCalledTimes(1)
    })

    it('gets the secret with a second prompt when making the passkey doesn’t give it', async () => {
      const authenticator = fakeAuthenticator({ prfOnCreate: false })
      const later = await withPasskey()
      await later.keystore.initKey()
      await later.keystore.unlockWithPasskey()
      expect(later.keystore.getKeyState().status).toBe('unlocked')
      // One get() while making the passkey, one to unlock.
      expect(authenticator.get).toHaveBeenCalledTimes(2)
    })

    it('says so when the password manager can’t do PRF', async () => {
      const authenticator = fakeAuthenticator({ prf: false })
      const { keystore } = await openTab()
      await keystore.importKey(nsec, PASSWORD)
      await expect(keystore.addPasskey()).rejects.toThrow(/can’t unlock Stede with a passkey/)
      expect(keystore.getKeyState().passkey).toBe(false)
      expect(JSON.parse(localStorage.getItem('stede.key')!).passkey).toBeUndefined()
      // The useless passkey is flagged to the password manager.
      expect(authenticator.signalUnknownCredential).toHaveBeenCalledOnce()
    })

    it('needs the key unlocked to add a passkey', async () => {
      fakeAuthenticator()
      const { keystore } = await openTab()
      await keystore.importKey(nsec, PASSWORD)
      await keystore.lock()
      await expect(keystore.addPasskey()).rejects.toThrow('Unlock your key first.')
    })

    it('goes back to the password only', async () => {
      const authenticator = fakeAuthenticator()
      const { keystore } = await openTab()
      await keystore.importKey(nsec, PASSWORD)
      await keystore.addPasskey()
      keystore.removePasskey()
      expect(keystore.getKeyState()).toEqual({
        status: 'unlocked',
        pubkey,
        kind: 'local',
        passkey: false,
        password: true,
      })
      expect(JSON.parse(localStorage.getItem('stede.key')!).passkey).toBeUndefined()
      expect(authenticator.signalUnknownCredential).toHaveBeenCalledWith({
        rpId: 'stede.cc',
        credentialId: expect.any(String),
      })
      await keystore.lock()
      await expect(keystore.unlockWithPasskey()).rejects.toThrow('No passkey unlocks this key.')
    })

    it('forgets the passkey with the key', async () => {
      const authenticator = fakeAuthenticator()
      const { keystore } = await openTab()
      await keystore.importKey(nsec, PASSWORD)
      await keystore.addPasskey()
      await keystore.forgetKey()
      expect(localStorage.getItem('stede.key')).toBeNull()
      expect(authenticator.signalUnknownCredential).toHaveBeenCalledOnce()
    })

    describe('without a password', () => {
      it('adds a key unlocked by the passkey only', async () => {
        fakeAuthenticator()
        const first = await openTab()
        await first.keystore.importKeyWithPasskey(nsec)
        const keyOnly = { status: 'unlocked', pubkey, kind: 'local', passkey: true, password: false }
        expect(first.keystore.getKeyState()).toEqual(keyOnly)
        const stored = JSON.parse(localStorage.getItem('stede.key')!)
        expect(stored.ncryptsec).toBeUndefined()
        expect(localStorage.getItem('stede.key')).not.toContain(bytesToHex(sk))

        await first.keystore.lock()
        const later = await openTab()
        expect((await later.keystore.initKey()).status).toBe('locked')
        await expect(later.keystore.unlock(PASSWORD)).rejects.toThrow('No password unlocks this key.')
        await later.keystore.unlockWithPasskey()
        expect(later.keystore.getKeyState()).toEqual(keyOnly)
      })

      it('rejects things that are not secret keys before asking for a passkey', async () => {
        const authenticator = fakeAuthenticator()
        const { keystore } = await openTab()
        await expect(keystore.importKeyWithPasskey('hello')).rejects.toThrow(/nsec1/)
        expect(authenticator.create).not.toHaveBeenCalled()
        expect(localStorage.getItem('stede.key')).toBeNull()
      })

      it('stores nothing when no passkey is made', async () => {
        const authenticator = fakeAuthenticator()
        authenticator.cancel = true
        const { keystore } = await openTab()
        await keystore.initKey()
        await expect(keystore.importKeyWithPasskey(nsec)).rejects.toThrow(/Cancelled/)
        expect(localStorage.getItem('stede.key')).toBeNull()
        expect(keystore.getKeyState().status).toBe('none')
      })

      it('keeps the passkey until there is a password', async () => {
        fakeAuthenticator()
        const { keystore } = await openTab()
        await keystore.importKeyWithPasskey(nsec)
        expect(() => keystore.removePasskey()).toThrow(/Add a password first/)
        expect(keystore.getKeyState().passkey).toBe(true)

        await keystore.addPassword(PASSWORD)
        expect(keystore.getKeyState()).toMatchObject({ passkey: true, password: true })
        keystore.removePasskey()
        await keystore.lock()
        await keystore.unlock(PASSWORD)
        expect(keystore.getKeyState()).toMatchObject({
          status: 'unlocked',
          passkey: false,
          password: true,
        })
      })
    })
  })
})

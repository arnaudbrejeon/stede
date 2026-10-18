import 'fake-indexeddb/auto'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { innerPlace } from './placeEvents'
import { clearCache, lockCache, readCache, writeCache, type CachedPlace } from './placeCache'
import { localNostr } from './signer'

function account() {
  const sk = generateSecretKey()
  const nostr = localNostr(sk)
  return {
    pubkey: getPublicKey(sk),
    nostr,
    decrypt: vi.spyOn(nostr.nip44, 'decrypt'),
    encrypt: vi.spyOn(nostr.nip44, 'encrypt'),
  }
}

const places: CachedPlace[] = Array.from({ length: 3 }, (_, i) => ({
  id: `event${i}`,
  created_at: 1000 + i,
  d: `place${i}`,
  inner: innerPlace({ id: `place${i}`, name: `Secret garden ${i}`, lngLat: [2 + i, 48] }),
}))

async function rawRecord(pubkey: string) {
  const db = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open('stede-places')
    request.onsuccess = () => resolve(request.result)
  })
  return new Promise<{ key: string; data: ArrayBuffer }>((resolve) => {
    const request = db.transaction('caches').objectStore('caches').get(pubkey)
    request.onsuccess = () => resolve(request.result)
  })
}

beforeEach(() => lockCache())

describe('place cache', () => {
  it('reads back what was written, with one NIP-44 decryption', async () => {
    const me = account()
    await writeCache(me.pubkey, me.nostr, places)
    lockCache() // a new visit
    expect(await readCache(me.pubkey, me.nostr)).toEqual(places)
    expect(me.decrypt).toHaveBeenCalledTimes(1)
  })

  it('keeps nothing readable', async () => {
    const me = account()
    await writeCache(me.pubkey, me.nostr, places)
    const record = await rawRecord(me.pubkey)
    const bytes = new TextDecoder('latin1').decode(record.data)
    expect(bytes).not.toContain('Secret garden')
    expect(record.key).not.toMatch(/^[A-Za-z0-9+/]{43}=$/) // the cache key, NIP-44 encrypted
  })

  it('reuses its cache key while unlocked', async () => {
    const me = account()
    await writeCache(me.pubkey, me.nostr, places)
    await writeCache(me.pubkey, me.nostr, places.slice(1))
    expect(me.encrypt).toHaveBeenCalledTimes(1)
    lockCache()
    expect(await readCache(me.pubkey, me.nostr)).toEqual(places.slice(1))
  })

  it("can't be read with another key", async () => {
    const me = account()
    const someoneElse = account()
    await writeCache(me.pubkey, me.nostr, places)
    lockCache()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await readCache(me.pubkey, someoneElse.nostr)).toEqual([])
  })

  it('is empty when there is none, and after clearing', async () => {
    const me = account()
    expect(await readCache(me.pubkey, me.nostr)).toEqual([])
    await writeCache(me.pubkey, me.nostr, places)
    await clearCache(me.pubkey)
    expect(await readCache(me.pubkey, me.nostr)).toEqual([])
    expect(me.decrypt).not.toHaveBeenCalled()
  })
})

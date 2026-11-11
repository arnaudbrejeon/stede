import 'fake-indexeddb/auto'
import { generateSecretKey } from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'
import * as nip19 from 'nostr-tools/nip19'
import { normalizeURL } from 'nostr-tools/utils'
import { describe, expect, it, vi } from 'vitest'

// Runs against two real relays, only on request; the first stands for the
// stede relay. With relay/ built as stede-relay-test:
//   docker run -d --rm -p 7781:7777 -e STEDE_RELAY_OPEN_WRITES=1 stede-relay-test
//   docker run -d --rm -p 7782:7777 -e STEDE_RELAY_OPEN_WRITES=1 stede-relay-test
//   VITE_RELAY_URL=ws://localhost:7781 VITE_RELAY_TEST_URLS=ws://localhost:7781,ws://localhost:7782 npm test
const URLS: string[] | undefined = import.meta.env.VITE_RELAY_TEST_URLS?.split(',')

class MemoryStorage {
  m = new Map<string, string>()
  getItem(k: string) {
    return this.m.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.m.set(k, v)
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
}

describe.skipIf(!URLS)('places on several relays', () => {
  it('copies places to a new relay, drops the stede relay, and settles disagreements', async () => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    vi.stubGlobal('sessionStorage', new MemoryStorage())
    const [one, two] = URLS!.map(normalizeURL)
    const keystore = await import('./keystore')
    const relayList = await import('./relayList')
    const store = await import('./placeStore')
    const events = await import('./placeEvents')
    expect(relayList.STEDE_RELAY).toBe(one)
    await keystore.initKey()
    await keystore.importKey(nip19.nsecEncode(generateSecretKey()), 'pw')
    const pubkey = keystore.getKeyState().pubkey!
    const settled = () =>
      vi.waitFor(() =>
        expect(store.getPlacesState()).toMatchObject({ status: 'ready', syncing: false, copying: 0 }),
      )
    const names = () =>
      store
        .getPlacesState()
        .places.features.map((f) => f.properties.name)
        .sort()
    const pool = new SimplePool()
    // The places a relay holds, by d.
    const on = async (url: string) =>
      (await pool.querySync([url], { kinds: [events.PRIVATE_PLACE_KIND], authors: [pubkey] }))
        .map((e) => e.tags[0][1])
        .sort()
    await settled()

    const a = await store.savePlace({ name: 'A', lngLat: [2.3, 48.8] })
    const b = await store.savePlace({ name: 'B', lngLat: [2.4, 48.8] })
    const c = await store.savePlace({ name: 'C', lngLat: [2.5, 48.8] })
    await store.deletePlace(c.properties.id)
    expect(await on(two)).toEqual([])

    // A new relay gets a copy of every place.
    await relayList.saveRelays([one, two])
    await store.loadPlaces()
    await settled()
    expect(await on(two)).toEqual([a.properties.id, b.properties.id].sort())

    // Without the stede relay, places load from the other one.
    await relayList.saveRelays([two])
    await store.loadPlaces()
    await settled()
    expect(names()).toEqual(['A', 'B'])

    // The relays disagree: A was deleted on the first only (the second was
    // down), and D was saved on the second only.
    await relayList.saveRelays([one, two])
    const nostr = keystore.getNostr()!
    await Promise.any(
      pool.publish([one], await events.deletionEvent([a.properties.id], nostr, pubkey)),
    )
    const d = events.innerPlace({ id: 'd', name: 'D', lngLat: [2.6, 48.8] })
    await Promise.any(pool.publish([two], await events.sealPlace(d, nostr, pubkey)))
    await store.loadPlaces()
    await settled()
    expect(names()).toEqual(['B', 'D'])
    expect(await on(one)).toEqual([b.properties.id, 'd'].sort())
    expect(await on(two)).toEqual([b.properties.id, 'd'].sort())

    // Another device finds the list on the stede relay.
    localStorage.removeItem(`stede.relays.${pubkey}`)
    const nsec = nip19.nsecEncode(generateSecretKey())
    await keystore.importKey(nsec, 'pw')
    expect(relayList.getRelays().relays).toEqual([one])
    await relayList.saveRelays([one, two])
    await relayList.saveRelays([two])
    localStorage.removeItem(`stede.relays.${keystore.getKeyState().pubkey}`)
    await keystore.forgetKey()
    await keystore.importKey(nsec, 'pw')
    await vi.waitFor(() => expect(relayList.getRelays().relays).toEqual([two]))
    pool.destroy()
  }, 60000)
})

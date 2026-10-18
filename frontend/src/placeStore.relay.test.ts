import 'fake-indexeddb/auto'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'
import * as nip19 from 'nostr-tools/nip19'
import { describe, expect, it, vi } from 'vitest'

// Runs against a real relay through the dev server's /relay proxy, so only on request:
//   ./dev.sh   then   VITE_RELAY_TEST_HOST=localhost:5173 npm test
const HOST: string | undefined = import.meta.env.VITE_RELAY_TEST_HOST

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
describe.skipIf(!HOST)('places on the relay', () => {
  it('saves, loads, edits and deletes places through the dev server relay', async () => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    vi.stubGlobal('sessionStorage', new MemoryStorage())
    vi.stubGlobal('location', { protocol: 'http:', host: HOST })
    const keystore = await import('./keystore')
    const store = await import('./placeStore')
    await keystore.initKey()
    await keystore.importKey(nip19.nsecEncode(generateSecretKey()), 'pw')

    const orsay = await store.savePlace({
      name: "Musée d'Orsay",
      lngLat: [2.32663, 48.86004],
      osmKey: 'tourism',
      osmValue: 'museum',
      osmType: 'W',
      osmId: 24983713,
      address: 'Paris',
      labels: ['art'],
    })
    const pin = await store.savePlace({
      name: 'Picnic spot',
      lngLat: [2.3, 48.8],
    })

    // A fresh session: lock, unlock, and load from the relay.
    await keystore.lock()
    await keystore.unlock('pw')
    const getPlaces = store.getPlacesState
    await vi.waitFor(() => expect(getPlaces()).toMatchObject({ status: 'ready', syncing: false }), {
      timeout: 5000,
    })
    const names = getPlaces()
      .places.features.map((f) => f.properties.name)
      .sort()
    expect(names).toEqual(["Musée d'Orsay", 'Picnic spot'])
    const loaded = getPlaces().places.features.find((f) => f.properties.id === orsay.properties.id)!
    expect(loaded.properties).toEqual(orsay.properties)

    // Edit: same id, new version replaces the old one on the relay.
    await store.savePlace({
      ...(await import('./placeEvents')).draftFromPlace(loaded),
      name: 'Orsay',
    })
    // Edit the pin twice quickly (dated ahead), then delete it at once.
    const pinDraft = (await import('./placeEvents')).draftFromPlace(pin)
    await store.savePlace({ ...pinDraft, name: 'Picnic 2' })
    await store.savePlace({ ...pinDraft, name: 'Picnic 3' })
    await store.deletePlace(pin.properties.id)
    await store.loadPlaces()
    expect(getPlaces().places.features.map((f) => f.properties.name)).toEqual(['Orsay'])
  }, 30000)

  it('imports, exports, deletes all and imports again', async () => {
    const keystore = await import('./keystore')
    const store = await import('./placeStore')
    const { innerPlace } = await import('./placeEvents')
    await keystore.importKey(nip19.nsecEncode(generateSecretKey()), 'pw')
    await vi.waitFor(() =>
      expect(store.getPlacesState()).toMatchObject({ status: 'ready', syncing: false }),
    )

    const places = Array.from({ length: 30 }, (_, i) => ({
      ...innerPlace({
        id: `p${i}`,
        name: `Place ${i}`,
        lngLat: [2 + i / 10, 48],
        labels: ['To try'],
      }),
      created_at: 1,
    }))
    // A duplicate of the first place, with a comment to merge in.
    places.push({
      ...innerPlace({ id: 'dup', name: 'place 0', lngLat: [2, 48], note: 'Merged' }),
      created_at: 1,
    })
    const file = JSON.stringify({ format: 'stede-places', version: 1, exported_at: 1, places })

    const first = await store.importPlaces(file)
    expect(first).toMatchObject({ added: 30, merged: 1, failed: 0 })
    const exported = store.exportPlaces()
    expect(exported.places).toHaveLength(30)
    expect(exported.places.find((p) => p.tags[0][1] === 'p0')!.content).toBe('Merged')

    // A fresh session reads them all back from the relay.
    await keystore.lock()
    await keystore.unlock('pw')
    await vi.waitFor(() =>
      expect(store.getPlacesState()).toMatchObject({ status: 'ready', syncing: false }),
    )
    expect(store.getPlacesState().places.features).toHaveLength(30)

    expect(await store.deleteAllPlaces()).toBe(30)
    await store.loadPlaces()
    expect(store.getPlacesState().places.features).toHaveLength(0)

    // Deleted addresses are refused by the relay, so the import gives them new ones.
    const again = await store.importPlaces(JSON.stringify(exported))
    expect(again).toMatchObject({ added: 30, failed: 0 })
    await store.loadPlaces()
    expect(store.getPlacesState().places.features).toHaveLength(30)
  }, 60000)

  it('cancels an import and finishes it when imported again', async () => {
    const keystore = await import('./keystore')
    const store = await import('./placeStore')
    const { innerPlace } = await import('./placeEvents')
    await keystore.importKey(nip19.nsecEncode(generateSecretKey()), 'pw')
    await vi.waitFor(() =>
      expect(store.getPlacesState()).toMatchObject({ status: 'ready', syncing: false }),
    )
    const places = Array.from({ length: 200 }, (_, i) => ({
      ...innerPlace({ id: `c${i}`, name: `Cancel ${i}`, lngLat: [2 + i / 100, 47] }),
      created_at: 1,
    }))
    const file = JSON.stringify({ format: 'stede-places', version: 1, exported_at: 1, places })

    const controller = new AbortController()
    const cancelled = await store.importPlaces(
      file,
      (done) => done >= 50 && controller.abort(),
      controller.signal,
    )
    expect(cancelled.cancelled).toBe(true)
    expect(cancelled.saved).toBeLessThan(200)
    expect(store.getPlacesState().places.features).toHaveLength(cancelled.saved)

    const rest = await store.importPlaces(file)
    expect(rest).toMatchObject({
      cancelled: false,
      added: 200 - cancelled.saved,
      unchanged: cancelled.saved,
    })
    await store.loadPlaces()
    expect(store.getPlacesState().places.features).toHaveLength(200)
    await store.deleteAllPlaces()
  }, 60000)

  it('asks before writing, and writes nothing when told no', async () => {
    const keystore = await import('./keystore')
    const store = await import('./placeStore')
    const { innerPlace } = await import('./placeEvents')
    await keystore.importKey(nip19.nsecEncode(generateSecretKey()), 'pw')
    await vi.waitFor(() =>
      expect(store.getPlacesState()).toMatchObject({ status: 'ready', syncing: false }),
    )
    const places = Array.from({ length: 8 }, (_, i) => ({
      ...innerPlace({ id: `q${i}`, name: `Ask ${i}`, lngLat: [3 + i / 100, 47] }),
      created_at: 1,
    }))
    const file = JSON.stringify({ format: 'stede-places', version: 1, exported_at: 1, places })
    const asked: number[] = []

    const declined = await store.importPlaces(file, undefined, undefined, async (count) => {
      asked.push(count)
      return false
    })
    expect(asked).toEqual([8])
    expect(declined).toMatchObject({ cancelled: true, saved: 0, total: 8 })
    await store.loadPlaces()
    expect(store.getPlacesState().places.features).toHaveLength(0)

    const accepted = await store.importPlaces(file, undefined, undefined, async () => true)
    expect(accepted).toMatchObject({ cancelled: false, saved: 8 })
    await store.deleteAllPlaces()
  }, 60000)
  it('loads only what changed since the last visit', async () => {
    const keystore = await import('./keystore')
    const store = await import('./placeStore')
    const { readCache } = await import('./placeCache')
    const { deletionEvent, innerPlace, sealPlace } = await import('./placeEvents')
    const { localNostr } = await import('./signer')
    const settled = () =>
      vi.waitFor(() =>
        expect(store.getPlacesState()).toMatchObject({ status: 'ready', syncing: false }),
      )
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    await keystore.importKey(nip19.nsecEncode(sk), 'pw')
    await settled()
    await store.savePlace({ name: 'Kept', lngLat: [1, 1] })
    const gone = await store.savePlace({ name: 'Deleted elsewhere', lngLat: [2, 2] })

    // Another device adds a place and deletes one, straight on the relay.
    const nostr = localNostr(sk)
    const goneAt = store.exportPlaces().places.find((p) => p.tags[0][1] === gone.properties.id)!
    const later = (goneAt.created_at ?? 0) + 1
    const added = await sealPlace(
      innerPlace({ id: 'elsewhere', name: 'Added elsewhere', lngLat: [3, 3] }),
      nostr,
      pubkey,
    )
    const deletion = await deletionEvent(gone.properties.id, nostr, pubkey, later)
    const relay = new SimplePool()
    for (const event of [added, deletion]) {
      await Promise.any(relay.publish([`ws://${HOST}/relay`], event))
    }
    relay.destroy()

    // A new visit: the browser's copy first, then only the changes, by negentropy.
    const warn = vi.spyOn(console, 'warn')
    await keystore.lock()
    await keystore.unlock('pw')
    await settled()
    const names = store
      .getPlacesState()
      .places.features.map((f) => f.properties.name)
      .sort()
    expect(names).toEqual(['Added elsewhere', 'Kept'])
    expect(warn.mock.calls.flat().join(' ')).not.toContain('Loading all places')
    // The cache now holds the same two places, decrypted under the cache key.
    await vi.waitFor(
      async () =>
        expect(
          (await readCache(pubkey, nostr))
            .filter((p) => p.inner)
            .map((p) => p.d)
            .sort(),
        ).toEqual(
          [
            'elsewhere',
            (await import('./placeStore'))
              .getPlacesState()
              .places.features.find((f) => f.properties.name === 'Kept')!.properties.id,
          ].sort(),
        ),
      { timeout: 5000 },
    )

    // Removing the key from this browser removes its cache too.
    await keystore.forgetKey()
    await vi.waitFor(async () => expect(await readCache(pubkey, nostr)).toEqual([]))
  }, 30000)
})

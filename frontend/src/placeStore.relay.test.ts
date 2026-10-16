import 'fake-indexeddb/auto'
import { generateSecretKey } from 'nostr-tools'
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
    await vi.waitFor(() => expect(getPlaces().status).toBe('ready'), {
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
})

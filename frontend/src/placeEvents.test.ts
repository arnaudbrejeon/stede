import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import {
  conversationKey,
  deletionEvent,
  draftFromPlace,
  geohash,
  innerPlace,
  openPlace,
  parseGeo,
  placeFromInner,
  sealPlace,
  type PlaceDraft,
} from './placeEvents'

const sk = generateSecretKey()
const key = conversationKey(sk)

const orsay: PlaceDraft & { id: string } = {
  id: 'a3f9c2e1-7b4d-4c8a-9e2f-1d6b8a0c5e7f',
  name: "Musée d'Orsay",
  lngLat: [2.32663, 48.86004],
  osmKey: 'tourism',
  osmValue: 'museum',
  osmType: 'W',
  osmId: 24983713,
  address: "1 Rue de la Légion d'Honneur, 75007 Paris, France",
  labels: ['Art', 'to try', 'art'],
  note: 'Thursday evenings are quieter.',
  icon: 'museum',
}

describe('place events', () => {
  it('writes a NIP-XX place', () => {
    const inner = innerPlace(orsay)
    expect(inner.kind).toBe(31300)
    expect(inner.content).toBe('Thursday evenings are quieter.')
    expect(inner.tags).toEqual([
      ['d', orsay.id],
      ['name', "Musée d'Orsay"],
      ['geo', '48.86004,2.32663'],
      ['g', 'u09t'],
      ['g', 'u09tuy'],
      ['g', 'u09tuywnq'],
      ['location', "1 Rue de la Légion d'Honneur, 75007 Paris, France"],
      ['t', 'art'],
      ['t', 'to try'],
      ['i', 'osm:way/24983713'],
      ['k', 'osm'],
      ['osm:tourism', 'museum'],
      ['L', 'cc.stede.icon'],
      ['l', 'museum', 'cc.stede.icon'],
    ])
  })

  it('reads back what it writes', () => {
    const place = placeFromInner(innerPlace(orsay))!
    expect(place.geometry.coordinates).toEqual([2.32663, 48.86004])
    expect(place.properties).toEqual({
      id: orsay.id,
      name: "Musée d'Orsay",
      category: 'museum',
      category_key: 'tourism',
      tags: ['art', 'to try'],
      website: null,
      address: orsay.address,
      comment: 'Thursday evenings are quieter.',
      osm_type: 'W',
      osm_id: 24983713,
      icon: 'museum',
    })
    // Saving it again keeps everything.
    expect(innerPlace(draftFromPlace(place))).toEqual(
      innerPlace({ ...orsay, labels: ['art', 'to try'] }),
    )
  })

  it('keeps a dropped pin minimal', () => {
    const inner = innerPlace({
      id: 'pin',
      name: ' Picnic spot ',
      lngLat: [2.3, 48.8],
    })
    expect(inner.tags.map((t) => t[0])).toEqual(['d', 'name', 'geo', 'g', 'g', 'g'])
    expect(inner.tags[1]).toEqual(['name', 'Picnic spot'])
    expect(inner.content).toBe('')
    expect(placeFromInner(inner)!.properties.category).toBe('')
  })

  it('rejects invalid places', () => {
    const tags = innerPlace(orsay).tags
    const without = (name: string) => ({
      kind: 31300,
      content: '',
      tags: tags.filter((t) => t[0] !== name),
    })
    expect(placeFromInner(without('d'))).toBeNull()
    expect(placeFromInner(without('name'))).toBeNull()
    expect(placeFromInner(without('geo'))).toBeNull()
    expect(placeFromInner({ kind: 1, content: '', tags })).toBeNull()
  })

  it('seals a place so only the author can read it', () => {
    const event = sealPlace(innerPlace(orsay), sk)
    expect(verifyEvent(event)).toBe(true)
    expect(event.kind).toBe(31301)
    expect(event.pubkey).toBe(getPublicKey(sk))
    expect(event.tags).toEqual([['d', orsay.id]])
    expect(JSON.stringify(event)).not.toContain('Orsay')
    expect(openPlace(event, key)).toEqual(innerPlace(orsay))
    expect(() => openPlace(event, conversationKey(generateSecretKey()))).toThrow()
  })

  it('refuses an event whose d differs from the place inside', () => {
    const event = sealPlace(innerPlace(orsay), sk)
    const forged = { ...event, tags: [['d', 'other']] }
    expect(() => openPlace(forged, key)).toThrow(/does not match/)
  })

  it('deletes by address', () => {
    const event = deletionEvent(orsay.id, sk)
    expect(verifyEvent(event)).toBe(true)
    expect(event.kind).toBe(5)
    expect(event.tags).toEqual([
      ['a', `31301:${getPublicKey(sk)}:${orsay.id}`],
      ['k', '31301'],
    ])
  })

  it('computes geohashes and parses geo paths', () => {
    // The NIP's example and the relay policy agree on these.
    expect(geohash(48.86004, 2.32663, 9)).toBe('u09tuywnq')
    expect(geohash(-33.8688, 151.2093, 6)).toBe('r3gx2f')
    expect(parseGeo('geo:48.8519,2.3389;u=10')).toEqual([2.3389, 48.8519])
    expect(parseGeo('48.8519,2.3389,35')).toEqual([2.3389, 48.8519])
    expect(parseGeo('91,0')).toBeNull()
    expect(parseGeo('nope')).toBeNull()
  })
})

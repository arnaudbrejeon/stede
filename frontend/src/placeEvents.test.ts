import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { localNostr } from './signer'
import {
  deletionEvent,
  draftFromPlace,
  geohash,
  innerPlace,
  openPlace,
  parseGeo,
  placeFromInner,
  sealPlace,
  webUrl,
  type PlaceDraft,
} from './placeEvents'

const sk = generateSecretKey()
const nostr = localNostr(sk)
const pubkey = getPublicKey(sk)

const orsay: PlaceDraft & { id: string } = {
  id: 'a3f9c2e1-7b4d-4c8a-9e2f-1d6b8a0c5e7f',
  name: "Musée d'Orsay",
  lngLat: [2.32663, 48.86004],
  osmKey: 'tourism',
  osmValue: 'museum',
  osmType: 'W',
  osmId: 24983713,
  address: "1 Rue de la Légion d'Honneur, 75007 Paris, France",
  labels: ['Art', 'to try', 'art', 'Best OC'],
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
      ['t', 'Art'],
      ['t', 'To try'],
      ['t', 'Best OC'],
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
      tags: ['Art', 'To try', 'Best OC'],
      website: null,
      address: orsay.address,
      comment: 'Thursday evenings are quieter.',
      osm_type: 'W',
      osm_id: 24983713,
      icon: 'museum',
    })
    // Saving it again keeps everything.
    expect(innerPlace(draftFromPlace(place))).toEqual(innerPlace(orsay))
  })

  it('stores the website as an r tag', () => {
    const inner = innerPlace({ ...orsay, website: 'musee-orsay.fr' })
    expect(inner.tags.filter((t) => t[0] === 'r')).toEqual([['r', 'https://musee-orsay.fr']])
    const place = placeFromInner(inner)!
    expect(place.properties.website).toBe('https://musee-orsay.fr')
    expect(innerPlace(draftFromPlace(place))).toEqual(inner)
    // Cleared, or not a web address: no website.
    expect(innerPlace({ ...orsay, website: '' }).tags.some((t) => t[0] === 'r')).toBe(false)
    expect(innerPlace({ ...orsay, website: 'call us' }).tags.some((t) => t[0] === 'r')).toBe(false)
  })

  it('reads websites as typed or tagged in OSM', () => {
    expect(webUrl('https://www.bistro.example/')).toBe('https://www.bistro.example/')
    expect(webUrl(' bistro.example/menu ')).toBe('https://bistro.example/menu')
    expect(webUrl('http://a.example;https://b.example')).toBe('http://a.example')
    expect(webUrl('javascript:alert(1)')).toBeNull()
    expect(webUrl('mailto:hi@bistro.example')).toBeNull()
    expect(webUrl('closed')).toBeNull()
    expect(webUrl('')).toBeNull()
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

  it('seals a place so only the author can read it', async () => {
    const event = await sealPlace(innerPlace(orsay), nostr, pubkey)
    expect(verifyEvent(event)).toBe(true)
    expect(event.kind).toBe(31301)
    expect(event.pubkey).toBe(getPublicKey(sk))
    expect(event.tags).toEqual([['d', orsay.id]])
    expect(JSON.stringify(event)).not.toContain('Orsay')
    expect(await openPlace(event, nostr)).toEqual(innerPlace(orsay))
    await expect(openPlace(event, localNostr(generateSecretKey()))).rejects.toThrow()
  })

  it('refuses an event whose d differs from the place inside', async () => {
    const event = await sealPlace(innerPlace(orsay), nostr, pubkey)
    const forged = { ...event, tags: [['d', 'other']] }
    await expect(openPlace(forged, nostr)).rejects.toThrow(/does not match/)
  })

  it('deletes by address', async () => {
    const event = await deletionEvent(orsay.id, nostr, pubkey)
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

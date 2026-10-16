import { describe, expect, it } from 'vitest'
import { innerPlace, keepUnmanagedTags, type InnerPlace, type PlaceDraft } from './placeEvents'
import {
  buildPlacesFile,
  mergePlaces,
  normalizeName,
  parsePlacesFile,
  planImport,
  type PlaceRecord,
} from './placesFile'

const place = (draft: Partial<PlaceDraft> & { id: string }, extra: string[][] = []): InnerPlace => {
  const inner = innerPlace({ name: 'Le Comptoir', lngLat: [2.3389, 48.8519], ...draft })
  return { ...inner, tags: [...inner.tags, ...extra] }
}
const record = (inner: InnerPlace, createdAt = 100): PlaceRecord => ({ inner, createdAt })
const file = (places: unknown[], extra = {}) =>
  JSON.stringify({ format: 'stede-places', version: 1, exported_at: 1, places, ...extra })

describe('places file', () => {
  it('exports and reads back the same places', () => {
    const a = place({ id: 'a', labels: ['To try'], note: 'Book ahead' }, [
      ['l', 'restaurant', 'com.mapstr.icon'],
    ])
    const exported = buildPlacesFile([record(a, 200)], 300)
    expect(exported.places).toEqual([{ ...a, created_at: 200 }])
    expect(parsePlacesFile(JSON.stringify(exported))).toEqual({
      places: [{ ...a, created_at: 200 }],
      invalid: 0,
    })
  })

  it('refuses files that are not stede places', () => {
    expect(() => parsePlacesFile('nope')).toThrow('not JSON')
    expect(() => parsePlacesFile('{"type":"FeatureCollection","features":[]}')).toThrow(
      'not a stede places file',
    )
    expect(() => parsePlacesFile(file([], { version: 2 }))).toThrow('newer version')
  })

  it('skips invalid places and counts them', () => {
    const ok = place({ id: 'a' })
    const parsed = parsePlacesFile(
      file([
        ok,
        { kind: 1, tags: [] },
        { kind: 31300, tags: [['d', 'x']] },
        null,
        { ...ok, tags: [...ok.tags, [3]] },
      ]),
    )
    expect(parsed.invalid).toBe(3)
    expect(parsed.places).toHaveLength(2)
    // A malformed tag is dropped, not the place.
    expect(parsed.places[1].tags).toEqual(ok.tags)
  })

  it('normalizes names for duplicates', () => {
    expect(normalizeName('Gili-Gili')).toBe(normalizeName('gili gili'))
    expect(normalizeName('Café de Flore')).toBe('cafe de flore')
    expect(normalizeName('❤️?')).toBe('')
  })
})

describe('import plan', () => {
  it('adds new places', () => {
    const plan = planImport(new Map(), [place({ id: 'a' }), place({ id: 'b', name: 'Other' })])
    expect(plan).toMatchObject({ added: 2, updated: 0, merged: 0, unchanged: 0 })
    expect(plan.writes.map((w) => w.previous)).toEqual([undefined, undefined])
  })

  it('replaces a place with the same d only by a newer version', () => {
    const ours = record(place({ id: 'a', note: 'mine' }), 100)
    const existing = new Map([['a', ours]])
    const older = { ...place({ id: 'a', note: 'old' }), created_at: 50 }
    const newer = { ...place({ id: 'a', note: 'new' }), created_at: 150 }
    expect(planImport(existing, [older])).toMatchObject({ unchanged: 1, writes: [] })
    const plan = planImport(existing, [newer])
    expect(plan).toMatchObject({ updated: 1 })
    expect(plan.writes[0].inner.content).toBe('new')
    expect(plan.writes[0].previous).toBe(ours)
  })

  it('skips places that are already there', () => {
    const a = place({ id: 'a' })
    expect(planImport(new Map([['a', record(a)]]), [{ ...a, created_at: 500 }])).toMatchObject({
      unchanged: 1,
      writes: [],
    })
  })

  it('merges a duplicate into the place you have', () => {
    const ours = record(place({ id: 'a', labels: ['To try'], note: 'Ask for the terrace' }))
    const theirs = place(
      {
        id: 'b',
        name: 'le comptoir',
        lngLat: [2.3391, 48.852],
        labels: ['to try', 'Bistro'],
        note: 'Closed Sundays',
        osmType: 'N',
        osmId: 42,
      },
      [
        ['L', 'com.mapstr.icon'],
        ['l', 'restaurant', 'com.mapstr.icon'],
      ],
    )
    const plan = planImport(new Map([['a', ours]]), [theirs])
    expect(plan).toMatchObject({ merged: 1, added: 0 })
    const merged = plan.writes[0]
    expect(merged.previous).toBe(ours)
    const tags = merged.inner.tags
    expect(tags.find((t) => t[0] === 'd')![1]).toBe('a')
    expect(tags.find((t) => t[0] === 'name')![1]).toBe('Le Comptoir')
    expect(tags.filter((t) => t[0] === 't').map((t) => t[1])).toEqual(['To try', 'Bistro'])
    expect(tags).toContainEqual(['i', 'osm:node/42'])
    expect(tags).toContainEqual(['k', 'osm'])
    expect(tags).toContainEqual(['l', 'restaurant', 'com.mapstr.icon'])
    expect(merged.inner.content).toBe('Ask for the terrace\n\nClosed Sundays')
  })

  it('merges a d repeated in the file instead of dropping it', () => {
    const plan = planImport(new Map(), [
      place({ id: 'a', labels: ['A'] }),
      place({ id: 'a', name: 'Elsewhere', lngLat: [4.83, 45.76], labels: ['B'] }),
    ])
    expect(plan).toMatchObject({ added: 1, merged: 1 })
    expect(plan.writes[0].inner.tags.filter((t) => t[0] === 't').map((t) => t[1])).toEqual([
      'A',
      'B',
    ])
  })

  it('merges duplicates within the file', () => {
    const plan = planImport(new Map(), [
      place({ id: 'a', labels: ['A'] }),
      place({ id: 'b', labels: ['B'] }),
    ])
    expect(plan).toMatchObject({ added: 1, merged: 1 })
    expect(plan.writes).toHaveLength(1)
    expect(plan.writes[0].inner.tags.filter((t) => t[0] === 't').map((t) => t[1])).toEqual([
      'A',
      'B',
    ])
  })

  it('keeps same-named places that are far apart, or differently named on one OSM object', () => {
    const paris = place({ id: 'a', name: 'Patrick Roger', osmType: 'N', osmId: 1 })
    const lyon = place({ id: 'b', name: 'Patrick Roger', lngLat: [4.83, 45.76] })
    const park = place({ id: 'c', name: 'Parc de Patrick Roger', osmType: 'N', osmId: 1 })
    expect(planImport(new Map(), [paris, lyon, park])).toMatchObject({ added: 3, merged: 0 })
  })

  it('treats one OSM object with the same name as a duplicate, however far', () => {
    const a = place({ id: 'a', osmType: 'W', osmId: 7 })
    const b = place({ id: 'b', lngLat: [2.4, 48.9], osmType: 'W', osmId: 7 })
    // Recognised as the same place; it adds nothing, so nothing is written for it.
    expect(planImport(new Map(), [a, b])).toMatchObject({ added: 1, merged: 0, unchanged: 1 })
  })
})

describe('merging and editing keep data', () => {
  it('keeps the comment when one already contains the other', () => {
    const a = place({ id: 'a', note: 'Closed Sundays. Book ahead.' })
    expect(mergePlaces(a, place({ id: 'b', note: 'Book ahead.' })).content).toBe(a.content)
    expect(mergePlaces(place({ id: 'a' }), place({ id: 'b', note: 'New' })).content).toBe('New')
  })

  it('carries tags the app does not manage over to a new version', () => {
    const before = place({ id: 'a', icon: 'plate' }, [
      ['L', 'com.mapstr.icon'],
      ['l', 'restaurant', 'com.mapstr.icon'],
      ['osm:opening_hours', 'Mo-Fr 12:00-14:00'],
    ])
    const edited = keepUnmanagedTags(place({ id: 'a', name: 'Renamed', icon: 'goblet' }), before)
    expect(edited.tags).toContainEqual(['name', 'Renamed'])
    expect(edited.tags).toContainEqual(['l', 'goblet', 'cc.stede.icon'])
    expect(edited.tags).not.toContainEqual(['l', 'plate', 'cc.stede.icon'])
    expect(edited.tags).toContainEqual(['L', 'com.mapstr.icon'])
    expect(edited.tags).toContainEqual(['l', 'restaurant', 'com.mapstr.icon'])
    expect(edited.tags).toContainEqual(['osm:opening_hours', 'Mo-Fr 12:00-14:00'])
    // Labels the editor removed stay removed.
    const relabeled = keepUnmanagedTags(place({ id: 'a' }), place({ id: 'a', labels: ['Old'] }))
    expect(relabeled.tags.filter((t) => t[0] === 't')).toEqual([])
  })
})

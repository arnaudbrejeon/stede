import { describe, expect, it } from 'vitest'
import { fakeFetch } from './fakeFetch'
import { handle } from './index'
import { View } from './geocoding'

const PARIS_VIEW = '2.25,48.81,2.42,48.91'

function feature(osmId: number, lon: number, lat: number, name = 'x') {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { osm_type: 'N', osm_id: osmId, name },
  }
}

const TOWER = feature(1, 2.2945, 48.8583, 'Tour Eiffel')
const TOWER_HOTEL = feature(2, 2.2852, 48.8647, 'Hotel Eiffel')
const JUST_OUTSIDE = feature(3, 2.22, 48.86, 'Boulogne') // beyond the view, within its margin
const CANADA = feature(4, -116.235, 51.3336, 'Eiffel Tower')
const BRUSSELS = feature(5, 4.35, 50.85, 'Eiffel Tower')

const collection = (features: unknown[]) => Response.json({ type: 'FeatureCollection', features })

function photonReturning(local: unknown[], worldwide: unknown[]) {
  return fakeFetch((url) => collection(url.searchParams.has('bbox') ? local : worldwide))
}

async function search(fetch: ReturnType<typeof fakeFetch>, params: Record<string, string>) {
  return handle(new Request(`https://stede.cc/api/search?${new URLSearchParams(params)}`), fetch)
}

const ids = (features: { properties: { osm_id: number } }[]) =>
  features.map((f) => f.properties.osm_id)

describe('/api/search', () => {
  it('splits results into nearby and elsewhere', async () => {
    const fetch = photonReturning(
      [TOWER, TOWER_HOTEL],
      // Worldwide repeats the tower and adds one more nearby place among far ones.
      [CANADA, TOWER, BRUSSELS, JUST_OUTSIDE],
    )
    const response = await search(fetch, { q: 'eiffel tower', bbox: PARIS_VIEW, lang: 'fr-FR' })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(ids(body.nearby)).toEqual([1, 2, 3])
    expect(ids(body.elsewhere)).toEqual([4, 5])
    expect(body.nearby[0].properties.distance_m).toBeLessThan(5_000)
    expect(body.elsewhere[0].properties.distance_m).toBeGreaterThan(5_000_000)

    const local = fetch.calls.find((url) => url.searchParams.has('bbox'))!
    const worldwide = fetch.calls.find((url) => !url.searchParams.has('bbox'))!
    expect(local.searchParams.get('q')).toBe('eiffel tower')
    expect(local.searchParams.get('lang')).toBe('fr')
    // The local query is limited to the view plus its margin.
    const [west, south, east, north] = local.searchParams.get('bbox')!.split(',').map(Number)
    expect(west < 2.25 && east > 2.42 && south < 48.81 && north > 48.91).toBe(true)
    // The worldwide one is biased toward the view's centre.
    expect(Number(worldwide.searchParams.get('lat'))).toBeCloseTo(48.86)
    expect(Number(worldwide.searchParams.get('lon'))).toBeCloseTo(2.335)
  })

  it('caps each group at limit', async () => {
    const far = Array.from({ length: 10 }, (_, i) => feature(100 + i, -100 + i, 40))
    const body = await (
      await search(photonReturning([TOWER, TOWER_HOTEL], far), {
        q: 'x',
        bbox: PARIS_VIEW,
        limit: '1',
      })
    ).json()
    expect(body.nearby).toHaveLength(1)
    expect(body.elsewhere).toHaveLength(1)
  })

  it('puts everything elsewhere without a view', async () => {
    const fetch = photonReturning([], [TOWER, CANADA])
    const body = await (await search(fetch, { q: 'eiffel tower' })).json()
    expect(body.nearby).toEqual([])
    expect(body.elsewhere).toHaveLength(2)
    expect(fetch.calls).toHaveLength(1)
    expect(fetch.calls[0].searchParams.has('bbox')).toBe(false)
  })

  it('still returns one query when the other fails', async () => {
    const fetch = fakeFetch((url) =>
      url.searchParams.has('bbox') ? new Response(null, { status: 500 }) : collection([CANADA]),
    )
    const body = await (await search(fetch, { q: 'x', bbox: PARIS_VIEW })).json()
    expect(ids(body.elsewhere)).toEqual([4])
  })

  it('drops languages Photon does not support', async () => {
    const fetch = photonReturning([], [])
    await search(fetch, { q: 'louvre', lang: 'es' })
    expect(fetch.calls[0].searchParams.has('lang')).toBe(false)
  })

  it('answers 502 when the provider fails', async () => {
    const fetch = fakeFetch(() => new Response(null, { status: 500 }))
    expect((await search(fetch, { q: 'louvre' })).status).toBe(502)
  })

  it.each([
    { q: '' },
    {},
    { q: 'x', limit: '50' },
    { q: 'x', limit: '2.5' },
    { q: 'x', bbox: '1,2,3' },
    { q: 'x', bbox: '3,48,2,49' }, // west > east
    { q: 'x', bbox: 'a,b,c,d' },
    { q: 'x', bbox: '0,-100,1,1' },
  ])('validates parameters: %o', async (params) => {
    const fetch = fakeFetch(() => {
      throw new Error('should not be called')
    })
    expect((await search(fetch, params as Record<string, string>)).status).toBe(422)
  })

  it('clamps the view margin to the world', () => {
    const padded = new View(-180, -90, 180, 90).padded()
    expect([padded.west, padded.south, padded.east, padded.north]).toEqual([-180, -90, 180, 90])
  })
})

describe('/api/address', () => {
  const photon = (properties: Record<string, string>) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [2.3389, 48.8519] },
    properties,
  })

  function addressWith(close: unknown[], around: unknown[], params: Record<string, string> = {}) {
    const fetch = fakeFetch((url) => {
      expect(url.pathname).toBe('/reverse')
      return collection(url.searchParams.has('layer') ? close : around)
    })
    const query = new URLSearchParams({ lat: '48.8519', lon: '2.3389', ...params })
    return { fetch, response: handle(new Request(`https://stede.cc/api/address?${query}`), fetch) }
  }

  it('gives a street address for a house nearby', async () => {
    const house = photon({
      type: 'house',
      name: 'Le Relais Saint-Germain',
      housenumber: '9',
      street: "Carrefour de l'Odéon",
      city: 'Paris',
      country: 'France',
    })
    const { fetch, response } = addressWith([house], [], { lang: 'fr-FR' })
    expect(await (await response).json()).toEqual({
      address: "9 Carrefour de l'Odéon, Paris, France",
    })
    expect(fetch.calls[0].searchParams.getAll('layer')).toEqual(['house', 'street'])
    expect(fetch.calls[0].searchParams.get('lang')).toBe('fr')
  })

  it('names a street by its name', async () => {
    const street = photon({
      type: 'street',
      name: 'Apache Street',
      city: 'Grand Canyon Village',
      country: 'United States',
    })
    const { response } = addressWith([street], [])
    expect(await (await response).json()).toEqual({
      address: 'Apache Street, Grand Canyon Village, United States',
    })
  })

  it('says near the town far from streets', async () => {
    const village = photon({
      type: 'city',
      name: 'Grand Canyon Village',
      state: 'Arizona',
      country: 'United States',
    })
    const { response } = addressWith([], [village])
    expect(await (await response).json()).toEqual({
      address: 'Near Grand Canyon Village, Arizona, United States',
    })
  })

  it('is null with nothing around', async () => {
    const { response } = addressWith([], [])
    expect(await (await response).json()).toEqual({ address: null })
  })

  it('rejects points off the map', async () => {
    const { response } = addressWith([], [], { lat: '95' })
    expect((await response).status).toBe(422)
  })

  it('answers 502 when the provider fails', async () => {
    const fetch = fakeFetch(() => new Response(null, { status: 500 }))
    const response = await handle(new Request('https://stede.cc/api/address?lat=1&lon=1'), fetch)
    expect(response.status).toBe(502)
  })
})

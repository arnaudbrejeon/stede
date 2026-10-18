import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeFetch, html } from './fakeFetch'
import { handle } from './index'
import { clearCache, commonsFileFromTags, EMPTY_RESULT_TTL_MS, findPlaceImage } from './placeImage'

beforeEach(() => clearCache())
afterEach(() => vi.restoreAllMocks())

const osm = (tags: Record<string, string>) => Response.json({ elements: [{ tags }] })

// Answers by host; anything else is a 404.
const byHost = (routes: Record<string, () => Response>) =>
  fakeFetch((url) => routes[url.host]?.() ?? new Response(null, { status: 404 }))

const hosts = (fetch: ReturnType<typeof fakeFetch>) => fetch.calls.map((url) => url.host)

describe('commonsFileFromTags', () => {
  it.each([
    [{ image: 'https://fr.wikipedia.org/wiki/Fichier:Tour_Eiffel.jpg' }, 'Tour_Eiffel.jpg'],
    [{ image: 'https://commons.wikimedia.org/wiki/File:Caf%C3%A9.jpg' }, 'Café.jpg'],
    [{ wikimedia_commons: 'File:Louvre at night.jpg' }, 'Louvre at night.jpg'],
    [{ wikimedia_commons: 'Category:Eiffel Tower' }, null],
    [{ image: 'https://example.com/photo.jpg' }, null],
  ])('%o -> %s', (tags, file) => {
    expect(commonsFileFromTags(tags)).toBe(file)
  })
})

describe('findPlaceImage', () => {
  it('uses a Commons tag without further lookups', async () => {
    const fetch = byHost({
      'api.openstreetmap.org': () =>
        osm({ image: 'https://commons.wikimedia.org/wiki/File:A b.jpg' }),
    })
    const image = await findPlaceImage(fetch, 'W', 1)
    expect(image?.url).toMatch(/\/Special:FilePath\/A_b\.jpg\?width=640$/)
    expect(image?.source.label).toBe('Wikimedia Commons')
    expect(hosts(fetch)).toEqual(['api.openstreetmap.org'])
  })

  it("falls back to the Wikidata item's main image", async () => {
    const fetch = byHost({
      'api.openstreetmap.org': () => osm({ wikidata: 'Q19675' }),
      'www.wikidata.org': () =>
        Response.json({ claims: { P18: [{ mainsnak: { datavalue: { value: 'Louvre.jpg' } } }] } }),
    })
    expect((await findPlaceImage(fetch, 'R', 7515426))?.url).toMatch(/\/Louvre\.jpg\?width=640$/)
  })

  it("falls back to the website's og:image", async () => {
    const fetch = byHost({
      'api.openstreetmap.org': () => osm({ website: 'https://www.bistro.example/' }),
      'www.bistro.example': () => html('<meta property="og:image" content="/front.jpg">'),
    })
    const image = await findPlaceImage(fetch, 'N', 2)
    expect(image?.url).toBe('https://www.bistro.example/front.jpg')
    expect(image?.source.label).toBe('bistro.example')
  })

  it('is null when nothing is found, and remembers it', async () => {
    const fetch = byHost({ 'api.openstreetmap.org': () => osm({ name: 'Somewhere' }) })
    expect(await findPlaceImage(fetch, 'N', 3)).toBeNull()
    expect(await findPlaceImage(fetch, 'N', 3)).toBeNull()
    expect(hosts(fetch)).toEqual(['api.openstreetmap.org'])
  })

  it('forgets empty results after a while, but keeps found images', async () => {
    const fetch = byHost({ 'api.openstreetmap.org': () => osm({ name: 'Somewhere' }) })
    expect(await findPlaceImage(fetch, 'N', 4)).toBeNull()
    const later = Date.now() + EMPTY_RESULT_TTL_MS + 1000
    vi.spyOn(Date, 'now').mockReturnValue(later)
    expect(await findPlaceImage(fetch, 'N', 4)).toBeNull()
    // Looked up again once the empty result expired.
    expect(hosts(fetch)).toEqual(['api.openstreetmap.org', 'api.openstreetmap.org'])
  })
})

describe('unlinked Wikidata items', () => {
  // Fake OSM + Wikidata: search returns `hits`; items give lat, lon, image.
  function wikidata(hits: string[], items: Record<string, [number, number, string]>) {
    return fakeFetch((url) => {
      if (url.host === 'api.openstreetmap.org')
        return osm({ name: 'MUMASK', old_name: 'Musée du Carnaval' })
      const params = url.searchParams
      if (params.get('list') === 'search') {
        expect(params.get('srsearch')).toContain('nearcoord:')
        return Response.json({ query: { search: hits.map((title) => ({ title })) } })
      }
      const [lat, lon, image] = items[params.get('entity')!]
      const property = params.get('property')!
      const value = property === 'P625' ? { latitude: lat, longitude: lon } : image
      return Response.json({ claims: { [property]: [{ mainsnak: { datavalue: { value } } }] } })
    })
  }

  it('finds one by name near the place', async () => {
    const fetch = wikidata(['Q1', 'Q2'], {
      Q1: [50.412, 4.166, 'Far.jpg'], // ~300 m+ away: rejected
      Q2: [50.4094, 4.1661, 'Musee du masque.JPG'],
    })
    const image = await findPlaceImage(fetch, 'W', 1122654457, [50.4093, 4.166])
    expect(image?.url).toMatch(/\/Musee_du_masque\.JPG\?width=640$/)
  })

  it('ignores matches that are too far', async () => {
    const fetch = wikidata(['Q1'], { Q1: [50.42, 4.166, 'Elsewhere.jpg'] })
    expect(await findPlaceImage(fetch, 'W', 1122654457, [50.4093, 4.166])).toBeNull()
  })

  it('skips the search without a location', async () => {
    expect(await findPlaceImage(wikidata([], {}), 'W', 1122654457)).toBeNull()
  })
})

describe('/api/place-image', () => {
  const get = (path: string, fetch = fakeFetch(() => new Response(null, { status: 404 }))) =>
    handle(new Request(`https://stede.cc${path}`), fetch)

  it('validates the OSM reference', async () => {
    expect((await get('/api/place-image?osm_type=X&osm_id=1')).status).toBe(422)
    expect((await get('/api/place-image?osm_type=N&osm_id=0')).status).toBe(422)
    expect((await get('/api/place-image?osm_type=N')).status).toBe(422)
  })

  it('serves the image it found itself', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, ...new Array(1000).fill(48)])
    const fetch = byHost({
      'api.openstreetmap.org': () => osm({ image: 'https://img.example/storefront.jpg' }),
      'img.example': () => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } }),
    })
    const found = await (await get('/api/place-image?osm_type=N&osm_id=9', fetch)).json()
    // The real image URL, plus where browsers should load it from.
    expect(found.image.url).toBe('https://img.example/storefront.jpg')
    expect(found.image.display_url).toBe('/api/place-image/file?osm_type=N&osm_id=9')
    const file = await get(found.image.display_url, fetch)
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('image/jpeg')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(jpeg)
  })

  it('answers 404 for the file when the place has none', async () => {
    const fetch = fakeFetch(() => osm({ name: 'Nothing to see' }))
    expect((await get('/api/place-image/file?osm_type=N&osm_id=10', fetch)).status).toBe(404)
  })

  it('answers health checks, and 404 elsewhere', async () => {
    expect(await (await get('/api/health')).json()).toEqual({ status: 'ok' })
    expect((await get('/api/places')).status).toBe(404)
  })
})

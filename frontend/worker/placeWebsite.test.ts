import { describe, expect, it } from 'vitest'
import { fakeFetch } from './fakeFetch'
import { handle } from './index'
import { findPlaceWebsite, webUrl } from './placeWebsite'

const osm = (tags: Record<string, string>) =>
  fakeFetch(() => Response.json({ elements: [{ tags }] }))

describe('findPlaceWebsite', () => {
  it("reads the OSM element's website and menu", async () => {
    const fetch = osm({ website: 'bistro.example', 'website:menu': 'https://bistro.example/menu' })
    expect(await findPlaceWebsite(fetch, 'N', 2)).toEqual({
      url: 'https://bistro.example',
      menu: 'https://bistro.example/menu',
      source: { label: 'OpenStreetMap', href: 'https://www.openstreetmap.org/node/2' },
    })
  })

  it('falls back to contact:website', async () => {
    const found = await findPlaceWebsite(osm({ 'contact:website': 'https://a.example/' }), 'W', 3)
    expect(found?.url).toBe('https://a.example/')
    expect(found?.menu).toBeNull()
  })

  it('is null without a website or menu', async () => {
    expect(await findPlaceWebsite(osm({ name: 'Bistro', website: 'closed' }), 'N', 4)).toBeNull()
  })

  it('answers /api/place-website', async () => {
    const fetch = osm({ website: 'https://bistro.example/' })
    const response = await handle(
      new Request('https://stede.cc/api/place-website?osm_type=N&osm_id=2'),
      fetch,
    )
    expect(response.status).toBe(200)
    expect((await response.json()).website.url).toBe('https://bistro.example/')
    const bad = await handle(new Request('https://stede.cc/api/place-website?osm_type=X'), fetch)
    expect(bad.status).toBe(422)
  })
})

describe('webUrl', () => {
  it.each([
    ['https://www.bistro.example/', 'https://www.bistro.example/'],
    [' bistro.example/menu ', 'https://bistro.example/menu'],
    ['http://a.example;https://b.example', 'http://a.example'],
    ['javascript:alert(1)', null],
    ['mailto:hi@bistro.example', null],
    ['closed', null],
    ['', null],
  ])('%s -> %s', (value, url) => {
    expect(webUrl(value)).toBe(url)
  })
})

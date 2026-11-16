import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSearchCache, geocode, snapView, VIEW_GRID, type SearchResults } from './geocoder'

const EMPTY: SearchResults = { nearby: [], elsewhere: [] }

describe('snapView', () => {
  it('grows the view outward to the grid', () => {
    const snapped = snapView({ west: 2.2941, south: 48.8532, east: 2.2963, north: 48.8597 })
    expect(snapped.west).toBeCloseTo(2.29, 10)
    expect(snapped.south).toBeCloseTo(48.85, 10)
    expect(snapped.east).toBeCloseTo(2.3, 10)
    expect(snapped.north).toBeCloseTo(48.86, 10)
  })

  it('leaves a view already on the grid alone', () => {
    const view = { west: 2.29, south: 48.85, east: 2.3, north: 48.86 }
    const snapped = snapView(view)
    expect(snapped.west).toBeCloseTo(view.west, 10)
    expect(snapped.east).toBeCloseTo(view.east, 10)
  })

  it('never leaves the world', () => {
    const snapped = snapView({ west: -179.999, south: -89.999, east: 179.999, north: 89.999 })
    expect(snapped).toEqual({ west: -180, south: -90, east: 180, north: 90 })
  })

  it('gives the same view for small pans within a cell', () => {
    const a = snapView({ west: 2.291, south: 48.851, east: 2.298, north: 48.858 })
    const b = snapView({ west: 2.293, south: 48.853, east: 2.299, north: 48.859 })
    expect(a).toEqual(b)
    expect(VIEW_GRID).toBe(0.01)
  })
})

describe('geocode', () => {
  const fetchMock = vi.fn()
  const urlOf = (call: unknown[]) => new URL(call[0] as string, 'https://stede.cc')
  const toPhoton = (input: string | URL) => new URL(input, 'https://stede.cc').host === 'photon.komoot.io'
  const nothingFound = () => new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }))
  // Photon out of reach from the browser: the backend is asked.
  function photonDown(backend: () => Promise<Response>) {
    fetchMock.mockImplementation(async (input) =>
      toPhoton(input) ? new Response('', { status: 500 }) : backend(),
    )
  }

  beforeEach(() => {
    clearSearchCache()
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (input) =>
      toPhoton(input) ? nothingFound() : new Response(JSON.stringify(EMPTY), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('navigator', { language: 'fr' })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('asks Photon itself, near the snapped view and worldwide', async () => {
    const found = await geocode('tour eiffel', { view: { west: 2.2941, south: 48.8532, east: 2.2963, north: 48.8597 } })
    expect(found).toEqual(EMPTY)
    const urls = fetchMock.mock.calls.map(urlOf)
    expect(urls.map((url) => url.host)).toEqual(['photon.komoot.io', 'photon.komoot.io'])
    expect(urls.map((url) => url.searchParams.get('q'))).toEqual(['tour eiffel', 'tour eiffel'])
    expect(urls.map((url) => url.searchParams.get('lang'))).toEqual(['fr', 'fr'])
    // The snapped view (2.29,48.85,2.30,48.86) and its margin.
    expect(urls[0].searchParams.get('bbox')).toBe('2.28750,48.84750,2.30250,48.86250')
    expect(urls[1].searchParams.has('bbox')).toBe(false)
  })

  it('answers a repeated query from memory, even after a small pan', async () => {
    const view = { west: 2.2941, south: 48.8532, east: 2.2963, north: 48.8597 }
    const first = await geocode('tour eiffel', { view })
    const second = await geocode('tour eiffel', { view: { ...view, west: 2.2945, east: 2.2967 } })
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('asks again for a different query or a view in another cell', async () => {
    const view = { west: 2.2941, south: 48.8532, east: 2.2963, north: 48.8597 }
    await geocode('tour eiffel', { view })
    await geocode('tour eiffe', { view })
    await geocode('tour eiffel', { view: { ...view, west: 2.28 } })
    await geocode('tour eiffel')
    // Two requests with a view, one without.
    expect(fetchMock).toHaveBeenCalledTimes(7)
  })

  it('asks the backend when Photon gives no answer', async () => {
    photonDown(async () => new Response(JSON.stringify(EMPTY), { status: 200 }))
    const view = { west: 2.2941, south: 48.8532, east: 2.2963, north: 48.8597 }
    expect(await geocode('tour eiffel', { view })).toEqual(EMPTY)
    const url = urlOf(fetchMock.mock.calls.at(-1)!)
    expect(url.pathname).toBe('/api/search')
    expect(url.searchParams.get('q')).toBe('tour eiffel')
    expect(url.searchParams.get('lang')).toBe('fr')
    expect(url.searchParams.get('bbox')).toBe('2.29,48.85,2.30,48.86')
  })

  it('asks again when the backend is busy', async () => {
    let refusals = 2
    photonDown(async () =>
      refusals-- > 0
        ? new Response('', { status: 429, headers: { 'Retry-After': '0.01' } })
        : new Response(JSON.stringify(EMPTY), { status: 200 }),
    )
    expect(await geocode('tour eiffel')).toEqual(EMPTY)
    // Photon once, then the backend three times.
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('gives up when the backend stays busy', async () => {
    photonDown(async () => new Response('', { status: 429, headers: { 'Retry-After': '0.01' } }))
    await expect(geocode('tour eiffel')).rejects.toThrow('429')
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('stops waiting when the search is dropped', async () => {
    photonDown(async () => new Response('', { status: 429, headers: { 'Retry-After': '60' } }))
    const controller = new AbortController()
    const pending = geocode('tour eiffel', { signal: controller.signal })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not remember failures', async () => {
    photonDown(async () => new Response('', { status: 502 }))
    await expect(geocode('tour eiffel')).rejects.toThrow('502')
    fetchMock.mockImplementation(async () => nothingFound())
    await geocode('tour eiffel')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

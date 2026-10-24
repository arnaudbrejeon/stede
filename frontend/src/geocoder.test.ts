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

  beforeEach(() => {
    clearSearchCache()
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(EMPTY), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('navigator', { language: 'fr' })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('sends the snapped view with two decimals', async () => {
    await geocode('tour eiffel', { view: { west: 2.2941, south: 48.8532, east: 2.2963, north: 48.8597 } })
    const url = new URL(fetchMock.mock.calls[0][0], 'https://stede.cc')
    expect(url.pathname).toBe('/api/search')
    expect(url.searchParams.get('q')).toBe('tour eiffel')
    expect(url.searchParams.get('lang')).toBe('fr')
    expect(url.searchParams.get('bbox')).toBe('2.29,48.85,2.30,48.86')
  })

  it('answers a repeated query from memory, even after a small pan', async () => {
    const view = { west: 2.2941, south: 48.8532, east: 2.2963, north: 48.8597 }
    const first = await geocode('tour eiffel', { view })
    const second = await geocode('tour eiffel', { view: { ...view, west: 2.2945, east: 2.2967 } })
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('asks again for a different query or a view in another cell', async () => {
    const view = { west: 2.2941, south: 48.8532, east: 2.2963, north: 48.8597 }
    await geocode('tour eiffel', { view })
    await geocode('tour eiffe', { view })
    await geocode('tour eiffel', { view: { ...view, west: 2.28 } })
    await geocode('tour eiffel')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('does not remember failures', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('', { status: 502 }))
    await expect(geocode('tour eiffel')).rejects.toThrow('502')
    await geocode('tour eiffel')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

import { describe, expect, it } from 'vitest'
import { placeIdsByOsm, type Places } from './places'

const places: Places = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { id: 'a', name: 'Abbey', category: 'place_of_worship', tags: [], website: null, address: null, comment: null, osm_type: 'W', osm_id: 42 },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [1, 1] },
      properties: { id: 'b', name: 'A dropped pin', category: 'pin', tags: [], website: null, address: null, comment: null },
    },
  ],
}

describe('placeIdsByOsm', () => {
  it('maps each place that came from OpenStreetMap to its id', () => {
    const ids = placeIdsByOsm(places)
    expect(ids.get('W42')).toBe('a')
    expect(ids.size).toBe(1)
  })
})

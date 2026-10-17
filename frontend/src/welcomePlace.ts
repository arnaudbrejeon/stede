import type { Place, Places } from './places'

// Shown on an empty map, where it opens (see PlacesMap): Chaucer's grave in
// Westminster Abbey, the poet the name comes from (see AboutDialog). It's drawn
// by the app, not saved to your places, and goes away once you have your own.
export const WELCOME_PLACE: Place = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-0.127391, 51.499399] },
  properties: {
    id: 'stede:chaucer',
    name: 'Geoffrey Chaucer’s resting place',
    category: 'place_of_worship',
    category_key: 'amenity',
    tags: [],
    website: null,
    address: 'Poets’ Corner, Westminster Abbey, London',
    comment: 'Chaucer was buried here in 1400, the first poet laid in what became Poets’ Corner.',
    osm_type: 'W',
    osm_id: 364313092,
    icon: 'manuscript',
    builtin: true,
  },
}

// Your places, or the welcome place while you have none.
export function withWelcome(places: Places, loading: boolean): Places {
  if (places.features.length > 0 || loading) return places
  return { type: 'FeatureCollection', features: [WELCOME_PLACE] }
}

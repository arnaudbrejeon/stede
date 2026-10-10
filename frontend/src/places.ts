import type { Feature, FeatureCollection, Point } from 'geojson'
import type { PlaceIconKey } from './placeIcons'

export type PlaceProperties = {
  id: number
  name: string
  // OSM-style value (restaurant, museum…); picks the default icon.
  category: string
  tags: string[]
  website: string | null
  address: string | null
  // Your own note about the place.
  comment: string | null
  // The OpenStreetMap object it was matched to, typed as in search results (N/W/R).
  osm_type?: string
  osm_id?: number
  // Icon chosen for this place, overriding its category's default.
  icon?: PlaceIconKey
}

export type Place = Feature<Point, PlaceProperties>
export type Places = FeatureCollection<Point, PlaceProperties>

export const NO_PLACES: Places = { type: 'FeatureCollection', features: [] }

// Your saved places, served by the backend from data/mapstr.json.
export async function fetchPlaces(signal?: AbortSignal): Promise<Places> {
  const response = await fetch('/api/places', { signal })
  if (!response.ok) throw new Error(`Loading places failed: ${response.status}`)
  return response.json()
}

// Tags a place must all have; the tag filter is a list of these, any one of which may match.
export type TagLine = ReadonlySet<string>

// We filter in JS and push the result with setData(), so cluster counts stay
// correct (a layer filter would hide points but still count them in clusters).
export function filterPlaces(places: Places, query: string, tagLines: readonly TagLine[]): Places {
  const q = query.trim().toLowerCase()
  // An empty line would match everything, so it only counts when no line has tags.
  const lines = tagLines.filter((line) => line.size > 0)
  return {
    type: 'FeatureCollection',
    features: places.features.filter(({ properties: p }) => {
      if (q && !p.name.toLowerCase().includes(q)) return false
      if (lines.length === 0) return true
      return lines.some((line) => [...line].every((t) => p.tags.includes(t)))
    }),
  }
}

export function allTags(places: Places): string[] {
  return [...new Set(places.features.flatMap((f) => f.properties.tags))].sort()
}

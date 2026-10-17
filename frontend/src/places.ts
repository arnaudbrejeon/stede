import type { Feature, FeatureCollection, Point } from 'geojson'
import type { PlaceIconKey } from './placeIcons'
import { DEFAULT_TAGS } from './tags'

export type PlaceProperties = {
  // The place event's `d` tag.
  id: string
  name: string
  // OSM-style value (restaurant, museum…); picks the default icon.
  category: string
  // The OSM key the category is a value of (amenity, shop…).
  category_key?: string
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
  // Drawn by the app (see welcomePlace.ts), not one of your places.
  builtin?: boolean
}

export type Place = Feature<Point, PlaceProperties>
export type Places = FeatureCollection<Point, PlaceProperties>

export const NO_PLACES: Places = { type: 'FeatureCollection', features: [] }

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

// The labels in use: the built-in ones first in their own order, then yours A–Z.
export function allTags(places: Places): string[] {
  const used = new Set(places.features.flatMap((f) => f.properties.tags))
  const builtIn = DEFAULT_TAGS.filter((t) => used.has(t))
  return [...builtIn, ...[...used].filter((t) => !DEFAULT_TAGS.includes(t)).sort()]
}

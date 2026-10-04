import type { Feature, FeatureCollection, Point } from 'geojson'
import type { PlaceIconKey } from './placeIcons'

export type PlaceProperties = {
  id: number
  name: string
  // OSM-style value (restaurant, museum…); picks the default icon.
  category: string
  tags: string[]
  website: string | null
  // Icon chosen for this place, overriding its category's default.
  icon?: PlaceIconKey
}

export type Place = Feature<Point, PlaceProperties>
export type Places = FeatureCollection<Point, PlaceProperties>

function pt(
  id: number,
  name: string,
  category: string,
  tags: string[],
  lng: number,
  lat: number,
  website: string | null,
): Place {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [lng, lat] }, // GeoJSON order: [lng, lat]
    properties: { id, name, category, tags, website },
  }
}

// Sample data. Later: fetched from the backend at /api/places.
export const SAMPLE_PLACES: Places = {
  type: 'FeatureCollection',
  features: [
    pt(1, "Musée d'Orsay", 'museum', ['art', 'impressionism'], 2.3266, 48.86, 'https://www.musee-orsay.fr'),
    pt(2, 'Louvre', 'museum', ['art', 'must-see'], 2.3376, 48.8606, 'https://www.louvre.fr'),
    pt(3, 'Musée Rodin', 'museum', ['art', 'garden'], 2.3158, 48.8553, 'https://www.musee-rodin.fr'),
    pt(4, 'Le Comptoir du Relais', 'restaurant', ['bistro', 'french'], 2.3387, 48.8522, null),
    pt(5, 'Chez Janou', 'restaurant', ['provençal', 'terrace'], 2.3669, 48.8567, null),
    pt(6, 'Breizh Café', 'restaurant', ['crêpes', 'casual'], 2.362, 48.8612, null),
    pt(7, 'Hôtel des Grands Boulevards', 'hotel', ['boutique'], 2.348, 48.8703, null),
    pt(8, 'Le Pavillon de la Reine', 'hotel', ['luxury', 'garden'], 2.3658, 48.8559, null),
    pt(9, 'Le Syndicat', 'bar', ['cocktails', 'french'], 2.3548, 48.871, null),
    pt(10, 'Little Red Door', 'bar', ['cocktails', 'must-see'], 2.364, 48.8636, null),
  ],
}

// We filter in JS and push the result with setData(), so cluster counts stay
// correct (a layer filter would hide points but still count them in clusters).
export function filterPlaces(places: Places, query: string, tags: ReadonlySet<string>): Places {
  const q = query.trim().toLowerCase()
  return {
    type: 'FeatureCollection',
    features: places.features.filter(({ properties: p }) => {
      if (q && !p.name.toLowerCase().includes(q)) return false
      for (const t of tags) if (!p.tags.includes(t)) return false
      return true
    }),
  }
}

export function allTags(places: Places): string[] {
  return [...new Set(places.features.flatMap((f) => f.properties.tags))].sort()
}

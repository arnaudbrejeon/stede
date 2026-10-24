import type { Feature, Point } from 'geojson'

// Place search through our backend (/api/search), which proxies Photon
// (OpenStreetMap data) and splits results into those near the map view and the
// rest. Photon's public instance is fair-use only, so callers still debounce and
// cancel requests, and repeats are answered from caches here and in the browser
// (the backend's Cache-Control) rather than asked again.
const SEARCH_URL = '/api/search'

// Views are snapped outward to this grid (degrees, about 1 km) before they go
// into the request. The exact view only orders results, so a small pan between
// two identical queries yields the same URL: a hit in this session's cache, the
// browser's HTTP cache, or Cloudflare's.
export const VIEW_GRID = 0.01

// Results of this session's searches, keyed by their request query string.
// Typing then backspacing asks the same questions twice; this answers the second
// time for free. Bounded so a long session does not grow without end.
const SEARCH_CACHE_MAX = 200
const searchCache = new Map<string, SearchResults>()

export type PhotonProperties = {
  osm_id: number
  osm_type: string
  osm_key: string
  osm_value: string
  name?: string
  housenumber?: string
  street?: string
  postcode?: string
  locality?: string
  district?: string
  city?: string
  state?: string
  country?: string
  // ISO 3166-1 alpha-2, e.g. "FR".
  countrycode?: string
  // [minLon, maxLat, maxLon, minLat]
  extent?: [number, number, number, number]
  // From the centre of the view searched from (added by our backend).
  distance_m?: number
}

export type GeocodeResult = Feature<Point, PhotonProperties>

// The visible map area, in degrees.
export type MapView = { west: number; south: number; east: number; north: number }

export type SearchResults = { nearby: GeocodeResult[]; elsewhere: GeocodeResult[] }

type SearchOptions = {
  view?: MapView
  limit?: number
  signal?: AbortSignal
}

export async function geocode(query: string, options: SearchOptions = {}): Promise<SearchResults> {
  const key = searchParams(query, options).toString()
  const hit = searchCache.get(key)
  if (hit) return hit
  const response = await fetch(`${SEARCH_URL}?${key}`, { signal: options.signal })
  if (!response.ok) throw new Error(`Place search failed: ${response.status}`)
  const results: SearchResults = await response.json()
  remember(key, results)
  return results
}

function searchParams(query: string, options: SearchOptions): URLSearchParams {
  // The backend keeps the language only when the provider supports it.
  const params = new URLSearchParams({
    q: query,
    limit: String(options.limit ?? 6),
    lang: navigator.language,
  })
  if (options.view) {
    const { west, south, east, north } = snapView(options.view)
    params.set('bbox', [west, south, east, north].map((v) => v.toFixed(2)).join(','))
  }
  return params
}

// The smallest view on the VIEW_GRID grid that contains this one, within world
// bounds. Outward, so nothing visible falls out of the "nearby" results.
export function snapView(view: MapView, grid = VIEW_GRID): MapView {
  const down = (v: number) => Math.floor(v / grid) * grid
  const up = (v: number) => Math.ceil(v / grid) * grid
  return {
    west: Math.max(-180, down(view.west)),
    south: Math.max(-90, down(view.south)),
    east: Math.min(180, up(view.east)),
    north: Math.min(90, up(view.north)),
  }
}

function remember(key: string, results: SearchResults) {
  if (searchCache.size >= SEARCH_CACHE_MAX) {
    // Maps iterate in insertion order, so the first key is the oldest.
    const oldest = searchCache.keys().next().value
    if (oldest !== undefined) searchCache.delete(oldest)
  }
  searchCache.set(key, results)
}

// For tests.
export function clearSearchCache() {
  searchCache.clear()
}

// "12 Rue de Buci, Paris, France", or "Near <town>" away from streets; null
// when nothing is known around the point.
export async function fetchAddress([lon, lat]: [number, number], signal?: AbortSignal): Promise<string | null> {
  const params = new URLSearchParams({ lat: lat.toFixed(6), lon: lon.toFixed(6), lang: navigator.language })
  const response = await fetch(`/api/address?${params}`, { signal })
  if (!response.ok) throw new Error(`Address lookup failed: ${response.status}`)
  return (await response.json()).address
}

// "Tour Eiffel" / "5 Avenue Anatole France, Paris, France"
export function resultTitle(p: PhotonProperties): string {
  return p.name ?? streetLine(p) ?? p.city ?? p.country ?? 'Unnamed place'
}

// "Bus stop · Quai Jacques Chirac, Paris, France": the kind tells apart results
// that share a name (a landmark, its bus stop, its metro station).
export function resultSubtitle(p: PhotonProperties): string {
  const parts = [p.name ? streetLine(p) : undefined, p.city ?? p.locality, p.country]
  const title = resultTitle(p)
  const address = [...new Set(parts.filter((x): x is string => !!x && x !== title))].join(', ')
  const kind = resultKind(p)
  return kind ? `${kind} · ${address}` : address
}

// OSM tag value as a label, e.g. "bus_stop" -> "Bus stop". Skips the uninformative "yes".
function resultKind(p: PhotonProperties): string | undefined {
  const value = p.osm_value === 'yes' ? p.osm_key : p.osm_value
  if (!value) return undefined
  const words = value.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// "12 Rue de Buci, 75006 Paris, France": the address saved with a place.
export function streetAddress(p: PhotonProperties): string | null {
  const town = [p.postcode, p.city ?? p.locality].filter(Boolean).join(' ')
  const parts = [streetLine(p), town, p.country].filter((x): x is string => !!x)
  return parts.length ? parts.join(', ') : null
}

function streetLine(p: PhotonProperties): string | undefined {
  if (!p.street) return undefined
  return p.housenumber ? `${p.housenumber} ${p.street}` : p.street
}

export function resultKey(r: GeocodeResult): string {
  return `${r.properties.osm_type}${r.properties.osm_id}`
}

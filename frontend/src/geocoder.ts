import type { Feature, Point } from 'geojson'
import { addressAt, searchPlaces, View } from '../worker/geocoding'
import type { Fetch } from '../worker/http'

// Place search: Photon (OpenStreetMap data) asked by the browser itself, with
// results split into those near the map view and the rest (worker/geocoding.ts).
// Photon's public instance is fair-use only and counts by address, so asked from
// here each visitor has an allowance of their own; callers still debounce and
// cancel requests, and repeats are answered from this session's cache. When
// Photon can't be asked from here, our backend asks it instead (/api/search,
// the same code).
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

// The backend answers 429 while the searches it makes for everyone are at
// Photon's limit (worker/index.ts): the request is made again after the pause it
// names, this many times before giving up.
const BUSY_RETRIES = 3

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
  // From the centre of the view searched from (added by worker/geocoding.ts).
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
  const params = searchParams(query, options)
  const key = params.toString()
  const hit = searchCache.get(key)
  if (hit) return hit
  const bbox = params.get('bbox')
  const results = await orFromBackend(
    options.signal,
    `${SEARCH_URL}?${key}`,
    'Place search',
    (fetch) =>
      searchPlaces(fetch, query.trim(), {
        limit: Number(params.get('limit')),
        view: bbox ? View.parse(bbox) : undefined,
        lang: navigator.language,
      }) as Promise<unknown> as Promise<SearchResults>,
  )
  remember(key, results)
  return results
}

// What `direct` answers, asking Photon from the browser; when that fails, what
// our backend answers at `url`.
async function orFromBackend<T>(
  signal: AbortSignal | undefined,
  url: string,
  what: string,
  direct: (fetch: Fetch) => Promise<T>,
): Promise<T> {
  try {
    return await direct(droppedWith(signal))
  } catch (error) {
    if (signal?.aborted) throw signal.reason
    console.warn(`${what}: asking the backend, as Photon gave no answer`, error)
  }
  const response = await fetchWhenFree(url, signal)
  if (!response.ok) throw new Error(`${what} failed: ${response.status}`)
  return response.json()
}

// fetch, given up as soon as the caller's signal aborts, as well as on the
// request's own (worker/geocoding.ts sets a timeout).
function droppedWith(signal?: AbortSignal): Fetch {
  return (input, init = {}) => {
    const signals = [signal, init.signal].filter((s): s is AbortSignal => !!s)
    return fetch(input, { ...init, signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0] })
  }
}

async function fetchWhenFree(url: string, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { signal })
    if (response.status !== 429 || attempt === BUSY_RETRIES) return response
    await pause((Number(response.headers.get('Retry-After')) || 1) * 1000, signal)
  }
}

// Rejects as soon as the signal aborts, like fetch.
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const aborted = () => {
      clearTimeout(timer)
      reject(signal!.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', aborted)
      resolve()
    }, ms)
    signal?.addEventListener('abort', aborted, { once: true })
  })
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
  return orFromBackend(
    signal,
    `/api/address?${params}`,
    'Address lookup',
    async (fetch) => ({ address: await addressAt(fetch, lon, lat, navigator.language) }),
  ).then((answer) => answer.address)
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

// One string for an OpenStreetMap element, e.g. "N123" (type as Photon gives it).
export function osmRef(type: string, id: number): string {
  return `${type}${id}`
}

export function resultKey(r: GeocodeResult): string {
  return osmRef(r.properties.osm_type, r.properties.osm_id)
}

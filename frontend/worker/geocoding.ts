// Place search, proxied to Photon (https://photon.komoot.io, OpenStreetMap data).
//
// Kept behind our API so the provider, its parameters and its fair-use limits
// are managed in one place. Given the user's map view, results are split into
// places near that view and places elsewhere: Photon ranks mostly by text match,
// so a single query mixes continents (e.g. "eiffel tower" -> Paris, Canada,
// Brussels).

import { distanceM, type Fetch } from './http'

const PHOTON_URL = 'https://photon.komoot.io/api/'
const PHOTON_REVERSE_URL = 'https://photon.komoot.io/reverse'
// Photon's free server can take ten seconds at busy times: longer than other
// lookups are given (http.ts), since a late answer beats none.
const PHOTON_TIMEOUT_MS = 15_000
// A street or house within this many kilometres of a dropped pin is its address;
// further out (a mountain, a beach) the pin is described by the nearest town.
const ADDRESS_RADIUS_KM = 0.3
// Languages Photon accepts for result names; anything else is a 400 there.
const PHOTON_LANGS = new Set(['en', 'de', 'fr'])
// "Near" reaches this fraction of the view's size beyond each edge.
const VIEW_MARGIN = 0.25

export type Feature = {
  type: 'Feature'
  geometry: { type: string; coordinates: [number, number] }
  properties: Record<string, unknown>
}

// The provider failed or returned something unusable.
export class GeocodingError extends Error {}
// Photon is at its limit, by our count or by its own refusal (a 429): ask again
// shortly.
export class Busy extends GeocodingError {}

// The visible map area, in degrees.
export class View {
  readonly west: number
  readonly south: number
  readonly east: number
  readonly north: number

  constructor(west: number, south: number, east: number, north: number) {
    this.west = west
    this.south = south
    this.east = east
    this.north = north
  }

  // From "west,south,east,north"; throws when malformed.
  static parse(bbox: string): View {
    const parts = bbox.split(',').map((part) => (part.trim() === '' ? NaN : Number(part)))
    const [west, south, east, north] = parts
    if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) {
      throw new Error('bbox must be four numbers: west,south,east,north')
    }
    if (!(
      -180 <= west &&
      west < east &&
      east <= 180 &&
      -90 <= south &&
      south < north &&
      north <= 90
    )) {
      throw new Error('bbox must be west,south,east,north within world bounds')
    }
    return new View(west, south, east, north)
  }

  get center(): [number, number] {
    return [(this.west + this.east) / 2, (this.south + this.north) / 2]
  }

  padded(fraction = VIEW_MARGIN): View {
    const dx = (this.east - this.west) * fraction
    const dy = (this.north - this.south) * fraction
    return new View(
      Math.max(-180, this.west - dx),
      Math.max(-90, this.south - dy),
      Math.min(180, this.east + dx),
      Math.min(90, this.north + dy),
    )
  }

  contains(lon: number, lat: number): boolean {
    return this.west <= lon && lon <= this.east && this.south <= lat && lat <= this.north
  }

  asParam(): string {
    return [this.west, this.south, this.east, this.north].map((v) => v.toFixed(5)).join(',')
  }
}

type Params = Record<string, string | number | readonly string[]>

function photonLang(lang: string | null | undefined): Params {
  const code = lang?.slice(0, 2).toLowerCase()
  return code && PHOTON_LANGS.has(code) ? { lang: code } : {}
}

const round = (value: number, digits: number) => Number(value.toFixed(digits))

// {nearby, elsewhere}, each at most `limit` GeoJSON features. With a view, one
// Photon query is restricted to the (padded) view and one is worldwide but
// biased to its centre; they're merged without duplicates.
export async function searchPlaces(
  fetch: Fetch,
  query: string,
  { limit, view, lang }: { limit: number; view?: View; lang?: string | null },
): Promise<{ nearby: Feature[]; elsewhere: Feature[] }> {
  const common: Params = { q: query, ...photonLang(lang) }
  if (!view) return { nearby: [], elsewhere: await photon(fetch, { ...common, limit }) }

  const near = view.padded()
  const [lon, lat] = view.center
  const [local, worldwide] = await Promise.allSettled([
    photon(fetch, { ...common, limit, bbox: near.asParam() }),
    // More than `limit`: some of these will turn out to be near too.
    photon(fetch, { ...common, limit: limit * 2, lat: round(lat, 5), lon: round(lon, 5) }),
  ])
  if (local.status === 'rejected' && worldwide.status === 'rejected') {
    if (local.reason instanceof Busy || worldwide.reason instanceof Busy)
      throw new Busy('place search is busy')
    throw new GeocodingError('place search is unavailable')
  }

  const nearby: Feature[] = []
  const elsewhere: Feature[] = []
  const seen = new Set<string>()
  for (const feature of [
    ...(local.status === 'fulfilled' ? local.value : []),
    ...(worldwide.status === 'fulfilled' ? worldwide.value : []),
  ]) {
    const key = `${feature.properties.osm_type}/${feature.properties.osm_id}`
    if (seen.has(key)) continue
    seen.add(key)
    const [fLon, fLat] = feature.geometry.coordinates
    feature.properties.distance_m = Math.round(distanceM(lat, lon, fLat, fLon))
    ;(near.contains(fLon, fLat) ? nearby : elsewhere).push(feature)
  }
  return { nearby: nearby.slice(0, limit), elsewhere: elsewhere.slice(0, limit) }
}

// A readable address for a point on the map, e.g. for a dropped pin:
// "12 Rue de Buci, Paris, France" when a house or street is close by, else
// "Near Grand Canyon Village, Arizona, United States"; null when Photon knows
// nothing around.
export async function addressAt(
  fetch: Fetch,
  lon: number,
  lat: number,
  lang?: string | null,
): Promise<string | null> {
  const common: Params = { lat: round(lat, 6), lon: round(lon, 6), limit: 1, ...photonLang(lang) }
  const close = await photon(
    fetch,
    { ...common, layer: ['house', 'street'], radius: ADDRESS_RADIUS_KM },
    PHOTON_REVERSE_URL,
  )
  if (close.length) {
    const p = close[0].properties as Record<string, string | undefined>
    let street = p.street || (p.type === 'street' ? p.name : undefined)
    if (street && p.housenumber) street = `${p.housenumber} ${street}`
    return join(
      street,
      // Out of town, a path or road is placed by its county or state.
      p.city || p.locality || p.district || p.county || p.state,
      p.country,
    )
  }
  const around = await photon(fetch, common, PHOTON_REVERSE_URL)
  if (!around.length) return null
  const p = around[0].properties as Record<string, string | undefined>
  const place = join(p.name || p.city, p.state, p.country)
  return place ? `Near ${place}` : null
}

// The parts that are there, each once, comma-separated.
function join(...parts: (string | undefined)[]): string | null {
  const kept = [...new Set(parts.filter((part): part is string => !!part))]
  return kept.join(', ') || null
}

async function photon(fetch: Fetch, params: Params, url = PHOTON_URL): Promise<Feature[]> {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    // A list is the same parameter repeated: layer=house&layer=street.
    for (const v of Array.isArray(value) ? value : [value]) search.append(key, String(v))
  }
  let data: { type?: string; features?: Feature[] }
  try {
    const response = await fetch(`${url}?${search}`, {
      signal: AbortSignal.timeout(PHOTON_TIMEOUT_MS),
    })
    if (response.status === 429) throw new Busy('place search is busy')
    if (!response.ok) {
      // Shown by `wrangler tail`: why Photon refused.
      console.warn(`Photon answered ${response.status}: ${(await response.text()).slice(0, 300)}`)
      throw new Error(`HTTP ${response.status}`)
    }
    data = await response.json()
  } catch (error) {
    if (error instanceof Busy) throw error
    throw new GeocodingError('place search is unavailable')
  }
  if (data?.type !== 'FeatureCollection')
    throw new GeocodingError('unexpected response from place search')
  return (data.features ?? []).filter((f) => f?.geometry?.type === 'Point')
}

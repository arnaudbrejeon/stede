// stede.cc on Cloudflare: the built app is static assets, served by Cloudflare
// directly; this worker answers /api/* (see wrangler.jsonc). In development the
// Vite dev server runs it for /api too (vite.config.ts).

import { addressAt, GeocodingError, searchPlaces, View } from './geocoding'
import { withDefaults, type Fetch } from './http'
import { OSM_TYPES, type OsmType } from './osm'
import { findPlaceImage } from './placeImage'
import { findPlaceWebsite } from './placeWebsite'
import { fetchImage } from './websiteImage'

type Context = { waitUntil(promise: Promise<unknown>): void }

// How long Cloudflare (and browsers) may keep each kind of answer.
const DAY = 86400
const SEARCH_MAX_AGE = 3600
// Finding nothing may be a passing failure: ask again sooner.
const EMPTY_MAX_AGE = 600

export default {
  fetch(request: Request, _env: unknown, ctx: Context): Promise<Response> {
    return handle(request, withDefaults(fetch), ctx)
  },
}

class BadRequest extends Error {}

const json = (body: unknown, status = 200, maxAge?: number) =>
  Response.json(body, {
    status,
    headers: maxAge ? { 'Cache-Control': `public, max-age=${maxAge}` } : {},
  })

export async function handle(request: Request, fetch: Fetch, ctx?: Context): Promise<Response> {
  const url = new URL(request.url)
  if (request.method !== 'GET') return json({ detail: 'method not allowed' }, 405)
  const route = ROUTES[url.pathname]
  if (!route) return json({ detail: 'not found' }, 404)
  try {
    return await cached(request, ctx, () => route(url.searchParams, fetch))
  } catch (error) {
    if (error instanceof BadRequest) return json({ detail: error.message }, 422)
    if (error instanceof GeocodingError) return json({ detail: error.message }, 502)
    return json({ detail: 'lookup is unavailable' }, 502)
  }
}

// Answers kept in Cloudflare's cache when they say they may be (Cache-Control),
// so the same search or image isn't asked of Photon or Wikimedia twice.
async function cached(request: Request, ctx: Context | undefined, answer: () => Promise<Response>) {
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default
  if (!cache || !ctx) return answer()
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await answer()
  if (response.ok && response.headers.has('Cache-Control'))
    ctx.waitUntil(cache.put(request, response.clone()))
  return response
}

const ROUTES: Record<string, (params: URLSearchParams, fetch: Fetch) => Promise<Response>> = {
  '/api/health': async () => json({ status: 'ok' }),

  // Places matching the query, split into those near the map view and the rest.
  // Each list holds GeoJSON features with a `distance_m` property (from the
  // view's centre) when a view is given.
  '/api/search': async (params, fetch) => {
    const q = text(params, 'q', { min: 1, max: 200 })!
    const limit = integer(params, 'limit', { min: 1, max: 10 }) ?? 6
    const bbox = text(params, 'bbox', { max: 100, optional: true })
    const lang = text(params, 'lang', { max: 16, optional: true })
    let view: View | undefined
    try {
      view = bbox ? View.parse(bbox) : undefined
    } catch (error) {
      throw new BadRequest((error as Error).message)
    }
    return json(await searchPlaces(fetch, q.trim(), { limit, view, lang }), 200, SEARCH_MAX_AGE)
  },

  // The address of a point on the map (a dropped pin), or null when unknown.
  '/api/address': async (params, fetch) => {
    const lat = number(params, 'lat', { min: -90, max: 90 })!
    const lon = number(params, 'lon', { min: -180, max: 180 })!
    const lang = text(params, 'lang', { max: 16, optional: true })
    return json({ address: await addressAt(fetch, lon, lat, lang) }, 200, DAY)
  },

  // An image for an OpenStreetMap place, or null when none can be found. The
  // place's location, when given, lets unlinked places be matched on Wikidata.
  '/api/place-image': async (params, fetch) => {
    const [osmType, osmId] = osmRef(params)
    const lat = number(params, 'lat', { min: -90, max: 90, optional: true })
    const lon = number(params, 'lon', { min: -180, max: 180, optional: true })
    const near: [number, number] | undefined =
      lat !== undefined && lon !== undefined ? [lat, lon] : undefined
    const image = await findPlaceImage(fetch, osmType, osmId, near)
    if (!image) return json({ image: null }, 200, EMPTY_MAX_AGE)
    // Browsers load it through /api/place-image/file: third-party sites may block
    // them (hotlink protection, bot challenges, plain http) yet answer us.
    const display_url = `/api/place-image/file?${new URLSearchParams({ osm_type: osmType, osm_id: String(osmId) })}`
    return json({ image: { ...image, display_url } }, 200, DAY)
  },

  // The website (and menu) of an OpenStreetMap place, or null when none is found.
  '/api/place-website': async (params, fetch) => {
    const [osmType, osmId] = osmRef(params)
    const website = await findPlaceWebsite(fetch, osmType, osmId)
    return json({ website }, 200, website ? DAY : EMPTY_MAX_AGE)
  },

  // The image found for a place, fetched and served by us. Only ever serves the
  // image the lookup chose, never an arbitrary URL.
  '/api/place-image/file': async (params, fetch) => {
    const [osmType, osmId] = osmRef(params)
    const image = await findPlaceImage(fetch, osmType, osmId)
    if (!image) return json({ detail: 'no image for this place' }, 404)
    const fetched = await fetchImage(image.url, fetch)
    if (!fetched) return json({ detail: 'image is unavailable' }, 502)
    const [body, mediaType] = fetched
    return new Response(body, {
      headers: { 'Content-Type': mediaType, 'Cache-Control': `public, max-age=${DAY}` },
    })
  },
}

// Query parameters, checked; a BadRequest (422) when wrong or missing.

type Bounds = { min?: number; max?: number; optional?: boolean }

function present(params: URLSearchParams, name: string, optional?: boolean): string | undefined {
  const value = params.get(name)
  if (value === null) {
    if (optional) return undefined
    throw new BadRequest(`${name} is required`)
  }
  return value
}

function text(
  params: URLSearchParams,
  name: string,
  { min = 0, max, optional }: Bounds,
): string | undefined {
  const value = present(params, name, optional)
  if (value === undefined) return undefined
  if (value.length < min || (max !== undefined && value.length > max)) {
    throw new BadRequest(`${name} must be ${min} to ${max} characters`)
  }
  return value
}

function number(
  params: URLSearchParams,
  name: string,
  { min, max, optional }: Bounds,
): number | undefined {
  const raw = present(params, name, optional)
  if (raw === undefined) return undefined
  const value = raw.trim() === '' ? NaN : Number(raw)
  if (!Number.isFinite(value)) throw new BadRequest(`${name} must be a number`)
  if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
    throw new BadRequest(`${name} must be between ${min} and ${max}`)
  }
  return value
}

function integer(params: URLSearchParams, name: string, bounds: Bounds): number | undefined {
  const raw = params.get(name)
  if (raw !== null && !/^[+-]?\d+$/.test(raw.trim()))
    throw new BadRequest(`${name} must be an integer`)
  return number(params, name, { optional: true, ...bounds })
}

function osmRef(params: URLSearchParams): [OsmType, number] {
  const osmType = present(params, 'osm_type') as OsmType
  if (!OSM_TYPES.includes(osmType)) throw new BadRequest('osm_type must be N, W or R')
  const osmId = integer(params, 'osm_id', { min: 1, optional: false })
  if (osmId === undefined) throw new BadRequest('osm_id is required')
  return [osmType, osmId]
}

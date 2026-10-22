// Find an image for an OpenStreetMap place.
//
// Tries, in order:
// 1. a Wikimedia Commons file named by the OSM `image` or `wikimedia_commons` tags;
// 2. the main image (P18) of the Wikidata item linked by the `wikidata` tag;
// 3. otherwise, of a Wikidata item found by the place's names near its location
//    (most OSM objects aren't linked, even when Wikidata knows the place);
// 4. a direct image URL in `image`;
// 5. the website's preview image, or failing that the largest photo on its page.
// Results are cached in memory, for as long as Cloudflare keeps the worker.

import { distanceM, type Fetch } from './http'
import { fetchOsmTags, type OsmType, type Tags } from './osm'
import { findWebsiteImage } from './websiteImage'

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'
const THUMB_WIDTH = 640
const CACHE_SIZE = 1024
// Finding nothing may be a transient failure (timeouts, bot challenges): retry later.
export const EMPTY_RESULT_TTL_MS = 10 * 60 * 1000
// Wikidata search radius, then how close an item's own coordinates must be.
const WIKIDATA_SEARCH_RADIUS = '500m'
const WIKIDATA_MAX_DISTANCE_M = 300
const NAME_TAGS = ['name', 'name:en', 'official_name', 'old_name', 'alt_name']

// e.g. https://fr.wikipedia.org/wiki/Fichier:Tour_Eiffel.jpg or .../wiki/File:X.jpg
const FILE_PAGE = /\/wiki\/[^/:]+:([^/?#]+)$/
// Characters with a meaning in Wikidata's search syntax.
const SEARCH_SYNTAX = /["':()[\]{}~*?!^\\/|&+-]/g
const DIRECT_IMAGE = /^https?:\/\/.+\.(jpe?g|png|webp|gif)(\?.*)?$/i

export type PlaceImage = {
  // Where the image lives; what to keep when a place is saved.
  url: string
  // Shown next to the image as credit.
  source: { label: string; href: string }
}

type LatLon = [number, number]

// "N/123" -> the image, and when it was found.
const cache = new Map<string, [PlaceImage | null, number]>()

export function clearCache() {
  cache.clear()
}

export async function findPlaceImage(
  fetch: Fetch,
  osmType: OsmType,
  osmId: number,
  near?: LatLon,
): Promise<PlaceImage | null> {
  const key = `${osmType}/${osmId}`
  const cached = cache.get(key)
  if (cached && (cached[0] !== null || Date.now() - cached[1] < EMPTY_RESULT_TTL_MS)) {
    cache.delete(key)
    cache.set(key, cached)
    return cached[0]
  }
  const tags = await fetchOsmTags(fetch, osmType, osmId)
  const image = await imageFromTags(fetch, tags, near)
  cache.delete(key)
  cache.set(key, [image, Date.now()])
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
  return image
}

async function imageFromTags(fetch: Fetch, tags: Tags, near?: LatLon): Promise<PlaceImage | null> {
  let file = commonsFileFromTags(tags)
  if (!file && tags.wikidata) file = await wikidataImage(fetch, tags.wikidata)
  if (!file && !tags.wikidata && near)
    file = await wikidataImageNearby(fetch, placeNames(tags), near)
  if (file) return commonsImage(file)

  const image = tags.image ?? ''
  if (DIRECT_IMAGE.test(image))
    return { url: image, source: { label: hostname(image), href: image } }

  const website = tags.website || tags['contact:website']
  if (website) {
    let url: string | null = null
    try {
      url = await findWebsiteImage(website, fetch)
    } catch {
      // An unsafe address, or a site that doesn't answer.
    }
    if (url) return { url, source: { label: hostname(website), href: website } }
  }
  return null
}

function placeNames(tags: Tags): string[] {
  const names: string[] = []
  for (const key of NAME_TAGS) {
    for (const name of (tags[key] ?? '').split(';')) {
      if (name.trim() && !names.includes(name.trim())) names.push(name.trim())
    }
  }
  return names
}

async function wikidata(fetch: Fetch, params: Record<string, string>): Promise<any> {
  const response = await fetch(
    `${WIKIDATA_API}?${new URLSearchParams({ ...params, format: 'json' })}`,
  )
  if (!response.ok) throw new Error(`Wikidata answered ${response.status}`)
  return response.json()
}

// Main image of the closest Wikidata item matching a name, if close enough.
async function wikidataImageNearby(
  fetch: Fetch,
  names: string[],
  [lat, lon]: LatLon,
): Promise<string | null> {
  const ids: string[] = []
  for (const name of names) {
    const query = name.replace(SEARCH_SYNTAX, ' ').trim()
    if (!query) continue
    try {
      const data = await wikidata(fetch, {
        action: 'query',
        list: 'search',
        srsearch: `${query} nearcoord:${WIKIDATA_SEARCH_RADIUS},${lat},${lon}`,
        srlimit: '3',
      })
      for (const hit of data?.query?.search ?? []) if (!ids.includes(hit.title)) ids.push(hit.title)
    } catch {
      continue
    }
  }

  const candidate = async (item: string): Promise<[number, string] | null> => {
    const claims = await wikidataClaims(fetch, item, ['P625', 'P18'])
    const coords = claims.P625?.[0]?.mainsnak?.datavalue?.value
    const image = claims.P18?.[0]?.mainsnak?.datavalue?.value
    if (!coords || typeof image !== 'string') return null
    const distance = distanceM(lat, lon, coords.latitude, coords.longitude)
    return distance <= WIKIDATA_MAX_DISTANCE_M ? [distance, image] : null
  }
  const found = (await Promise.all(ids.slice(0, 5).map(candidate))).filter((c) => c !== null)
  found.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
  return found[0]?.[1] ?? null
}

async function wikidataClaims(
  fetch: Fetch,
  item: string,
  properties: string[],
): Promise<Record<string, any>> {
  let claims: Record<string, any> = {}
  for (const property of properties) {
    try {
      const data = await wikidata(fetch, { action: 'wbgetclaims', entity: item, property })
      claims = { ...claims, ...(data?.claims ?? {}) }
    } catch {
      // Missing claims mean no candidate.
    }
  }
  return claims
}

export function commonsFileFromTags(tags: Tags): string | null {
  const match = (tags.image ?? '').match(FILE_PAGE)
  if (match) {
    try {
      return decodeURIComponent(match[1])
    } catch {
      return match[1]
    }
  }
  const commons = tags.wikimedia_commons ?? ''
  // A Category: names many images, not one.
  return commons.startsWith('File:') ? commons.slice('File:'.length) : null
}

async function wikidataImage(fetch: Fetch, item: string): Promise<string | null> {
  try {
    const data = await wikidata(fetch, { action: 'wbgetclaims', entity: item, property: 'P18' })
    const value = data?.claims?.P18?.[0]?.mainsnak?.datavalue?.value
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

// Like Python's urllib.parse.quote: "/" and unreserved characters stay as they are.
function quote(text: string): string {
  return encodeURIComponent(text)
    .replace(/%2F/g, '/')
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

function commonsImage(file: string): PlaceImage {
  const name = quote(file.replaceAll(' ', '_'))
  return {
    url: `https://commons.wikimedia.org/wiki/Special:FilePath/${name}?width=${THUMB_WIDTH}`,
    source: { label: 'Wikimedia Commons', href: `https://commons.wikimedia.org/wiki/File:${name}` },
  }
}

function hostname(url: string): string {
  let host = url
  try {
    host = new URL(url).hostname || url
  } catch {
    // Not a URL: show it as it is.
  }
  return host.replace(/^www\./, '')
}

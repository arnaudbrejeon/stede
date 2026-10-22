// Find a place's website (and its menu's).
//
// For now from the OpenStreetMap element's `website` or `contact:website`, and
// `website:menu`. Later, other sources can be tried in turn: the website (P856)
// of a linked Wikidata item, or a search by name near the place for places
// without an OSM element.

import type { Fetch } from './http'
import { fetchOsmTags, osmPage, type OsmType } from './osm'

export type PlaceWebsite = {
  // null when no website is found (a menu may still be).
  url: string | null
  menu: string | null
  // Where it was found, shown next to it.
  source: { label: string; href: string }
}

export async function findPlaceWebsite(
  fetch: Fetch,
  osmType: OsmType,
  osmId: number,
): Promise<PlaceWebsite | null> {
  const tags = await fetchOsmTags(fetch, osmType, osmId)
  const url = webUrl(tags.website || tags['contact:website'] || '')
  const menu = webUrl(tags['website:menu'] || '')
  if (!url && !menu) return null
  return { url, menu, source: { label: 'OpenStreetMap', href: osmPage(osmType, osmId) } }
}

// A website as tagged ("bistro.fr", "https://a.fr;https://b.fr"): its first
// http(s) URL, with https:// added when there's no scheme. null when it isn't
// a web address. (The app reads typed websites the same way: src/placeEvents.ts.)
export function webUrl(value: string): string | null {
  const first = value.split(';')[0].trim()
  if (!first || /\s/.test(first)) return null
  const url = /^[a-z][a-z\d+.-]*:/i.test(first) ? first : `https://${first}`
  try {
    const { protocol, hostname } = new URL(url)
    return (protocol === 'http:' || protocol === 'https:') && hostname.includes('.') ? url : null
  } catch {
    return null
  }
}

// An OpenStreetMap element's tags, from the OSM API.

import type { Fetch } from './http'

const OSM_API = 'https://api.openstreetmap.org/api/0.6'
export const OSM_ELEMENT_TYPES = { N: 'node', W: 'way', R: 'relation' } as const

export type OsmType = keyof typeof OSM_ELEMENT_TYPES
export const OSM_TYPES = Object.keys(OSM_ELEMENT_TYPES) as OsmType[]
export type Tags = Record<string, string>

export async function fetchOsmTags(fetch: Fetch, osmType: OsmType, osmId: number): Promise<Tags> {
  const response = await fetch(`${OSM_API}/${OSM_ELEMENT_TYPES[osmType]}/${osmId}.json`)
  if (response.status === 404 || response.status === 410) return {} // unknown or deleted
  if (!response.ok) throw new Error(`OpenStreetMap answered ${response.status}`)
  const elements = (await response.json()).elements ?? [{}]
  return elements[0]?.tags ?? {}
}

// The element's page on openstreetmap.org.
export function osmPage(osmType: OsmType, osmId: number): string {
  return `https://www.openstreetmap.org/${OSM_ELEMENT_TYPES[osmType]}/${osmId}`
}

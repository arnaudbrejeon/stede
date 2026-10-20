// Full OpenStreetMap tags for a Photon result (hours, phone, website, wikidata…).
// The OSM API allows browser requests; one call per picked result.
const OSM_API = 'https://api.openstreetmap.org/api/0.6'
const ELEMENT_TYPES: Record<string, string> = { N: 'node', W: 'way', R: 'relation' }

export type OsmTags = Record<string, string>

export async function fetchOsmTags(
  osmType: string,
  osmId: number,
  signal?: AbortSignal,
): Promise<OsmTags> {
  const type = ELEMENT_TYPES[osmType]
  if (!type) return {}
  const response = await fetch(`${OSM_API}/${type}/${osmId}.json`, { signal })
  if (!response.ok) throw new Error(`OSM lookup failed: ${response.status}`)
  const data: { elements: { tags?: OsmTags }[] } = await response.json()
  return data.elements[0]?.tags ?? {}
}

// The place's website as OSM tags it, if any.
export function osmWebsite(tags: OsmTags): string | undefined {
  return tags.website || tags['contact:website'] || undefined
}

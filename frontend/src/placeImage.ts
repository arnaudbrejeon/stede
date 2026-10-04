// The backend decides where a place's image comes from; we only ask for it.
export type PlaceImage = {
  // Where the image lives; keep this when saving a place.
  url: string
  // What to show: the same image served by our backend, which works where the
  // original site blocks browsers.
  display_url: string
  // Where the image comes from, linked next to it for credit.
  source: { label: string; href: string }
}

export async function fetchPlaceImage(
  osmType: string,
  osmId: number,
  // The place's location lets the backend match places OSM doesn't link to Wikidata.
  [lng, lat]: [number, number],
  signal?: AbortSignal,
): Promise<PlaceImage | null> {
  const params = new URLSearchParams({
    osm_type: osmType,
    osm_id: String(osmId),
    lat: lat.toFixed(6),
    lon: lng.toFixed(6),
  })
  const response = await fetch(`/api/place-image?${params}`, { signal })
  if (!response.ok) return null
  const data: { image: PlaceImage | null } = await response.json()
  return data.image
}

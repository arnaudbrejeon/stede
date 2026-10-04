// The backend decides where a place's image comes from; we only ask for it.
export type PlaceImage = {
  url: string
  // Where the image comes from, linked next to it for credit.
  source: { label: string; href: string }
}

export async function fetchPlaceImage(
  osmType: string,
  osmId: number,
  signal?: AbortSignal,
): Promise<PlaceImage | null> {
  const params = new URLSearchParams({ osm_type: osmType, osm_id: String(osmId) })
  const response = await fetch(`/api/place-image?${params}`, { signal })
  if (!response.ok) return null
  const data: { image: PlaceImage | null } = await response.json()
  return data.image
}

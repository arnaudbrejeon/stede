// The backend finds a place's website; we only ask for it. A website you set
// yourself (the place's `r` tag) is shown instead, and then this isn't asked.
export type PlaceWebsite = {
  // null when only a menu was found.
  url: string | null
  menu: string | null
  // Where it was found, shown next to it.
  source: { label: string; href: string }
}

export async function fetchPlaceWebsite(
  osmType: string,
  osmId: number,
  signal?: AbortSignal,
): Promise<PlaceWebsite | null> {
  const params = new URLSearchParams({ osm_type: osmType, osm_id: String(osmId) })
  const response = await fetch(`/api/place-website?${params}`, { signal })
  if (!response.ok) return null
  const data: { website: PlaceWebsite | null } = await response.json()
  return data.website
}

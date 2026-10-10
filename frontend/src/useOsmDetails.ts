import { useEffect, useState } from 'react'
import { fetchOsmTags, type OsmTags } from './osm'
import { fetchPlaceImage, type PlaceImage } from './placeImage'

export type OsmDetailsState = {
  tags: OsmTags
  // The tag lookup failed (the image has its own empty state).
  failed: boolean
  // undefined while loading, null when the place has no image.
  image: PlaceImage | null | undefined
}

// An OpenStreetMap object's details and an image when one can be found. Both
// load independently; the image lookup is the slower one. Without an OSM object
// there's nothing to load. Render with a `key` per place so switching places
// never shows the previous one's details.
export function useOsmDetails(
  osmType: string | undefined,
  osmId: number | undefined,
  [lng, lat]: [number, number],
): OsmDetailsState {
  const [tags, setTags] = useState<OsmTags>({})
  const [failed, setFailed] = useState(false)
  const [image, setImage] = useState<PlaceImage | null | undefined>(osmType ? undefined : null)

  useEffect(() => {
    if (!osmType || !osmId) return
    const controller = new AbortController()
    const { signal } = controller
    fetchOsmTags(osmType, osmId, signal).then(setTags, (err) => {
      if (signal.aborted) return
      console.error(err)
      setFailed(true)
    })
    fetchPlaceImage(osmType, osmId, [lng, lat], signal).then(setImage, () => {
      if (!signal.aborted) setImage(null)
    })
    return () => controller.abort()
  }, [osmType, osmId, lng, lat])

  return { tags, failed, image }
}

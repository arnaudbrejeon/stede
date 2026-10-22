import { useEffect, useState } from 'react'
import { fetchOsmTags, type OsmTags } from './osm'
import { fetchPlaceImage, type PlaceImage } from './placeImage'
import { fetchPlaceWebsite, type PlaceWebsite } from './placeWebsite'

export type OsmDetailsState = {
  tags: OsmTags
  // The tag lookup failed (the image has its own empty state).
  failed: boolean
  // undefined while loading, null when the place has no image.
  image: PlaceImage | null | undefined
  // The website found for it: undefined while loading, null when none (or not asked).
  website: PlaceWebsite | null | undefined
}

// An OpenStreetMap object's details, and an image and website when they can be
// found. Each loads independently; the image lookup is the slowest.
// `findWebsite` is false when the place has a website of its own. Without an OSM object
// there's nothing to load. Render with a `key` per place so switching places
// never shows the previous one's details.
export function useOsmDetails(
  osmType: string | undefined,
  osmId: number | undefined,
  [lng, lat]: [number, number],
  findWebsite = true,
): OsmDetailsState {
  const [tags, setTags] = useState<OsmTags>({})
  const [failed, setFailed] = useState(false)
  const [image, setImage] = useState<PlaceImage | null | undefined>(osmType ? undefined : null)
  const [website, setWebsite] = useState<PlaceWebsite | null | undefined>(
    osmType && findWebsite ? undefined : null,
  )

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

  useEffect(() => {
    if (!osmType || !osmId || !findWebsite) return
    const controller = new AbortController()
    const { signal } = controller
    fetchPlaceWebsite(osmType, osmId, signal).then(setWebsite, () => {
      if (!signal.aborted) setWebsite(null)
    })
    return () => controller.abort()
  }, [osmType, osmId, findWebsite])

  return { tags, failed, image, website }
}

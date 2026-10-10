import type { Place } from '../places'
import { tagColor, type TagColors } from '../tags'
import { useOsmDetails } from '../useOsmDetails'
import { OsmFacts, OsmImage } from './OsmDetails'

type PlaceDetailsProps = {
  place: Place
  tagColors: TagColors
}

// Render with a `key` per place (see useOsmDetails).
export function PlaceDetails({ place, tagColors }: PlaceDetailsProps) {
  const p = place.properties
  // Places matched to OpenStreetMap get its image, hours, website…
  const coordinates = place.geometry.coordinates as [number, number]
  const { tags, failed, image } = useOsmDetails(p.osm_type, p.osm_id, coordinates)
  const osmWebsite = tags.website ?? tags['contact:website']
  return (
    <>
      <h2>{p.name}</h2>
      {p.category && <p className="drawer-category">{p.category.replaceAll('_', ' ')}</p>}
      {p.address && <p className="drawer-address">{p.address}</p>}
      <OsmImage image={image} alt={p.name} />
      {p.tags.length > 0 && (
        <ul className="drawer-tags">
          {p.tags.map((tag) => (
            <li key={tag}>
              <span className="swatch" style={{ background: tagColor(tagColors, tag) }} />
              {tag}
            </li>
          ))}
        </ul>
      )}
      {p.comment && <p className="drawer-comment">{p.comment}</p>}
      <OsmFacts tags={tags} failed={failed} />
      {!osmWebsite && p.website && (
        <a href={p.website} target="_blank" rel="noopener">
          Website
        </a>
      )}
    </>
  )
}

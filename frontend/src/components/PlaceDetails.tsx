import type { Place } from '../places'
import { tagColor, type TagColors } from '../tags'

type PlaceDetailsProps = {
  place: Place
  tagColors: TagColors
}

export function PlaceDetails({ place, tagColors }: PlaceDetailsProps) {
  const p = place.properties
  return (
    <>
      <h2>{p.name}</h2>
      <p className="drawer-category">{p.category}</p>
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
      {p.website && (
        <a href={p.website} target="_blank" rel="noopener">
          Website
        </a>
      )}
    </>
  )
}

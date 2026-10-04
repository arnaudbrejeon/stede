import { useEffect, type Ref } from 'react'
import type { Place } from '../places'
import { tagColor, type TagColors } from '../tags'

type PlaceDrawerProps = {
  place: Place | null
  onClose: () => void
  tagColors: TagColors
  ref?: Ref<HTMLElement>
}

// Slides up from the bottom on small portrait screens and in from the right
// otherwise; the placement is handled entirely in CSS.
export function PlaceDrawer({ place, onClose, tagColors, ref }: PlaceDrawerProps) {
  useEffect(() => {
    if (!place) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [place, onClose])

  const p = place?.properties

  return (
    <aside
      ref={ref}
      className={`drawer${place ? ' open' : ''}`}
      aria-label="Place details"
      aria-hidden={!place}
      inert={!place}
    >
      <div className="drawer-handle" aria-hidden="true" />
      <button type="button" className="drawer-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
      {p && (
        <div className="drawer-body">
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
        </div>
      )}
    </aside>
  )
}

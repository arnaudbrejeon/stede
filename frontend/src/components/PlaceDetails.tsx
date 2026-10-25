import { useState } from 'react'
import { appleMapsUrl, googleMapsUrl } from '../mapLinks'
import { draftFromPlace, type UserFields } from '../placeEvents'
import type { Place } from '../places'
import type { PlaceWebsite } from '../placeWebsite'
import { deletePlace, savePlace } from '../placeStore'
import { tagColor, tagLabel, type TagColors } from '../tags'
import { useOsmDetails } from '../useOsmDetails'
import { OsmFacts, OsmImage } from './OsmDetails'
import { PlaceFields } from './PlaceFields'

type PlaceDetailsProps = {
  place: Place
  tagColors: TagColors
  // Labels used across your places, offered while editing.
  allLabels: readonly string[]
  onDeleted: () => void
}

// Render with a `key` per place (see useOsmDetails).
export function PlaceDetails({ place, tagColors, allLabels, onDeleted }: PlaceDetailsProps) {
  const p = place.properties
  // Places matched to OpenStreetMap get its image, hours, website…
  const coordinates = place.geometry.coordinates as [number, number]
  // A website of your own needn't be looked for.
  const { tags, failed, image, website } = useOsmDetails(
    p.osm_type,
    p.osm_id,
    coordinates,
    !p.website,
  )
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const remove = async () => {
    if (!window.confirm(`Delete “${p.name}” from your places?`)) return
    setDeleting(true)
    setError(null)
    try {
      await deletePlace(p.id)
      onDeleted()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setDeleting(false)
    }
  }

  if (editing)
    return (
      <PlaceEditor
        place={place}
        foundWebsite={website?.url}
        tagColors={tagColors}
        allLabels={allLabels}
        onDone={() => setEditing(false)}
      />
    )

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
              {tagLabel(tag)}
            </li>
          ))}
        </ul>
      )}
      {p.comment && <p className="drawer-comment">{p.comment}</p>}
      <OsmFacts
        tags={tags}
        failed={failed}
        found={website}
        own={p.website}
        where={{ lngLat: coordinates }}
      />
      <MapLinks lngLat={coordinates} name={p.name} />
      {p.builtin ? (
        <p className="builtin-note">
          Stede’s first place, until you have your own: tap + to add one.
        </p>
      ) : (
        <div className="place-actions">
          <button type="button" className="key-button with-icon" onClick={() => setEditing(true)}>
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path
                d="M12.5 4.5l3 3M4 16l.7-3.6L13.2 4a1.4 1.4 0 0 1 2 0l.8.8a1.4 1.4 0 0 1 0 2L7.6 15.3Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Edit
          </button>
          <button type="button" className="danger-button" disabled={deleting} onClick={remove}>
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path
                d="M3.5 5.5h13M8 5.5V3.75h4V5.5M5 5.5l.8 10.2a1.5 1.5 0 0 0 1.5 1.3h5.4a1.5 1.5 0 0 0 1.5-1.3L15 5.5M8.25 8.5v5.5M11.75 8.5v5.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {deleting ? 'Deleting…' : 'Delete place'}
          </button>
          {error && <p className="key-error">{error}</p>}
        </div>
      )}
    </>
  )
}

type PlaceEditorProps = {
  place: Place
  // The website found for it, as a hint when it has none of its own.
  foundWebsite: PlaceWebsite['url'] | undefined
  tagColors: TagColors
  allLabels: readonly string[]
  onDone: () => void
}

// Your own data on a saved place: its name, icon, labels, website and comment.
function PlaceEditor({ place, foundWebsite, tagColors, allLabels, onDone }: PlaceEditorProps) {
  const p = place.properties
  const [name, setName] = useState(p.name)
  const [fields, setFields] = useState<UserFields>({
    labels: p.tags,
    note: p.comment ?? '',
    icon: p.icon,
    website: p.website ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await savePlace({ ...draftFromPlace(place), name, ...fields })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <div className="place-editor">
      <h2>Edit place</h2>
      <div className="place-fields">
        <label className="field">
          Name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <PlaceFields
        value={fields}
        onChange={setFields}
        category={p.category}
        categoryKey={p.category_key}
        foundWebsite={foundWebsite}
        allLabels={allLabels}
        tagColors={tagColors}
      />
      <div className="place-actions row">
        <button
          type="button"
          className="key-button"
          disabled={saving || !name.trim()}
          onClick={save}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="link-button" disabled={saving} onClick={onDone}>
          Cancel
        </button>
      </div>
      {error && <p className="key-error">{error}</p>}
    </div>
  )
}

// The place in other maps, opened in a new tab (on a phone, the maps app).
function MapLinks({ lngLat, name }: { lngLat: [number, number]; name: string }) {
  const links = [
    { label: 'Apple Maps', href: appleMapsUrl(lngLat, name) },
    { label: 'Google Maps', href: googleMapsUrl(lngLat) },
  ]
  return (
    <p className="map-links">
      {links.map((l) => (
        <a key={l.label} className="map-link" href={l.href} target="_blank" rel="noopener">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <path
              d="M10 2.5a5 5 0 0 0-5 5c0 3.6 5 9.5 5 9.5s5-5.9 5-9.5a5 5 0 0 0-5-5Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <circle cx="10" cy="7.5" r="1.8" fill="currentColor" />
          </svg>
          {l.label}
        </a>
      ))}
    </p>
  )
}

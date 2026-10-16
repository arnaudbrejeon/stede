import { useEffect, useState } from 'react'
import { fetchAddress } from '../geocoder'
import { NO_USER_FIELDS } from '../placeEvents'
import type { Place } from '../places'
import type { TagColors } from '../tags'
import { PlaceFields } from './PlaceFields'
import type { LngLat } from './PlacesMap'
import { SavePlaceButton } from './SavePlaceButton'

type PinDetailsProps = {
  point: LngLat
  onBack: () => void
  onSaved: (place: Place) => void
  allLabels: readonly string[]
  tagColors: TagColors
}

type Address = { point: LngLat; text: string | null; failed?: boolean }

// A spot dropped on the map while adding a place: where it is, with the
// nearest address when there is one. The pin can be dragged to adjust it.
export function PinDetails({ point, onBack, onSaved, allLabels, tagColors }: PinDetailsProps) {
  // Tagged with its point, so a moved pin shows "Finding…" until its own answer.
  const [address, setAddress] = useState<Address | null>(null)
  const [name, setName] = useState('')
  const [fields, setFields] = useState(NO_USER_FIELDS)
  const [lon, lat] = point

  useEffect(() => {
    const controller = new AbortController()
    fetchAddress(point, controller.signal)
      .then((text) => setAddress({ point, text }))
      .catch((error) => {
        if (controller.signal.aborted) return
        console.error(error)
        setAddress({ point, text: null, failed: true })
      })
    return () => controller.abort()
  }, [point])

  const current = address?.point === point ? address : null
  const description =
    current === null
      ? 'Finding the address…'
      : (current.text ?? (current.failed ? 'Address unavailable right now' : 'No address here'))

  return (
    <div className="result-details">
      <button type="button" className="link-button" onClick={onBack}>
        ← Back to search
      </button>
      <h3>Dropped pin</h3>
      <p className="result-subtitle">{description}</p>
      <dl className="result-facts">
        <dt>Position</dt>
        <dd>
          {lat.toFixed(5)}, {lon.toFixed(5)}
        </dd>
      </dl>
      <p className="search-note">Drag the pin, or tap elsewhere, to move it.</p>
      <div className="place-fields">
        <label className="field">
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What is here?"
          />
        </label>
      </div>
      <PlaceFields value={fields} onChange={setFields} allLabels={allLabels} tagColors={tagColors} />
      <SavePlaceButton
        draft={
          name.trim() ? { name, lngLat: point, address: current?.text ?? null, ...fields } : null
        }
        onSaved={onSaved}
      />
    </div>
  )
}

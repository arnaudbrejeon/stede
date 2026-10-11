import { useEffect, useState } from 'react'
import { fetchAddress } from '../geocoder'
import type { LngLat } from './PlacesMap'

type PinDetailsProps = {
  point: LngLat
  onBack: () => void
}

type Address = { point: LngLat; text: string | null; failed?: boolean }

// A spot dropped on the map while adding a place: where it is, with the
// nearest address when there is one. The pin can be dragged to adjust it.
export function PinDetails({ point, onBack }: PinDetailsProps) {
  // Tagged with its point, so a moved pin shows "Finding…" until its own answer.
  const [address, setAddress] = useState<Address | null>(null)
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
    </div>
  )
}

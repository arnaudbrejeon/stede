import { resultSubtitle, resultTitle, streetAddress, type GeocodeResult } from '../geocoder'
import { useState } from 'react'
import { NO_USER_FIELDS } from '../placeEvents'
import type { Place } from '../places'
import type { TagColors } from '../tags'
import { useOsmDetails } from '../useOsmDetails'
import { OsmFacts, OsmImage } from './OsmDetails'
import { PlaceFields } from './PlaceFields'
import { SavePlaceButton } from './SavePlaceButton'

type ResultDetailsProps = {
  result: GeocodeResult
  onBack: () => void
  onSaved: (place: Place) => void
  allLabels: readonly string[]
  tagColors: TagColors
}

// What we know about a search result before saving it: Photon's name and
// address, plus the OSM object's details and an image when one can be found.
export function ResultDetails({ result, onBack, onSaved, allLabels, tagColors }: ResultDetailsProps) {
  const p = result.properties
  const coordinates = result.geometry.coordinates as [number, number]
  const { tags, failed, image } = useOsmDetails(p.osm_type, p.osm_id, coordinates)
  const [fields, setFields] = useState(NO_USER_FIELDS)

  return (
    <div className="result-details">
      <button type="button" className="link-button" onClick={onBack}>
        ← Back to results
      </button>

      <OsmImage image={image} alt={resultTitle(p)} />

      <h3>{resultTitle(p)}</h3>
      <p className="result-subtitle">{resultSubtitle(p)}</p>

      <OsmFacts tags={tags} failed={failed} />

      <PlaceFields
        value={fields}
        onChange={setFields}
        category={p.osm_value}
        categoryKey={p.osm_key}
        allLabels={allLabels}
        tagColors={tagColors}
      />

      <SavePlaceButton
        draft={{
          name: resultTitle(p),
          lngLat: coordinates,
          osmKey: p.osm_key,
          osmValue: p.osm_value,
          osmType: p.osm_type,
          osmId: p.osm_id,
          address: streetAddress(p),
          ...fields,
        }}
        onSaved={onSaved}
      />
    </div>
  )
}

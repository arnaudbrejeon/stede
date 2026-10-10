import { resultSubtitle, resultTitle, type GeocodeResult } from '../geocoder'
import { useOsmDetails } from '../useOsmDetails'
import { OsmFacts, OsmImage } from './OsmDetails'

type ResultDetailsProps = {
  result: GeocodeResult
  onBack: () => void
}

// What we know about a search result before saving it: Photon's name and
// address, plus the OSM object's details and an image when one can be found.
export function ResultDetails({ result, onBack }: ResultDetailsProps) {
  const p = result.properties
  const coordinates = result.geometry.coordinates as [number, number]
  const { tags, failed, image } = useOsmDetails(p.osm_type, p.osm_id, coordinates)

  return (
    <div className="result-details">
      <button type="button" className="link-button" onClick={onBack}>
        ← Back to results
      </button>

      <OsmImage image={image} alt={resultTitle(p)} />

      <h3>{resultTitle(p)}</h3>
      <p className="result-subtitle">{resultSubtitle(p)}</p>

      <OsmFacts tags={tags} failed={failed} />
    </div>
  )
}

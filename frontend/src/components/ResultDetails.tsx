import { useEffect, useState } from 'react'
import { resultSubtitle, resultTitle, type GeocodeResult } from '../geocoder'
import { fetchOsmTags, type OsmTags } from '../osm'
import { fetchPlaceImage, type PlaceImage } from '../placeImage'

type ResultDetailsProps = {
  result: GeocodeResult
  onBack: () => void
}

// What we know about a search result before saving it: Photon's name and
// address, plus the OSM object's details and an image when one can be found.
export function ResultDetails({ result, onBack }: ResultDetailsProps) {
  const [tags, setTags] = useState<OsmTags>({})
  const [failed, setFailed] = useState(false)
  // undefined while loading, null when the place has no image.
  const [image, setImage] = useState<PlaceImage | null | undefined>(undefined)
  const p = result.properties

  // Details and image load independently; the image lookup is the slower one.
  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    fetchOsmTags(p.osm_type, p.osm_id, signal).then(setTags, (err) => {
      if (signal.aborted) return
      console.error(err)
      setFailed(true)
    })
    fetchPlaceImage(p.osm_type, p.osm_id, signal).then(setImage, () => {
      if (!signal.aborted) setImage(null)
    })
    return () => controller.abort()
  }, [p.osm_type, p.osm_id])

  const imageState = image === undefined ? 'loading' : image ? 'ready' : 'none'

  return (
    <div className="result-details">
      <button type="button" className="link-button" onClick={onBack}>
        ← Back to results
      </button>

      <figure className={`result-image ${imageState}`}>
        {image ? (
          <>
            <img src={image.url} alt={resultTitle(p)} />
            <figcaption>
              <a href={image.source.href} target="_blank" rel="noopener">
                {image.source.label}
              </a>
            </figcaption>
          </>
        ) : (
          <span aria-hidden="true" />
        )}
      </figure>

      <h3>{resultTitle(p)}</h3>
      <p className="result-subtitle">{resultSubtitle(p)}</p>

      <dl className="result-facts">
        {tags.cuisine && <Fact label="Cuisine">{tags.cuisine.split(';').join(', ')}</Fact>}
        {tags.opening_hours && <Fact label="Hours">{tags.opening_hours}</Fact>}
        {(tags.phone ?? tags['contact:phone']) && (
          <Fact label="Phone">
            <a href={`tel:${(tags.phone ?? tags['contact:phone']).replace(/\s/g, '')}`}>
              {tags.phone ?? tags['contact:phone']}
            </a>
          </Fact>
        )}
        {(tags.website ?? tags['contact:website']) && (
          <Fact label="Website">
            <a href={tags.website ?? tags['contact:website']} target="_blank" rel="noopener">
              {hostname(tags.website ?? tags['contact:website'])}
            </a>
          </Fact>
        )}
        {tags.description && <Fact label="About">{tags.description}</Fact>}
      </dl>
      {failed && <p className="search-note">More details are unavailable right now.</p>}
    </div>
  )
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

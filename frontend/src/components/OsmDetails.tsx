import type { ReactNode } from 'react'
import type { PlaceImage } from '../placeImage'
import type { OsmDetailsState } from '../useOsmDetails'

export function OsmImage({ image, alt }: { image: PlaceImage | null | undefined; alt: string }) {
  const imageState = image === undefined ? 'loading' : image ? 'ready' : 'none'
  return (
    <figure className={`result-image ${imageState}`}>
      {image ? (
        <>
          <img src={image.display_url} alt={alt} />
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
  )
}

export function OsmFacts({ tags, failed }: Pick<OsmDetailsState, 'tags' | 'failed'>) {
  const phone = tags.phone ?? tags['contact:phone']
  const website = tags.website ?? tags['contact:website']
  return (
    <>
      <dl className="result-facts">
        {tags.cuisine && <Fact label="Cuisine">{tags.cuisine.split(';').join(', ')}</Fact>}
        {tags.opening_hours && <Fact label="Hours">{tags.opening_hours}</Fact>}
        {phone && (
          <Fact label="Phone">
            <a href={`tel:${phone.replace(/\s/g, '')}`}>{phone}</a>
          </Fact>
        )}
        {website && (
          <Fact label="Website">
            <a href={website} target="_blank" rel="noopener">
              {hostname(website)}
            </a>
          </Fact>
        )}
        {tags.description && <Fact label="About">{tags.description}</Fact>}
      </dl>
      {failed && <p className="search-note">More details are unavailable right now.</p>}
    </>
  )
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

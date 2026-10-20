import type { ReactNode } from 'react'
import { osmWebsite } from '../osm'
import { webUrl } from '../placeEvents'
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

type OsmFactsProps = Pick<OsmDetailsState, 'tags' | 'failed'> & {
  // A saved place's own website, shown instead of OSM's.
  website?: string | null
}

export function OsmFacts({ tags, failed, website: own }: OsmFactsProps) {
  const phone = tags.phone ?? tags['contact:phone']
  const website = webUrl(own || osmWebsite(tags) || '')
  const menu = webUrl(tags['website:menu'] ?? '')
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
        {menu && (
          <Fact label="Menu">
            <a href={menu} target="_blank" rel="noopener">
              {hostname(menu)}
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

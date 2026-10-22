import type { ReactNode } from 'react'
import type { Where } from '../openingHours'
import { webUrl } from '../placeEvents'
import type { PlaceWebsite } from '../placeWebsite'
import type { PlaceImage } from '../placeImage'
import { useOpeningHours } from '../useOpeningHours'
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
  // The website found for the place.
  found: PlaceWebsite | null | undefined
  // A saved place's own website, shown instead of the one found.
  own?: string | null
  // Where the place is, to tell whether it's open now.
  where: Where
}

export function OsmFacts({ tags, failed, found, own, where }: OsmFactsProps) {
  const phone = tags.phone ?? tags['contact:phone']
  const ownUrl = own ? webUrl(own) : null
  const website = ownUrl ?? found?.url
  const menu = found?.menu
  return (
    <>
      <dl className="result-facts">
        {tags.cuisine && <Fact label="Cuisine">{tags.cuisine.split(';').join(', ')}</Fact>}
        {tags.opening_hours && (
          <Fact label="Hours">
            <Hours value={tags.opening_hours} where={where} />
          </Fact>
        )}
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
            {!ownUrl && found && <FoundIn source={found.source} />}
          </Fact>
        )}
        {menu && (
          <Fact label="Menu">
            <a href={menu} target="_blank" rel="noopener">
              {hostname(menu)}
            </a>
            {found && <FoundIn source={found.source} />}
          </Fact>
        )}
        {tags.description && <Fact label="About">{tags.description}</Fact>}
      </dl>
      {failed && <p className="search-note">More details are unavailable right now.</p>}
    </>
  )
}

// Whether the place is open now, then its hours as OpenStreetMap writes them.
function Hours({ value, where }: { value: string; where: Where }) {
  const now = useOpeningHours(value, where)
  return (
    <>
      {now && (
        <span className={`hours-status ${now.state}`}>
          <span className="swatch" aria-hidden="true" />
          {now.label}
        </span>
      )}
      <span className={now ? 'hours-value' : undefined}>{value}</span>
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

// Where a website was found, since it isn't always right.
function FoundIn({ source }: { source: PlaceWebsite['source'] }) {
  return (
    <span className="fact-source">
      {' · '}
      <a href={source.href} target="_blank" rel="noopener">
        {source.label}
      </a>
    </span>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

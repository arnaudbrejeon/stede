import { useEffect, useId, useRef, useState } from 'react'
import {
  geocode,
  resultKey,
  resultSubtitle,
  resultTitle,
  type GeocodeResult,
  type MapView,
  type SearchResults,
} from '../geocoder'
import { PinDetails } from './PinDetails'
import type { Place } from '../places'
import type { TagColors } from '../tags'
import type { LngLat } from './PlacesMap'
import { ResultDetails } from './ResultDetails'

const MIN_CHARS = 3
const DEBOUNCE_MS = 300

type AddPlaceSearchProps = {
  getView: () => MapView | undefined
  onPick: (result: GeocodeResult) => void
  // Hovering or arrowing onto a result.
  onPreview: (result: GeocodeResult) => void
  // A spot tapped on the map, shown in place of the search.
  pin: LngLat | null
  onClearPin: () => void
  onSaved: (place: Place) => void
  // Chosen to drop a pin rather than search (shown on phones, where the map is
  // behind the drawer).
  onPinInstead: () => void
  allLabels: readonly string[]
  tagColors: TagColors
}

type Status = 'idle' | 'loading' | 'done' | 'error'

const NO_RESULTS: SearchResults = { nearby: [], elsewhere: [] }
const GROUPS = [
  { key: 'nearby', label: 'Near this map' },
  { key: 'elsewhere', label: 'Elsewhere' },
] as const

// Drawer content for finding a new place: a search field with the results listed
// below it, or a pin dropped on the map. Arrow keys move through results, Enter
// picks one. On phones the drawer covers the map (see index.css), so dropping
// a pin is offered as a row: it closes the drawer until the map is tapped.
export function AddPlaceSearch({
  getView,
  onPick,
  onPreview,
  pin,
  onClearPin,
  onSaved,
  onPinInstead,
  allLabels,
  tagColors,
}: AddPlaceSearchProps) {
  const [text, setText] = useState('')
  const [found, setFound] = useState<SearchResults>(NO_RESULTS)
  const [status, setStatus] = useState<Status>('idle')
  const [active, setActive] = useState(-1)
  // The result whose details are shown in place of the list.
  const [picked, setPicked] = useState<GeocodeResult | null>(null)
  const getViewRef = useRef(getView)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  // A new pin replaces the result being shown (its marker is gone from the map).
  const [shownPin, setShownPin] = useState(pin)
  if (pin !== shownPin) {
    setShownPin(pin)
    if (pin) setPicked(null)
  }

  // Ready to type as it opens; on phones that brings up the keyboard under the
  // search. Not when it opens on a dropped pin: that shows the pin's details.
  // Focus without scrolling: the drawer is still sliding in, and a plain focus
  // (or autoFocus) can scroll its container to reveal the field, shifting the map.
  useEffect(() => {
    if (!pin) inputRef.current?.focus({ preventScroll: true })
  }, [pin])

  useEffect(() => {
    getViewRef.current = getView
  }, [getView])

  // Photon's public server is fair-use only: one request per pause in typing
  // (DEBOUNCE_MS), none for short or whitespace-only edits, and the previous
  // request is dropped as soon as the query changes.
  const query = text.trim()
  useEffect(() => {
    // Shorter queries just hide the list (see showList); stale results stay unseen.
    if (query.length < MIN_CHARS) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setStatus('loading')
      try {
        const next = await geocode(query, { view: getViewRef.current(), signal: controller.signal })
        setFound(next)
        setActive(next.nearby.length + next.elsewhere.length ? 0 : -1)
        setStatus('done')
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error(err)
          setStatus('error')
        }
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  // Keyboard order runs through the nearby group, then elsewhere.
  const results = [...found.nearby, ...found.elsewhere]
  const groups = GROUPS.map((g) => ({ ...g, items: found[g.key] })).filter((g) => g.items.length)
  // Headings only when there really are two lists.
  const split = groups.length > 1

  const pick = (result: GeocodeResult) => {
    setPicked(result)
    onPick(result)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && results.length) {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      const next = (active + step + results.length) % results.length
      setActive(next)
      onPreview(results[next])
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault()
      pick(results[active])
    }
  }

  const showList = query.length >= MIN_CHARS && status !== 'idle'
  const searching = !pin && !picked

  return (
    <div className={`add-search${searching ? ' searching' : ''}`}>
      <h2>Add a place</h2>
      <div className="search-bar">
        <input
          type="search"
          ref={inputRef}
          role="combobox"
          placeholder="Search an address or place"
          aria-label="Search an address or place"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setPicked(null)
            onClearPin()
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {pin ? (
        <PinDetails
          point={pin}
          onSaved={onSaved}
          allLabels={allLabels}
          tagColors={tagColors}
          onBack={() => {
            onClearPin()
            inputRef.current?.focus({ preventScroll: true })
          }}
        />
      ) : picked ? (
        <ResultDetails
          key={resultKey(picked)}
          result={picked}
          onSaved={onSaved}
          allLabels={allLabels}
          tagColors={tagColors}
          onBack={() => {
            setPicked(null)
            inputRef.current?.focus({ preventScroll: true })
          }}
        />
      ) : !showList ? (
        <p className="search-note search-hint">Or tap the map to drop a pin.</p>
      ) : (
        <div className="search-results" id={listId} role="listbox" aria-label="Search results">
          {status === 'loading' && !results.length && <p className="search-note">Searching…</p>}
          {status === 'error' && <p className="search-note">Search is unavailable right now.</p>}
          {status === 'done' && !results.length && <p className="search-note">No results.</p>}
          {groups.map((group) => (
            <div
              key={group.key}
              role={split ? 'group' : undefined}
              aria-labelledby={split ? `${listId}-${group.key}` : undefined}
            >
              {split && (
                <div className="search-group" id={`${listId}-${group.key}`} role="presentation">
                  {group.label}
                </div>
              )}
              {group.items.map((r) => {
                const i = results.indexOf(r)
                return (
                  <div
                    key={resultKey(r)}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className="search-result"
                    onMouseEnter={() => {
                      setActive(i)
                      onPreview(r)
                    }}
                    onClick={() => pick(r)}
                  >
                    <span className="search-title">{resultTitle(r.properties)}</span>
                    <span className="search-subtitle">{resultSubtitle(r.properties)}</span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
      {searching && (
        <button type="button" className="pin-instead" onClick={onPinInstead}>
          Drop a pin on the map instead
        </button>
      )}
    </div>
  )
}

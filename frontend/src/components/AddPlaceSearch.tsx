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
import { ResultDetails } from './ResultDetails'

const MIN_CHARS = 3
const DEBOUNCE_MS = 300

type AddPlaceSearchProps = {
  getView: () => MapView | undefined
  onPick: (result: GeocodeResult) => void
  // Hovering or arrowing onto a result.
  onPreview: (result: GeocodeResult) => void
}

type Status = 'idle' | 'loading' | 'done' | 'error'

const NO_RESULTS: SearchResults = { nearby: [], elsewhere: [] }
const GROUPS = [
  { key: 'nearby', label: 'Near this map' },
  { key: 'elsewhere', label: 'Elsewhere' },
] as const

// Drawer content for finding a new place: a search field with the results listed
// below it. Arrow keys move through results, Enter picks one.
export function AddPlaceSearch({ getView, onPick, onPreview }: AddPlaceSearchProps) {
  const [text, setText] = useState('')
  const [found, setFound] = useState<SearchResults>(NO_RESULTS)
  const [status, setStatus] = useState<Status>('idle')
  const [active, setActive] = useState(-1)
  // The result whose details are shown in place of the list.
  const [picked, setPicked] = useState<GeocodeResult | null>(null)
  const getViewRef = useRef(getView)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  // Ready to type with a physical keyboard. On touch screens focusing would pop
  // up the on-screen keyboard over the sheet, so there you tap the field first.
  // Focus without scrolling: the drawer is still sliding in, and a plain focus
  // (or autoFocus) can scroll its container to reveal the field, shifting the map.
  useEffect(() => {
    if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    getViewRef.current = getView
  }, [getView])

  useEffect(() => {
    const query = text.trim()
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
  }, [text])

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

  const showList = text.trim().length >= MIN_CHARS && status !== 'idle'

  return (
    <div className="add-search">
      <h2>Add a place</h2>
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
        }}
        onKeyDown={onKeyDown}
      />
      {picked ? (
        <ResultDetails
          key={resultKey(picked)}
          result={picked}
          onBack={() => {
            setPicked(null)
            inputRef.current?.focus({ preventScroll: true })
          }}
        />
      ) : (
        showList && (
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
        )
      )}
    </div>
  )
}

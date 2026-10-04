import { useCallback, useMemo, useRef, useState } from 'react'
import { AddPlaceSearch } from './components/AddPlaceSearch'
import { Drawer } from './components/Drawer'
import { FilterPanel } from './components/FilterPanel'
import { Header } from './components/Header'
import { PlaceDetails } from './components/PlaceDetails'
import { PlacesMap, type PlacesMapHandle } from './components/PlacesMap'
import type { GeocodeResult } from './geocoder'
import { allTags, filterPlaces, SAMPLE_PLACES } from './places'
import { buildTagColors } from './tags'

function App() {
  const [query, setQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<ReadonlySet<string>>(new Set())
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // Browsing your places is the default; searching for a new one is opt-in.
  const [searching, setSearching] = useState(false)
  const drawerRef = useRef<HTMLElement>(null)
  const mapRef = useRef<PlacesMapHandle>(null)

  const tags = useMemo(() => allTags(SAMPLE_PLACES), [])
  const tagColors = useMemo(() => buildTagColors(tags), [tags])
  const filtered = useMemo(
    () => filterPlaces(SAMPLE_PLACES, query, selectedTags),
    [query, selectedTags],
  )
  // Looked up in the filtered set, so the drawer closes when filters hide the place.
  const selected = searching
    ? null
    : (filtered.features.find((f) => f.properties.id === selectedId) ?? null)
  const drawerOpen = searching || selected !== null

  const openSearch = () => {
    setSelectedId(null)
    setSearching(true)
  }
  const closeDrawer = useCallback(() => {
    setSelectedId(null)
    setSearching(false)
    mapRef.current?.clearLocation()
  }, [])
  // Clicking a place leaves search for its details; clicking empty map while
  // searching keeps the search open, since that's usually looking around.
  const selectOnMap = useCallback((id: number | null) => {
    if (id === null) return setSelectedId(null)
    setSearching(false)
    mapRef.current?.clearLocation()
    setSelectedId(id)
  }, [])

  const getMapView = useCallback(() => mapRef.current?.getView(), [])
  const showSearchResult = useCallback(
    (result: GeocodeResult) => mapRef.current?.showLocation(result),
    [],
  )
  const previewSearchResult = useCallback(
    (result: GeocodeResult) => mapRef.current?.previewLocation(result),
    [],
  )

  const toggleTag = (tag: string) =>
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (!next.delete(tag)) next.add(tag)
      return next
    })

  return (
    <div className={`app${drawerOpen ? ' drawer-open' : ''}`}>
      <Header />
      <main className="main">
        <PlacesMap
          ref={mapRef}
          places={filtered}
          selectedId={selected?.properties.id ?? null}
          onSelect={selectOnMap}
          drawerOpen={drawerOpen}
            tagColors={tagColors}
          overlayRef={drawerRef}
        />
        {/* Filters are for browsing your places; out of the way while adding one. */}
        {!searching && (
          <FilterPanel
            query={query}
            onQueryChange={setQuery}
            tags={tags}
            selectedTags={selectedTags}
            onToggleTag={toggleTag}
            tagColors={tagColors}
          />
        )}
        {!searching && (
          <button
            type="button"
            className="add-place"
            aria-label="Add a place"
            title="Add a place"
            onClick={openSearch}
          >
            <svg viewBox="0 0 20 20" width="22" height="22" aria-hidden="true">
              <path d="M10 3.5v13M3.5 10h13" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <Drawer
          ref={drawerRef}
          open={drawerOpen}
          onClose={closeDrawer}
          label={searching ? 'Add a place' : 'Place details'}
          variant={searching ? 'adding' : undefined}
        >
          {searching ? (
            <AddPlaceSearch
              getView={getMapView}
              onPick={showSearchResult}
              onPreview={previewSearchResult}
            />
          ) : (
            selected && <PlaceDetails place={selected} tagColors={tagColors} />
          )}
        </Drawer>
      </main>
    </div>
  )
}

export default App

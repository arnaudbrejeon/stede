import { useCallback, useMemo, useRef, useState } from 'react'
import { AddPlaceSearch } from './components/AddPlaceSearch'
import { Drawer } from './components/Drawer'
import { FilterPanel } from './components/FilterPanel'
import { Header } from './components/Header'
import { KeyPanel } from './components/KeyPanel'
import { PlaceDetails } from './components/PlaceDetails'
import { PlacesMap, type LngLat, type PlacesMapHandle } from './components/PlacesMap'
import type { GeocodeResult } from './geocoder'
import { useKey } from './keystore'
import { usePlaces } from './placeStore'
import { allTags, filterPlaces, type Place, type TagLine } from './places'
import { buildTagColors } from './tags'
import { useHiddenBottom } from './useHiddenBottom'

function App() {
  // Your places from the relay, once the key is unlocked (see placeStore.ts).
  const { places, error: placesError } = usePlaces()
  const [query, setQuery] = useState('')
  const [tagLines, setTagLines] = useState<TagLine[]>([new Set()])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Browsing your places is the default; searching for a new one is opt-in.
  const [searching, setSearching] = useState(false)
  // A spot picked on the map while adding a place, instead of searching.
  const [pin, setPin] = useState<LngLat | null>(null)
  // The drawer shows the user's key instead of a place.
  const [showingKey, setShowingKey] = useState(false)
  // Adding a place needs the key: '+' asks for it first, then carries on.
  const [addAfterUnlock, setAddAfterUnlock] = useState(false)
  const { status: keyStatus } = useKey()
  const appRef = useRef<HTMLDivElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const mapRef = useRef<PlacesMapHandle>(null)
  useHiddenBottom(appRef)

  const tags = useMemo(() => allTags(places), [places])
  const tagColors = useMemo(() => buildTagColors(tags), [tags])
  const filtered = useMemo(
    () => filterPlaces(places, query, tagLines),
    [places, query, tagLines],
  )
  // Looked up in the filtered set, so the drawer closes when filters hide the place.
  const selected = searching || showingKey
    ? null
    : (filtered.features.find((f) => f.properties.id === selectedId) ?? null)
  const drawerOpen = showingKey || searching || selected !== null

  const showKey = () => {
    setSelectedId(null)
    setSearching(false)
    setPin(null)
    mapRef.current?.clearLocation()
    setAddAfterUnlock(false)
    setShowingKey(true)
  }
  const openSearch = () => {
    if (keyStatus !== 'unlocked') {
      showKey()
      setAddAfterUnlock(true)
      return
    }
    setSelectedId(null)
    setShowingKey(false)
    setSearching(true)
  }
  if (addAfterUnlock && keyStatus === 'unlocked') {
    // Adjusting state while rendering, as React recommends over an effect.
    setAddAfterUnlock(false)
    setShowingKey(false)
    setSearching(true)
  }
  const closeDrawer = useCallback(() => {
    setSelectedId(null)
    setShowingKey(false)
    setAddAfterUnlock(false)
    setSearching(false)
    setPin(null)
    mapRef.current?.clearLocation()
  }, [])
  // Clicking a place leaves search for its details; clicking empty map while
  // searching keeps the search open, since that's usually looking around.
  const selectOnMap = useCallback((id: string | null) => {
    if (id === null) return setSelectedId(null)
    setSearching(false)
    setShowingKey(false)
    setAddAfterUnlock(false)
    setPin(null)
    mapRef.current?.clearLocation()
    setSelectedId(id)
  }, [])
  // One marker at a time: a dropped pin replaces the search result's, and back.
  const dropPin = useCallback((point: LngLat) => {
    mapRef.current?.clearLocation()
    setPin(point)
  }, [])
  const clearPin = useCallback(() => setPin(null), [])
  // A new place: leave adding and show it.
  const placeSaved = useCallback((place: Place) => {
    setSearching(false)
    setPin(null)
    mapRef.current?.clearLocation()
    setSelectedId(place.properties.id)
  }, [])

  const getMapView = useCallback(() => mapRef.current?.getView(), [])
  const showSearchResult = useCallback((result: GeocodeResult) => {
    setPin(null)
    mapRef.current?.showLocation(result)
  }, [])
  const previewSearchResult = useCallback((result: GeocodeResult) => {
    setPin(null)
    mapRef.current?.previewLocation(result)
  }, [])

  return (
    <div ref={appRef} className={`app${drawerOpen ? ' drawer-open' : ''}`}>
      <Header onKeyClick={showKey} />
      <main className="main">
        <PlacesMap
          ref={mapRef}
          places={filtered}
          selectedId={selected?.properties.id ?? null}
          onSelect={selectOnMap}
          drawerOpen={drawerOpen}
          tagColors={tagColors}
          overlayRef={drawerRef}
          onPinDrop={searching ? dropPin : undefined}
          pin={pin}
        />
        {/* Filters are for browsing your places; out of the way while adding one. */}
        {placesError && <p className="places-error">{placesError}</p>}
        {!searching && (
          <FilterPanel
            query={query}
            onQueryChange={setQuery}
            tags={tags}
            tagLines={tagLines}
            onTagLinesChange={setTagLines}
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
          label={showingKey ? 'Your key' : searching ? 'Add a place' : 'Place details'}
          variant={searching ? 'adding' : undefined}
        >
          {showingKey ? (
            <KeyPanel forAdding={addAfterUnlock} />
          ) : searching ? (
            <AddPlaceSearch
              getView={getMapView}
              onPick={showSearchResult}
              onPreview={previewSearchResult}
              pin={pin}
              onClearPin={clearPin}
              onSaved={placeSaved}
              allLabels={tags}
              tagColors={tagColors}
            />
          ) : (
            selected && (
              <PlaceDetails
                key={selected.properties.id}
                place={selected}
                tagColors={tagColors}
                allLabels={tags}
                onDeleted={closeDrawer}
              />
            )
          )}
        </Drawer>
      </main>
    </div>
  )
}

export default App

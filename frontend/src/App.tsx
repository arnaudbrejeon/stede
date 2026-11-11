import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AddPlaceSearch } from './components/AddPlaceSearch'
import { Drawer } from './components/Drawer'
import { FilterPanel } from './components/FilterPanel'
import { Header } from './components/Header'
import { KeyPanel } from './components/KeyPanel'
import { PlaceDetails } from './components/PlaceDetails'
import { PlacesMap, PLACE_ZOOM, type LngLat, type PlacesMapHandle, type StopProgress } from './components/PlacesMap'
import type { GeocodeResult } from './geocoder'
import { useKey } from './keystore'
import { usePlaces } from './placeStore'
import { withWelcome } from './welcomePlace'
import { allTags, filterPlaces, type Place, type TagLine } from './places'
import { buildTagColors } from './tags'
import { useHiddenBottom } from './useHiddenBottom'
import { SETTLE_MS } from './viewHistory'
import { placeIdsByOsm } from './places'

function App() {
  // Your places from the relay, once the key is unlocked (see placeStore.ts).
  const { places: yours, status: placesStatus, error: placesError } = usePlaces()
  const places = useMemo(() => withWelcome(yours, placesStatus === 'loading'), [yours, placesStatus])
  const [query, setQuery] = useState('')
  const [tagLines, setTagLines] = useState<TagLine[]>([new Set()])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Whether selecting the place should also zoom the map in (see PlacesMap).
  const [selectZoom, setSelectZoom] = useState<number>()
  // Browsing your places is the default; searching for a new one is opt-in.
  const [searching, setSearching] = useState(false)
  // A spot picked on the map while adding a place, instead of searching.
  const [pin, setPin] = useState<LngLat | null>(null)
  // On phones the drawer covers the map: to drop a pin it closes until the tap.
  const [pinning, setPinning] = useState(false)
  // The drawer shows the user's key instead of a place.
  const [showingKey, setShowingKey] = useState(false)
  // Adding a place needs the key: '+' asks for it first, then carries on.
  const [addAfterUnlock, setAddAfterUnlock] = useState(false)
  const { status: keyStatus } = useKey()
  // Why your position couldn't be found; shown for a while, or until tapped.
  const [locateError, setLocateError] = useState<string | null>(null)
  useEffect(() => {
    if (!locateError) return
    const timer = setTimeout(() => setLocateError(null), 12_000)
    return () => clearTimeout(timer)
  }, [locateError])
  // Whether the map has earlier and later views to step to (see viewHistory).
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const noteHistory = useCallback((back: boolean, forward: boolean) => {
    setCanGoBack(back)
    setCanGoForward(forward)
  }, [])
  // Shown on '<': a ring filling while a new view waits to be remembered, then
  // a bump as it is.
  const [stopProgress, setStopProgress] = useState<StopProgress>('idle')
  const appRef = useRef<HTMLDivElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const mapRef = useRef<PlacesMapHandle>(null)
  useHiddenBottom(appRef)

  const tags = useMemo(() => allTags(places), [places])
  const savedIds = useMemo(() => placeIdsByOsm(places), [places])
  const tagColors = useMemo(() => buildTagColors(tags), [tags])
  const filtered = useMemo(
    () => filterPlaces(places, query, tagLines),
    [places, query, tagLines],
  )
  // Looked up in the filtered set, so the drawer closes when filters hide the place.
  const selected = searching || showingKey
    ? null
    : (filtered.features.find((f) => f.properties.id === selectedId) ?? null)
  const drawerOpen = showingKey || (searching && !pinning) || selected !== null

  const showKey = () => {
    setSelectedId(null)
    setSearching(false)
    setPinning(false)
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
    setPinning(false)
    setPin(null)
    mapRef.current?.clearLocation()
  }, [])
  // Clicking a place leaves search for its details; clicking empty map while
  // searching keeps the search open, since that's usually looking around.
  const selectOnMap = useCallback((id: string | null, zoom?: number) => {
    if (id === null) return setSelectedId(null)
    setSearching(false)
    setPinning(false)
    setShowingKey(false)
    setAddAfterUnlock(false)
    setPin(null)
    mapRef.current?.clearLocation()
    setSelectZoom(zoom)
    setSelectedId(id)
  }, [])
  // One marker at a time: a dropped pin replaces the search result's, and back.
  const dropPin = useCallback((point: LngLat) => {
    mapRef.current?.clearLocation()
    setPin(point)
    setPinning(false)
  }, [])
  const clearPin = useCallback(() => setPin(null), [])
  // A new place: leave adding and show it.
  const placeSaved = useCallback((place: Place) => {
    setSearching(false)
    setPinning(false)
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
          selectZoom={selectZoom}
          drawerOpen={drawerOpen}
          tagColors={tagColors}
          overlayRef={drawerRef}
          onPinDrop={searching ? dropPin : undefined}
          pin={pin}
          onLocateError={setLocateError}
          onHistoryChange={noteHistory}
          onStopProgress={setStopProgress}
        />
        {/* Filters are for browsing your places; out of the way while adding one. */}
        {placesError && <p className="places-error">{placesError}</p>}
        {locateError && !placesError && (
          <p className="places-error" role="alert" onClick={() => setLocateError(null)}>
            {locateError}
          </p>
        )}
        {pinning && (
          <p className="map-hint" role="status">
            Tap the map to drop a pin.
            <button type="button" aria-label="Cancel" onClick={() => setPinning(false)}>
              ×
            </button>
          </p>
        )}
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
        <div className="map-actions">
          <button
            type="button"
            className={stopProgress === 'recorded' ? 'map-step bump' : 'map-step'}
            aria-label="Previous map view"
            title="Previous map view"
            disabled={!canGoBack}
            onClick={() => mapRef.current?.goBack()}
            onAnimationEnd={(e) => {
              if (e.animationName === 'map-step-bump') setStopProgress('idle')
            }}
          >
            {stopProgress === 'pending' && (
              <svg className="settle-ring" viewBox="0 0 48 48" aria-hidden="true">
                <circle cx="24" cy="24" r="22" pathLength="1" style={{ animationDuration: `${SETTLE_MS}ms` }} />
              </svg>
            )}
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path d="M12.5 4 6.5 10l6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
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
          <button
            type="button"
            className="map-step"
            aria-label="Next map view"
            title="Next map view"
            disabled={!canGoForward}
            onClick={() => mapRef.current?.goForward()}
          >
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path d="m7.5 4 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
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
              onPinInstead={() => setPinning(true)}
              savedIds={savedIds}
              onOpenSaved={(id) => selectOnMap(id, PLACE_ZOOM)}
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

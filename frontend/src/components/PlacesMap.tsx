import * as maplibregl from 'maplibre-gl'
import { useEffect, useImperativeHandle, useRef, type Ref, type RefObject } from 'react'
import type { GeocodeResult, MapView } from '../geocoder'
import { saveMapType, savedMapType, type MapType, type PlaceInk } from '../mapStyle'
import { MapTypeControl } from '../mapTypeControl'
import {
  createSearchPinElement,
  drawMarker,
  isMarkerImageId,
  MARKER_RADIUS,
  markerImageId,
} from '../placeMarker'
import { placeIcon } from '../placeIconChoice'
import type { Places } from '../places'
import type { TagColors } from '../tags'
import { SETTLE_MS, ViewHistory, type View } from '../viewHistory'

const SOURCE_ID = 'places'

export type PlacesMapHandle = {
  // Visible area, clamped to the world (zoomed out, MapLibre reports wrapped longitudes).
  getView: () => MapView | undefined
  // Fly to a search result (in the area beside the drawer) and mark it.
  showLocation: (result: GeocodeResult) => void
  // Pan to a result without zooming, e.g. while hovering it in a list.
  previewLocation: (result: GeocodeResult) => void
  clearLocation: () => void
  // Step through the views the map has rested on (see viewHistory).
  goBack: () => void
  goForward: () => void
}

// Where the map is in remembering a new view (see viewHistory): waiting for it
// to rest there long enough, or just having recorded it.
export type StopProgress = 'idle' | 'pending' | 'recorded'

// [longitude, latitude]
export type LngLat = [number, number]

// Close enough to see a place's surroundings when the map is brought to it.
export const PLACE_ZOOM = 16

type PlacesMapProps = {
  ref?: Ref<PlacesMapHandle>
  places: Places
  selectedId: string | null
  onSelect: (id: string | null) => void
  // Zoom in to at least this when the selection changes. Selecting on the map
  // keeps the zoom; opening a place from elsewhere (a search result you already
  // have) brings the map to it.
  selectZoom?: number
  // Opening saves the view; closing restores it.
  drawerOpen: boolean
  tagColors: TagColors
  // Panel laid over the map edge; the selected place is centred in the area it leaves visible.
  overlayRef?: RefObject<HTMLElement | null>
  // While adding a place: tapping empty map drops a pin there, and dragging it
  // moves it; both report the new spot.
  onPinDrop?: (point: LngLat) => void
  // The dropped pin, if any.
  pin?: LngLat | null
  // Told why your position couldn't be found, after a tap on the locate button.
  onLocateError?: (message: string) => void
  // Told whether there are views to step back and forward to, as that changes.
  onHistoryChange?: (canGoBack: boolean, canGoForward: boolean) => void
  // Told when the map starts waiting to remember a new view, gives up, or does.
  onStopProgress?: (progress: StopProgress) => void
}

export function PlacesMap({
  ref,
  places,
  selectedId,
  onSelect,
  selectZoom,
  drawerOpen,
  tagColors,
  overlayRef,
  onPinDrop,
  pin = null,
  onLocateError,
  onHistoryChange,
  onStopProgress,
}: PlacesMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  // Latest props, so handlers registered once on the map never see stale values.
  const placesRef = useRef(places)
  const selectedIdRef = useRef(selectedId)
  const selectZoomRef = useRef(selectZoom)
  selectZoomRef.current = selectZoom
  // The base map shown, which decides how the place layers are drawn.
  const mapTypeRef = useRef<MapType>(savedMapType())
  const onSelectRef = useRef(onSelect)
  const onLocateErrorRef = useRef(onLocateError)
  const tagColorsRef = useRef(tagColors)
  // View from before the drawer opened, restored when it closes. Dropped if the
  // user moves the map meanwhile, so closing never undoes their own panning.
  const viewBeforeDrawerRef = useRef<{ center: maplibregl.LngLat; zoom: number } | null>(null)
  const drawerOpenRef = useRef(drawerOpen)
  const locationMarkerRef = useRef<maplibregl.Marker | null>(null)
  const onPinDropRef = useRef(onPinDrop)
  const pinMarkerRef = useRef<maplibregl.Marker | null>(null)
  const onHistoryChangeRef = useRef(onHistoryChange)
  const onStopProgressRef = useRef(onStopProgress)
  const historyRef = useRef<ViewHistory>(null)
  historyRef.current ??= new ViewHistory()

  const reportHistory = (map: maplibregl.Map) => {
    const history = historyRef.current!
    onHistoryChangeRef.current?.(history.canGoBack(currentView(map), viewReach(map)), history.canGoForward())
  }
  const showView = (map: maplibregl.Map, view: View | undefined) => {
    if (!view) return
    // Closing the drawer shouldn't then undo the step.
    viewBeforeDrawerRef.current = null
    map.flyTo(view)
    reportHistory(map)
  }

  const placeLocationMarker = (map: maplibregl.Map, center: [number, number]) => {
    locationMarkerRef.current ??= new maplibregl.Marker({ element: createSearchPinElement() })
    locationMarkerRef.current.setLngLat(center).addTo(map)
  }

  useImperativeHandle(ref, () => ({
    getView: () => {
      const bounds = mapRef.current?.getBounds()
      if (!bounds) return undefined
      const clamp = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v))
      return {
        west: clamp(bounds.getWest(), 180),
        south: clamp(bounds.getSouth(), 90),
        east: clamp(bounds.getEast(), 180),
        north: clamp(bounds.getNorth(), 90),
      }
    },
    previewLocation: (result) => {
      const map = mapRef.current
      if (!map) return
      const center = result.geometry.coordinates as [number, number]
      placeLocationMarker(map, center)
      const offset = insetOffset(overlayInset(map, overlayRef?.current))
      // Short, so sweeping the pointer down the list stays responsive.
      map.easeTo({ center, offset, duration: 400 })
    },
    showLocation: (result) => {
      const map = mapRef.current
      if (!map) return
      const center = result.geometry.coordinates as [number, number]
      placeLocationMarker(map, center)
      const inset = overlayInset(map, overlayRef?.current)
      const extent = result.properties.extent
      // cameraForBounds rather than fitBounds: fitBounds' padding would persist on the map.
      const camera = extent
        ? map.cameraForBounds([extent[0], extent[3], extent[2], extent[1]], {
            padding: { top: 60, left: 60, right: 60 + inset.right, bottom: 60 + inset.bottom },
            maxZoom: 17,
          })
        : undefined
      if (camera) map.flyTo({ center: camera.center, zoom: camera.zoom })
      else map.flyTo({ center, zoom: Math.max(map.getZoom(), PLACE_ZOOM), offset: insetOffset(inset) })
    },
    clearLocation: () => locationMarkerRef.current?.remove(),
    goBack: () => {
      const map = mapRef.current
      if (map) showView(map, historyRef.current!.back(currentView(map), viewReach(map)))
    },
    goForward: () => {
      const map = mapRef.current
      if (map) showView(map, historyRef.current!.forward())
    },
  }))

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current!,
      // Westminster Abbey, where Chaucer is buried (Poets' Corner).
      center: [-0.12731, 51.49929],
      zoom: 15,
      // Always north-up and flat: rotating or tilting a map of places only happens
      // by accident (a two-finger twist), and there'd be no compass to undo it.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
    })
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()
    // Filtered and tinted as the style arrives, so the original is never drawn.
    // A new style drops the place layers; they're added back on style.load.
    const showMapType = (type: MapType) => {
      mapTypeRef.current = type
      map.setStyle(type.style, {
        diff: false,
        transformStyle: (_previous, next) => type.transform(next),
      })
    }
    showMapType(savedMapType())
    mapRef.current = map
    // On phones the map runs on behind the browser's bars (see .app in
    // index.css): centring, fitting and locating aim at the part you can see.
    // Measured against the window, not the visual viewport, so the on-screen
    // keyboard doesn't move the map.
    const padForBars = () => {
      const hidden = Math.round(
        Math.max(0, map.getContainer().getBoundingClientRect().bottom - window.innerHeight),
      )
      if (map.getPadding().bottom !== hidden) map.setPadding({ ...map.getPadding(), bottom: hidden })
    }
    padForBars()
    // The container grows once the app is sized to the screen (useHiddenBottom).
    map.on('resize', padForBars)
    window.addEventListener('resize', padForBars)
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    // Shows where you are and centres the map on you; one-off, not following.
    // A precise fix can take a while indoors (iPhones especially); one up to a
    // minute old will do.
    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true, timeout: 30_000, maximumAge: 60_000 },
      fitBoundsOptions: { maxZoom: 15 },
    })
    map.addControl(geolocate, 'top-right')
    geolocate.on('error', (error) => onLocateErrorRef.current?.(locateErrorMessage(error)))
    // When the browser says location is denied, MapLibre greys the button out,
    // so a tap does nothing and says nothing. Keep it tappable: the tap then
    // explains (see onLocateError), or works once location is allowed again.
    const locateButton = map
      .getContainer()
      .querySelector<HTMLButtonElement>('button.maplibregl-ctrl-geolocate')
    if (locateButton) {
      new MutationObserver(() => {
        if (!locateButton.disabled) return
        locateButton.disabled = false
        locateButton.title = 'Find my location'
        locateButton.setAttribute('aria-label', 'Find my location')
        // Its title is set once MapLibre has checked; before that it's still setting up.
      }).observe(locateButton, { attributeFilter: ['title'] })
    }
    map.addControl(
      new MapTypeControl(savedMapType(), (type) => {
        saveMapType(type)
        showMapType(type)
      }),
      'top-right',
    )
    // Open where you are when the browser will say (it asks the first time;
    // only over HTTPS or on localhost). Until then, and otherwise, the default view.
    let userMoved = false
    const noteUserMove = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) userMoved = true
    }
    map.on('movestart', noteUserMove)
    if (window.isSecureContext && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          map.off('movestart', noteUserMove)
          // Never yank the map away from what you've started looking at.
          if (userMoved || selectedIdRef.current !== null || !mapRef.current) return
          map.jumpTo({ center: [coords.longitude, coords.latitude], zoom: 14 })
          // Same spot, so it just adds your position marker.
          geolocate.trigger()
        },
        () => map.off('movestart', noteUserMove),
        { timeout: 10_000, maximumAge: 5 * 60_000 },
      )
    }
    // MapLibre shows the attribution open until the first drag. On narrow screens
    // (as in index.css) that's under the add-place button, so fold it into its
    // (i) button once the map is drawn; a tap still opens it.
    map.once('idle', () => {
      if (!window.matchMedia('(max-width: 640px)').matches) return
      map.getContainer().querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show')
    })

    // On the first style and again after each change of map type.
    map.on('style.load', () => {
      if (map.getSource(SOURCE_ID)) return
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: toMapData(placesRef.current),
        cluster: true,
        clusterRadius: 45,
        clusterMaxZoom: 15,
      })
      addLayers(map, mapTypeRef.current.ink)
      map.setFilter('place-selected', selectedFilter(selectedIdRef.current))
    })

    // Markers are drawn the first time the map needs one for a tag combination.
    map.setMissingStyleImageResolver((id) => {
      if (!isMarkerImageId(id)) return
      const ratio = window.devicePixelRatio || 1
      map.addImage(id, drawMarker(id, tagColorsRef.current, ratio), { pixelRatio: ratio })
    })

    // Click a cluster: zoom in to expand it
    map.on('click', 'clusters', async (e) => {
      const f = e.features?.[0]
      if (!f || f.geometry.type !== 'Point') return
      const source = map.getSource<maplibregl.GeoJSONSource>(SOURCE_ID)!
      const zoom = await source.getClusterExpansionZoom(f.properties.cluster_id)
      viewBeforeDrawerRef.current = null
      map.easeTo({ center: f.geometry.coordinates as [number, number], zoom })
    })

    // Click a place to select it; click empty map to clear the selection, or,
    // while adding a place, to drop a pin there.
    map.on('click', (e) => {
      if (!map.getLayer('place-points')) return
      const [place] = map.queryRenderedFeatures(e.point, { layers: ['place-points'] })
      if (place) return onSelectRef.current(place.properties.id as string)
      const [cluster] = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })
      if (cluster) return
      if (onPinDropRef.current) onPinDropRef.current([e.lngLat.lng, e.lngLat.lat])
      else onSelectRef.current(null)
    })

    // Only user gestures (drag, scroll, zoom buttons) carry an originalEvent.
    map.on('movestart', (e) => {
      if (e.originalEvent) viewBeforeDrawerRef.current = null
    })

    // A view the map rests on for a while goes into the history, unless it's
    // still around the last one (see viewReach). Stepping through the history
    // lands on a view already there, which isn't added again.
    // The wait is only shown for a view that would add a way back: not the
    // first view, nor one around the last.
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    let pending = false
    const awaitSettle = () => {
      clearTimeout(settleTimer)
      const history = historyRef.current!
      pending = !history.isEmpty && history.isNewStop(currentView(map), viewReach(map))
      if (pending) onStopProgressRef.current?.('pending')
      settleTimer = setTimeout(() => {
        history.record(currentView(map), viewReach(map))
        reportHistory(map)
        if (pending) onStopProgressRef.current?.('recorded')
        pending = false
      }, SETTLE_MS)
    }
    map.on('movestart', (e) => {
      clearTimeout(settleTimer)
      if (pending) onStopProgressRef.current?.('idle')
      pending = false
      // The view you start from counts even if you leave it straight away, so
      // there's always a way back to it.
      const history = historyRef.current!
      if (e.originalEvent && history.isEmpty) history.record(currentView(map), viewReach(map))
    })
    map.on('moveend', () => {
      awaitSettle()
      // Back is there as soon as you've left the last view rested on.
      reportHistory(map)
    })
    awaitSettle()

    for (const layer of ['clusters', 'place-points']) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
    }

    return () => {
      clearTimeout(settleTimer)
      window.removeEventListener('resize', padForBars)
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    placesRef.current = places
    mapRef.current?.getSource<maplibregl.GeoJSONSource>(SOURCE_ID)?.setData(toMapData(places))
  }, [places])

  // Declared before the selection effect so the view is saved before centring on a place.
  useEffect(() => {
    const wasOpen = drawerOpenRef.current
    drawerOpenRef.current = drawerOpen
    const map = mapRef.current
    if (!map || drawerOpen === wasOpen) return
    if (drawerOpen) {
      viewBeforeDrawerRef.current = { center: map.getCenter(), zoom: map.getZoom() }
    } else {
      const view = viewBeforeDrawerRef.current
      viewBeforeDrawerRef.current = null
      if (view) map.easeTo(view)
    }
  }, [drawerOpen])

  useEffect(() => {
    selectedIdRef.current = selectedId
    const map = mapRef.current
    if (map?.getLayer('place-selected')) map.setFilter('place-selected', selectedFilter(selectedId))
    if (!map || selectedId === null) return
    const place = placesRef.current.features.find((f) => f.properties.id === selectedId)
    if (!place) return
    const view = {
      center: place.geometry.coordinates as [number, number],
      // An offset rather than padding: map padding persists and would skew zooming later.
      offset: insetOffset(overlayInset(map, overlayRef?.current)),
    }
    const zoom = selectZoomRef.current
    if (zoom === undefined) map.easeTo(view)
    else map.flyTo({ ...view, zoom: Math.max(map.getZoom(), zoom) })
    // Only a new selection should move the map, not later data or ref changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  useEffect(() => {
    onPinDropRef.current = onPinDrop
  }, [onPinDrop])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !pin) {
      pinMarkerRef.current?.remove()
      return
    }
    if (!pinMarkerRef.current) {
      const element = createSearchPinElement()
      element.classList.add('dropped-pin')
      const marker = new maplibregl.Marker({ element, draggable: true })
      marker.on('dragend', () => {
        const { lng, lat } = marker.getLngLat()
        onPinDropRef.current?.([lng, lat])
      })
      pinMarkerRef.current = marker
    }
    pinMarkerRef.current.setLngLat(pin).addTo(map)
  }, [pin])

  useEffect(() => {
    onSelectRef.current = onSelect
    onLocateErrorRef.current = onLocateError
    onHistoryChangeRef.current = onHistoryChange
    onStopProgressRef.current = onStopProgress
    // Markers already drawn keep their colours; tag colours are fixed for the session.
    tagColorsRef.current = tagColors
  }, [onSelect, onLocateError, onHistoryChange, onStopProgress, tagColors])

  return <div ref={containerRef} className="map" />
}

function addLayers(map: maplibregl.Map, ink: PlaceInk) {
  // Clusters: dark circles sized by count
  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: SOURCE_ID,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': getComputedStyle(document.documentElement).getPropertyValue('--cluster').trim(),
      'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 50, 26],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff',
    },
  })
  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: SOURCE_ID,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 13,
    },
    paint: { 'text-color': '#fff' },
  })

  // Ring under the selected place, so it stays identifiable while the drawer is open
  map.addLayer({
    id: 'place-selected',
    type: 'circle',
    source: SOURCE_ID,
    filter: selectedFilter(null),
    paint: {
      'circle-color': ink.selected,
      'circle-radius': MARKER_RADIUS + 3,
    },
  })

  // Individual places: icon on a white disc, ringed in the colours of its tags
  map.addLayer({
    id: 'place-points',
    type: 'symbol',
    source: SOURCE_ID,
    filter: ['!', ['has', 'point_count']],
    layout: {
      'icon-image': ['get', 'marker'],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })
  map.addLayer({
    id: 'place-labels',
    type: 'symbol',
    source: SOURCE_ID,
    filter: ['!', ['has', 'point_count']],
    minzoom: 14,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 12,
      // Below the marker: its radius plus a little air, in ems of the 12px text.
      'text-offset': [0, (MARKER_RADIUS + 3) / 12],
      'text-anchor': 'top',
    },
    paint: { 'text-color': ink.label, 'text-halo-color': ink.halo, 'text-halo-width': 1.5 },
  })
}

function currentView(map: maplibregl.Map): View {
  const { lng, lat } = map.getCenter()
  return { center: [lng, lat], zoom: map.getZoom() }
}

// How far the map can move and still be looking at the same area, for the
// history: half the screen, so the old centre is still in sight.
function viewReach(map: maplibregl.Map): number {
  const { clientWidth, clientHeight } = map.getContainer()
  return Math.min(clientWidth, clientHeight) / 2
}

type Inset = { right: number; bottom: number }

// Why your position couldn't be found, and what to do about it.
// Codes as in GeolocationPositionError: 1 denied, 2 unavailable, 3 timeout.
function locateErrorMessage({ code }: { code: number }): string {
  if (code === 1) {
    const iPhone = /iPhone|iPad/.test(navigator.userAgent)
    return iPhone
      ? 'Location is off for stede.cc. Check Settings → Privacy & Security → Location Services → Safari Websites (While Using), and in Safari aA → Website Settings → Location (Allow).'
      : 'Location is off for stede.cc: allow it in your browser’s site settings.'
  }
  if (code === 3) {
    return 'Finding your position took too long. Try again, ideally near a window or outside.'
  }
  return 'Your position isn’t available right now.'
}

// How much of the map the drawer covers: docked to the right edge (the side
// drawer) or to the bottom (the phone sheet). Uses layout offsets rather than
// the bounding box so it's correct while the drawer is still sliding in. On
// phones it can also be a page over the whole map (see index.css): nothing is
// left to centre in, so no inset.
// The part behind the browser's bars is already the map's bottom padding (see
// padForBars), so it isn't counted again.
function overlayInset(map: maplibregl.Map, overlay: HTMLElement | null | undefined): Inset {
  const none = { right: 0, bottom: 0 }
  if (!overlay) return none
  const { clientWidth: w, clientHeight: h } = map.getContainer()
  const fromTop = overlay.offsetTop <= 0
  if (fromTop && overlay.offsetWidth >= w) return none
  if (fromTop && overlay.offsetHeight >= h) return { right: Math.max(0, w - overlay.offsetLeft), bottom: 0 }
  return { right: 0, bottom: Math.max(0, h - overlay.offsetTop - (map.getPadding().bottom ?? 0)) }
}

// Shift that centres a point in the area left visible beside or above the inset.
function insetOffset({ right, bottom }: Inset): [number, number] {
  return [-right / 2, -bottom / 2]
}

function selectedFilter(id: string | null): maplibregl.FilterSpecification {
  return ['all', ['!', ['has', 'point_count']], ['==', ['get', 'id'], id ?? '']]
}

// Adds each feature's marker image name; MapLibre can't build it from an array.
function toMapData(places: Places): Places {
  return {
    ...places,
    features: places.features.map((f) => {
      const icon = placeIcon(f.properties.icon, f.properties.category)
      return {
        ...f,
        properties: { ...f.properties, marker: markerImageId(icon, f.properties.tags) },
      }
    }),
  }
}

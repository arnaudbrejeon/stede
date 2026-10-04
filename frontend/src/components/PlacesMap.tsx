import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef, type RefObject } from 'react'
import { drawMarker, isMarkerImageId, MARKER_RADIUS, markerImageId } from '../placeMarker'
import type { Places } from '../places'
import type { TagColors } from '../tags'

// maplibre-gl locates its worker next to its own module, which breaks once Vite
// bundles it; point it at a worker Vite builds and serves itself.
maplibregl.setWorkerUrl(workerUrl)

const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
const SOURCE_ID = 'places'

type PlacesMapProps = {
  places: Places
  selectedId: number | null
  onSelect: (id: number | null) => void
  tagColors: TagColors
  // Panel laid over the map edge; the selected place is centred in the area it leaves visible.
  overlayRef?: RefObject<HTMLElement | null>
}

export function PlacesMap({ places, selectedId, onSelect, tagColors, overlayRef }: PlacesMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  // Latest props, so handlers registered once on the map never see stale values.
  const placesRef = useRef(places)
  const selectedIdRef = useRef(selectedId)
  const onSelectRef = useRef(onSelect)
  const tagColorsRef = useRef(tagColors)
  // View from before the drawer opened, restored when it closes. Dropped if the
  // user moves the map meanwhile, so closing never undoes their own panning.
  const viewBeforeSelectRef = useRef<{ center: maplibregl.LngLat; zoom: number } | null>(null)

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: OPENFREEMAP_STYLE,
      center: [2.345, 48.86],
      zoom: 13,
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('load', () => {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: toMapData(placesRef.current),
        cluster: true,
        clusterRadius: 45,
        clusterMaxZoom: 15,
      })
      addLayers(map)
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
      viewBeforeSelectRef.current = null
      map.easeTo({ center: f.geometry.coordinates as [number, number], zoom })
    })

    // Click a place to select it; click empty map to clear the selection.
    map.on('click', (e) => {
      if (!map.getLayer('place-points')) return
      const [place] = map.queryRenderedFeatures(e.point, { layers: ['place-points'] })
      if (place) return onSelectRef.current(place.properties.id as number)
      const [cluster] = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })
      if (!cluster) onSelectRef.current(null)
    })

    // Only user gestures (drag, scroll, zoom buttons) carry an originalEvent.
    map.on('movestart', (e) => {
      if (e.originalEvent) viewBeforeSelectRef.current = null
    })

    for (const layer of ['clusters', 'place-points']) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
    }

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    placesRef.current = places
    mapRef.current?.getSource<maplibregl.GeoJSONSource>(SOURCE_ID)?.setData(toMapData(places))
  }, [places])

  useEffect(() => {
    const previousId = selectedIdRef.current
    selectedIdRef.current = selectedId
    const map = mapRef.current
    if (map?.getLayer('place-selected')) map.setFilter('place-selected', selectedFilter(selectedId))
    if (!map) return

    if (selectedId === null) {
      const view = viewBeforeSelectRef.current
      viewBeforeSelectRef.current = null
      if (previousId !== null && view) map.easeTo(view)
      return
    }
    // Remember the view when the drawer opens, not when switching between places.
    if (previousId === null) {
      viewBeforeSelectRef.current = { center: map.getCenter(), zoom: map.getZoom() }
    }
    const place = placesRef.current.features.find((f) => f.properties.id === selectedId)
    if (!place) return
    map.easeTo({
      center: place.geometry.coordinates as [number, number],
      // An offset rather than padding: map padding persists and would skew zooming later.
      offset: overlayOffset(map.getContainer(), overlayRef?.current),
    })
    // Only a new selection should move the map, not later data or ref changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  useEffect(() => {
    onSelectRef.current = onSelect
    // Markers already drawn keep their colours; tag colours are fixed for the session.
    tagColorsRef.current = tagColors
  }, [onSelect, tagColors])

  return <div ref={containerRef} className="map" />
}

function addLayers(map: maplibregl.Map) {
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
      'circle-color': '#1d2733',
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
    paint: { 'text-color': '#1d2733', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
  })
}

// Shift that centres a point in the area left visible by a panel docked to the
// right or bottom edge. Uses layout offsets rather than the bounding box so it's
// correct while the panel is still sliding in.
function overlayOffset(
  container: HTMLElement,
  overlay: HTMLElement | null | undefined,
): [number, number] {
  if (!overlay) return [0, 0]
  const { clientWidth: w, clientHeight: h } = container
  const spansHeight = overlay.offsetTop <= 0 && overlay.offsetHeight >= h
  if (spansHeight) return [-Math.max(0, w - overlay.offsetLeft) / 2, 0]
  return [0, -Math.max(0, h - overlay.offsetTop) / 2]
}

function selectedFilter(id: number | null): maplibregl.FilterSpecification {
  return ['all', ['!', ['has', 'point_count']], ['==', ['get', 'id'], id ?? -1]]
}

// Adds each feature's marker image name; MapLibre can't build it from an array.
function toMapData(places: Places): Places {
  return {
    ...places,
    features: places.features.map((f) => ({
      ...f,
      properties: { ...f.properties, marker: markerImageId(f.properties.tags) },
    })),
  }
}

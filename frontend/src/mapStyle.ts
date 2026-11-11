import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'

// maplibre-gl locates its worker next to its own module, which breaks once Vite
// bundles it; point it at a worker Vite builds and serves itself.
maplibregl.setWorkerUrl(workerUrl)

export const BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

// Base-map layers left out so your places stand out: 3D buildings and points of
// interest (shops, museums, cafés). Transit (poi_transit: metro and train
// stations, bus stops, airports) is kept, as it helps getting around.
const HIDDEN_LAYERS = new Set(['building-3d', 'poi_r1', 'poi_r7', 'poi_r20'])

export function flattenStyle(style: maplibregl.StyleSpecification): maplibregl.StyleSpecification {
  const layers = style.layers
    .filter((layer) => !HIDDEN_LAYERS.has(layer.id))
    .map((layer) => {
      // Flat footprints stop at zoom 14, where the 3D layer used to take over.
      if (layer.id !== 'building') return layer
      const { maxzoom: _, ...flat } = layer
      return flat
    })
  return { ...style, layers }
}

// Vellum tint for the liberty style: each colour it uses, mapped to a warmer one.
// Light parchment land so buildings, near-white streets, ochre major roads, teal
// water and olive parks keep about the same contrast as the original style.
export const VELLUM_MAP_COLORS: Record<string, string> = {
  // land and land use
  '#f8f4f0': '#f5efe2',
  'hsla(0,3%,85%,0.84)': 'hsla(38,24%,86%,0.55)',
  'hsla(35,57%,88%,0.49)': 'hsla(38,40%,84%,0.45)',
  '#d8e8c8': '#cad7a2',
  'rgba(228, 241, 215, 1)': '#d6dfb6',
  'hsla(98,61%,72%,0.7)': 'hsla(76,32%,60%,0.6)',
  'rgba(176, 213, 154, 1)': '#bfcc90',
  'rgba(95, 208, 100, 1)': '#97a865',
  '#DEE3CD': '#dfdcc4',
  'hsl(75,37%,81%)': '#d6d6b8',
  '#fde': '#eedcd0',
  'rgb(236,238,204)': '#e9e3c8',
  'rgba(247, 239, 195, 1)': '#efe2bf',
  'rgba(224, 236, 236, 1)': '#e6e6dc',
  'rgba(229, 228, 224, 1)': '#e2dbcc',
  '#f0ede9': '#ece4d4',
  // water
  'rgb(158,189,255)': '#8fb2b6',
  '#a0c8f0': '#86aaaf',
  // buildings
  'hsl(35,8%,85%)': '#ddd1bb',
  'hsla(35,6%,79%,0.32)': 'hsla(36,22%,66%,0.4)',
  'hsl(35,6%,79%)': '#c5b597',
  // roads: white minor streets, yellow major roads, orange motorways
  '#fff': '#fffcf5',
  '#ffffff': '#fffcf5',
  'hsl(0,0%,100%)': '#fffcf5',
  'rgba(255,255,255,0.7)': 'rgba(251,246,234,0.75)',
  '#fea': '#f2d99c',
  '#fff4c6': '#f5e5bb',
  '#fc8': '#e8c27f',
  '#ffdaa6': '#ecca94',
  'hsl(26,87%,62%)': '#d9a96a',
  '#e9ac77': '#c99c62',
  '#cfcdca': '#cbbca1',
  'hsl(36,6%,74%)': '#bfae8f',
  'hsl(35,6%,80%)': '#cbbca1',
  '#bbb': '#a99c84',
  'hsl(0,0%,70%)': '#b3a78f',
  // labels
  '#000': '#2b241d',
  '#333': '#2b241d',
  '#666': '#6e6352',
  'hsl(248,1%,41%)': '#6e6352',
  'hsl(30,23%,62%)': '#a08c6d',
  '#495e91': '#4e6a72',
  '#74aee9': '#6f9499',
  '#2e5a80': '#2f4a78',
}

// Night tint for the liberty style, for use in the dark: the same map as vellum
// with the light turned down. Umber land, buildings a step lighter, dim streets,
// muted amber main roads, deep teal water and dark olive parks; labels in pale
// parchment on dark halos (see NIGHT_HALO).
export const NIGHT_MAP_COLORS: Record<string, string> = {
  // land and land use
  '#f8f4f0': '#1d1915',
  'hsla(0,3%,85%,0.84)': 'hsla(30,10%,17%,0.6)',
  'hsla(35,57%,88%,0.49)': 'hsla(32,14%,19%,0.5)',
  '#d8e8c8': '#222a1d',
  'rgba(228, 241, 215, 1)': '#232a1f',
  'hsla(98,61%,72%,0.7)': 'hsla(85,18%,18%,0.7)',
  'rgba(176, 213, 154, 1)': '#26301f',
  'rgba(95, 208, 100, 1)': '#2c3a23',
  '#DEE3CD': '#24261d',
  'hsl(75,37%,81%)': '#262a1e',
  '#fde': '#2e2224',
  'rgb(236,238,204)': '#27271e',
  'rgba(247, 239, 195, 1)': '#2d291d',
  'rgba(224, 236, 236, 1)': '#262b2c',
  'rgba(229, 228, 224, 1)': '#252220',
  '#f0ede9': '#221e1a',
  // water
  'rgb(158,189,255)': '#1a2c30',
  '#a0c8f0': '#1c3034',
  // buildings
  'hsl(35,8%,85%)': '#2a251f',
  'hsla(35,6%,79%,0.32)': 'hsla(32,10%,30%,0.5)',
  'hsl(35,6%,79%)': '#332c25',
  // roads: dim minor streets, muted amber major roads and motorways
  '#fff': '#3b342c',
  '#ffffff': '#3b342c',
  'hsl(0,0%,100%)': '#3b342c',
  'rgba(255,255,255,0.7)': 'rgba(59,52,44,0.75)',
  '#fea': '#5c4a2c',
  '#fff4c6': '#4f4230',
  '#fc8': '#6b5230',
  '#ffdaa6': '#5e4b33',
  'hsl(26,87%,62%)': '#7a5a34',
  '#e9ac77': '#6e5234',
  '#cfcdca': '#2a251f',
  'hsl(36,6%,74%)': '#2c2620',
  'hsl(35,6%,80%)': '#2c2620',
  '#bbb': '#4a4238',
  'hsl(0,0%,70%)': '#4a4238',
  // labels
  '#000': '#d9cfbd',
  '#333': '#d9cfbd',
  '#666': '#a59a87',
  'hsl(248,1%,41%)': '#a59a87',
  'hsl(30,23%,62%)': '#8f7d63',
  '#495e91': '#7fa0a6',
  '#74aee9': '#5f8a90',
  '#2e5a80': '#8fa6c8',
}
// Every label halo at night: the land colour, so pale labels stand clear.
const NIGHT_HALO = '#1d1915'

export function tintStyle(
  style: maplibregl.StyleSpecification,
  colors: Record<string, string>,
  // Every text halo in this colour, whatever the original.
  halo?: string,
): maplibregl.StyleSpecification {
  // Colours sit in paint values directly or inside expressions (zoom stops).
  const swap = (value: unknown): unknown => {
    if (typeof value === 'string') return colors[value] ?? value
    if (Array.isArray(value)) return value.map(swap)
    return value
  }
  const layers = style.layers.map((layer) => {
    if (!('paint' in layer) || !layer.paint) return layer
    const paint = Object.fromEntries(
      Object.entries(layer.paint).map(([key, value]) => [
        key,
        halo && key === 'text-halo-color' ? halo : key.includes('color') ? swap(value) : value,
      ]),
    )
    return { ...layer, paint } as typeof layer
  })
  return { ...style, layers }
}

const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'

// OpenTopoMap: a topographic map with relief, contours and trails, best in the
// mountains. Raster tiles,
// so no tint, labels in the local language and nothing past zoom 17. Served by
// volunteers under a fair-use policy, so it's an option, never the default.
const TOPOGRAPHIC_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  // The place layers' labels (cluster counts, names) need fonts.
  glyphs: GLYPHS,
  sources: {
    opentopomap: {
      type: 'raster',
      tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
      tileSize: 256,
      maxzoom: 17,
      attribution:
        'Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors, SRTM · Style © <a href="https://opentopomap.org" target="_blank">OpenTopoMap</a> (CC-BY-SA)',
    },
  },
  layers: [{ id: 'opentopomap', type: 'raster', source: 'opentopomap' }],
}

// OpenRailwayMap: train, metro and tram lines on see-through tiles, laid over
// the map under its labels. Volunteer-run, under a fair-use policy, so an
// option, never the default. The tiles carry station names of their own, so
// they go above all of the map's roads and bridges, some of which come after
// its first labels; and the map's own stops (poi_transit), mostly bus stops
// named after the station they serve, would name each station twice: only its
// airports are kept.
function withRailways(style: maplibregl.StyleSpecification): maplibregl.StyleSpecification {
  const layers = style.layers.map((layer) =>
    layer.id === 'poi_transit'
      ? ({ ...layer, filter: ['==', ['get', 'class'], 'airport'] } as maplibregl.LayerSpecification)
      : layer,
  )
  const at = layers.findLastIndex((layer) => layer.type !== 'symbol') + 1
  const railways: maplibregl.LayerSpecification = { id: 'openrailwaymap', type: 'raster', source: 'openrailwaymap' }
  return {
    ...style,
    sources: {
      ...style.sources,
      openrailwaymap: {
        type: 'raster',
        tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png`),
        // The tiles are 512 pixels, drawn at 256 for sharp screens. Each zoom's
        // tiles are used from where they're shown at that size or larger, never
        // shrunk, as their station names would become too small to read: from
        // halfway between zooms, at the usual 256, they'd be at 71%.
        tileSize: Math.round(256 * Math.SQRT2),
        maxzoom: 19,
        attribution:
          'Railways © <a href="https://www.openrailwaymap.org" target="_blank">OpenRailwayMap</a> (CC-BY-SA)',
      },
    },
    layers: [...layers.slice(0, at), railways, ...layers.slice(at)],
  }
}

// How the place layers are drawn on a map type (see PlacesMap's addLayers).
export type PlaceInk = {
  // Place names and their halo.
  label: string
  halo: string
  // Ring under the selected place.
  selected: string
}

const DAY_INK: PlaceInk = { label: '#2b241d', halo: '#fffcf5', selected: '#2b241d' }
const NIGHT_INK: PlaceInk = { label: '#e6dccb', halo: '#1d1915', selected: '#e6dccb' }

export type MapType = {
  key: string
  label: string
  style: string | maplibregl.StyleSpecification
  transform: (style: maplibregl.StyleSpecification) => maplibregl.StyleSpecification
  ink: PlaceInk
}

// The base maps on offer; the first is the default.
export const MAP_TYPES: readonly MapType[] = [
  {
    key: 'map',
    label: 'Map',
    style: BASE_STYLE_URL,
    transform: (style) => tintStyle(flattenStyle(style), VELLUM_MAP_COLORS),
    ink: DAY_INK,
  },
  {
    key: 'night',
    label: 'Night',
    style: BASE_STYLE_URL,
    transform: (style) => tintStyle(flattenStyle(style), NIGHT_MAP_COLORS, NIGHT_HALO),
    ink: NIGHT_INK,
  },
  {
    key: 'topographic',
    label: 'Topographic',
    style: TOPOGRAPHIC_STYLE,
    transform: (style) => style,
    ink: DAY_INK,
  },
  {
    key: 'railways',
    label: 'Railways',
    style: BASE_STYLE_URL,
    transform: (style) => withRailways(tintStyle(flattenStyle(style), VELLUM_MAP_COLORS)),
    ink: DAY_INK,
  },
]

const MAP_TYPE_STORAGE = 'stede.mapType'

// The map type chosen last in this browser, or the default.
export function savedMapType(): MapType {
  try {
    const key = localStorage.getItem(MAP_TYPE_STORAGE)
    return MAP_TYPES.find((t) => t.key === key) ?? MAP_TYPES[0]
  } catch {
    return MAP_TYPES[0]
  }
}

export function saveMapType(type: MapType) {
  try {
    localStorage.setItem(MAP_TYPE_STORAGE, type.key)
  } catch {
    // Remembering the choice is a convenience only.
  }
}

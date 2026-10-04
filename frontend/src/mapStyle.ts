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

export function tintStyle(
  style: maplibregl.StyleSpecification,
  colors: Record<string, string>,
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
      Object.entries(layer.paint).map(([key, value]) => [key, key.includes('color') ? swap(value) : value]),
    )
    return { ...layer, paint } as typeof layer
  })
  return { ...style, layers }
}

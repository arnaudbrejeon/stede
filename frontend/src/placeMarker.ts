import { tagColor, type TagColors } from './tags'

// Marker images are named after the tags they show, e.g. "marker:art|must-see".
const PREFIX = 'marker:'
const SEPARATOR = '|'

export function markerImageId(tags: readonly string[]): string {
  return PREFIX + tags.join(SEPARATOR)
}

export function isMarkerImageId(id: string): boolean {
  return id.startsWith(PREFIX)
}

// Sizes in CSS px.
export const MARKER_RADIUS = 21.75
const OUTLINE = 4.5 // white edge so the ring reads against any map colour
const RING = 5.25 // tag-coloured band
const ICON_SIZE = 19.5

// Fixed icon for now (a house, 24×24 path). Later: chosen per place or category.
const ICON_PATH = 'M12 3.5 3.5 10.6V20.5h6v-6h5v6h6v-9.9z'
const ICON_VIEWBOX = 24
const ICON_COLOR = '#1d2733'

// White disc with the icon in the middle, ringed by one equal arc per tag.
export function drawMarker(id: string, colors: TagColors, pixelRatio: number): ImageData {
  const body = id.slice(PREFIX.length)
  const tags = body ? body.split(SEPARATOR) : []
  const size = Math.ceil(MARKER_RADIUS * 2 * pixelRatio)
  const ctx = new OffscreenCanvas(size, size).getContext('2d')!
  ctx.scale(pixelRatio, pixelRatio)
  const c = MARKER_RADIUS

  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(c, c, MARKER_RADIUS, 0, Math.PI * 2)
  ctx.fill()

  // Stroke centred on the band between the outline and the white inner disc.
  const ringRadius = MARKER_RADIUS - OUTLINE - RING / 2
  ctx.lineWidth = RING
  const segments = tags.length > 0 ? tags : [''] // untagged: one full grey ring
  const step = (Math.PI * 2) / segments.length
  segments.forEach((tag, i) => {
    const start = -Math.PI / 2 + i * step
    ctx.strokeStyle = tagColor(colors, tag)
    ctx.beginPath()
    ctx.arc(c, c, ringRadius, start, start + step)
    ctx.stroke()
  })

  const scale = ICON_SIZE / ICON_VIEWBOX
  ctx.translate(c - ICON_SIZE / 2, c - ICON_SIZE / 2)
  ctx.scale(scale, scale)
  ctx.fillStyle = ICON_COLOR
  ctx.fill(new Path2D(ICON_PATH))

  return ctx.getImageData(0, 0, size, size)
}

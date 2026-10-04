import { PLACE_ICONS, type PlaceIconKey } from './placeIcons'
import { tagColor, type TagColors } from './tags'

// Marker images are named after what they show, e.g. "marker:goblet:art|must-see".
const PREFIX = 'marker:'
const SEPARATOR = '|'

export function markerImageId(icon: PlaceIconKey, tags: readonly string[]): string {
  return `${PREFIX}${icon}:${tags.join(SEPARATOR)}`
}

export function isMarkerImageId(id: string): boolean {
  return id.startsWith(PREFIX)
}

// Sizes in CSS px.
export const MARKER_RADIUS = 21.75
const OUTLINE = 4.5 // white edge so the ring reads against any map colour
const RING = 5.25 // tag-coloured band
const ICON_SIZE = 19.5

const ICON_GRID = 24 // place icons are drawn on a 24×24 grid
const ICON_COLOR = '#1d2733'

// Search candidate: the inverse of a saved place (ink disc, white "+", same white
// outline) with a pulsing halo, so it never reads as one of your places. An HTML
// element rather than a map image so the halo can animate in CSS; styled in index.css.
export function createSearchPinElement(): HTMLElement {
  const pin = document.createElement('div')
  pin.className = 'search-pin'
  // Same size as a saved place's marker.
  pin.style.width = pin.style.height = `${MARKER_RADIUS * 2}px`
  pin.innerHTML =
    '<span class="search-pin-halo"></span>' +
    '<span class="search-pin-disc">' +
    '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">' +
    '<path d="M10 3.5v13M3.5 10h13" stroke="#fff" stroke-width="3" stroke-linecap="round"/>' +
    '</svg></span>'
  return pin
}

// White disc with the icon in the middle, ringed by one equal arc per tag.
export function drawMarker(id: string, colors: TagColors, pixelRatio: number): ImageData {
  const body = id.slice(PREFIX.length)
  const split = body.indexOf(':')
  const icon = PLACE_ICONS[body.slice(0, split) as PlaceIconKey] ?? PLACE_ICONS.lantern
  const tagList = body.slice(split + 1)
  const tags = tagList ? tagList.split(SEPARATOR) : []
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

  const scale = ICON_SIZE / ICON_GRID
  ctx.translate(c - ICON_SIZE / 2, c - ICON_SIZE / 2)
  ctx.scale(scale, scale)
  // Shapes are filled one by one so overlaps never cancel; holes are cut in white.
  ctx.fillStyle = ICON_COLOR
  for (const d of icon.fill) ctx.fill(new Path2D(d))
  ctx.fillStyle = '#fff'
  for (const d of icon.holes) ctx.fill(new Path2D(d))

  return ctx.getImageData(0, 0, size, size)
}

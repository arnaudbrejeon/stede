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
const OUTLINE = 4.5 // white edge so the colours read against any map colour
const CORE = 10.5 // white centre holding the icon
const ICON_SIZE = 15

const ICON_GRID = 24 // place icons are drawn on a 24×24 grid
// Iron-gall ink, as --ink in index.css (canvas and map layers can't read CSS).
export const INK = '#2b241d'

// Search candidate: the inverse of a saved place (--action disc, white "+", same
// white outline) with a pulsing halo, so it never reads as one of your places. An HTML
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

// A pie of the tags' colours, one equal wedge per tag, with the icon on a white
// core in the middle. (Until 2026-10-24 a thin ring, which read as an outline;
// see the designs on icons.html.)
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

  // Wedges from the centre out to the white outline, the first starting at the top.
  const pieRadius = MARKER_RADIUS - OUTLINE
  const segments = tags.length > 0 ? tags : [''] // untagged: one full grey disc
  const step = (Math.PI * 2) / segments.length
  segments.forEach((tag, i) => {
    const start = -Math.PI / 2 + i * step
    ctx.fillStyle = tagColor(colors, tag)
    ctx.beginPath()
    ctx.moveTo(c, c)
    ctx.arc(c, c, pieRadius, start, start + step)
    ctx.closePath()
    ctx.fill()
  })
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(c, c, CORE, 0, Math.PI * 2)
  ctx.fill()

  const scale = ICON_SIZE / ICON_GRID
  ctx.translate(c - ICON_SIZE / 2, c - ICON_SIZE / 2)
  ctx.scale(scale, scale)
  // Shapes are filled one by one so overlaps never cancel; holes are cut in white.
  ctx.fillStyle = INK
  for (const d of icon.fill) ctx.fill(new Path2D(d))
  ctx.fillStyle = '#fff'
  for (const d of icon.holes) ctx.fill(new Path2D(d))

  return ctx.getImageData(0, 0, size, size)
}

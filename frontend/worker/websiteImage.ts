// Find a photo of a place on its own website.
//
// First the page's preview image (og:image / twitter:image); failing that, the
// largest-looking photo the page references, which covers the many
// small-business sites (WordPress, Showit, Squarespace…) that never set a
// preview image.
//
// The page URL comes from OpenStreetMap data, so fetching it is a request
// forgery risk. On Cloudflare, Workers can only reach the public internet, not
// private networks; on top of that only http(s) URLs to hosts that aren't
// private addresses are fetched, every redirect hop is re-checked, and time and
// size are capped.

import type { Fetch } from './http'

const MAX_PAGE_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3
const IMAGE_PROPERTIES = ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image']

// Largest image we serve on a site's behalf.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
// A referenced photo must look at least this wide, and weigh at least this much
// when checked, to skip thumbnails, icons and spacers.
const MIN_PHOTO_WIDTH = 400
const MIN_PHOTO_BYTES = 20_000
const PHOTOS_TO_CHECK = 3

// Image URLs anywhere in the page: attributes, inline styles, embedded JSON.
const IMAGE_URL = /(?:https?:)?\/\/[^\s"'()<>\\]+?\.(?:jpe?g|png|webp)(?:\?[^\s"'()<>\\]*)?/gi
// Relative image paths in the usual attributes.
const RELATIVE_SRC =
  /(?:src|data-src|data-lazy-src|srcset|data-srcset)\s*=\s*["']([^"']+?\.(?:jpe?g|png|webp)[^"'\s,]*)/gi
const NOT_A_PHOTO =
  /logo|icon|favicon|sprite|avatar|badge|placeholder|spinner|loader|blank|pixel|emoji|flag|payment|button|arrow|cropped-/i
const WP_SIZE = /-(\d{2,4})x(\d{2,4})(?=\.(?:jpe?g|png|webp)\b)/gi
const SHOWIT_SIZE = /(static\.showit\.co\/)(\d{2,4})(\/)/
const WIDTH_PARAM = /[?&](?:w|width)=(\d{2,4})\b/
const META_TAG = /<meta\b[^>]*>/gi
const ATTRIBUTE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g

// The URL isn't a public http(s) address we're willing to fetch.
export class UnsafeURLError extends Error {}

export function checkPublicUrl(url: string): void {
  let parts: URL
  try {
    parts = new URL(url)
  } catch {
    throw new UnsafeURLError('not a URL')
  }
  if (!['http:', 'https:'].includes(parts.protocol) || !parts.hostname) {
    throw new UnsafeURLError('only http(s) URLs with a host are allowed')
  }
  if (parts.username || parts.password)
    throw new UnsafeURLError('URLs with credentials are not allowed')
  const host = parts.hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new UnsafeURLError('host is not public')
  }
  if (isPrivateAddress(host)) throw new UnsafeURLError('host is a non-public address')
}

// Loopback, private, link-local, carrier-grade NAT, unspecified and multicast
// addresses, written as an IPv4 or [IPv6] literal.
function isPrivateAddress(host: string): boolean {
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }
  if (host.startsWith('[')) {
    const v6 = host.slice(1, -1)
    if (v6 === '::' || v6 === '::1') return true
    const mapped = v6.match(/^::ffff:(.+)$/)
    if (mapped) return true // IPv4-mapped: refuse rather than decode
    return /^(fc|fd|fe[89ab]|ff)/.test(v6)
  }
  return false
}

export async function findWebsiteImage(url: string, fetch: Fetch): Promise<string | null> {
  const page = await fetchHtml(url, fetch)
  if (!page) return null
  const [html, pageUrl] = page
  const image = extractImage(html, pageUrl)
  if (image) return preferHttps(image, fetch)
  for (const candidate of photoCandidates(html, pageUrl).slice(0, PHOTOS_TO_CHECK)) {
    for (const copy of httpsFirst(candidate)) {
      if (await looksLikePhoto(copy, fetch)) return copy
    }
  }
  return null
}

// An http URL's https copy, then itself. Browsers block or rewrite http images on
// https pages, and some hosts answer plain http with a bot challenge.
export function httpsFirst(url: string): string[] {
  return url.startsWith('http://') ? ['https://' + url.slice('http://'.length), url] : [url]
}

// The first copy of a declared (unchecked) image that loads, https first.
async function preferHttps(url: string, fetch: Fetch): Promise<string> {
  for (const candidate of httpsFirst(url).slice(0, -1)) {
    if (await looksLikePhoto(candidate, fetch)) return candidate
  }
  return url
}

// A response, following redirects ourselves so each hop is checked first.
async function fetchChecked(url: string, fetch: Fetch): Promise<[Response, string] | null> {
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    checkPublicUrl(url)
    const response = await fetch(url, { redirect: 'manual' })
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel()
      url = new URL(location, url).href
      continue
    }
    return [response, url]
  }
  return null
}

// Up to `max` bytes of a body; null when `orNull` and the body is longer.
async function readCapped(
  response: Response,
  max: number,
  orNull = false,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
    if (size > max || (!orNull && size === max)) {
      await reader.cancel()
      if (orNull) return null
      break
    }
  }
  const body = new Uint8Array(Math.min(size, max))
  let offset = 0
  for (const chunk of chunks) {
    const part = chunk.subarray(0, body.length - offset)
    body.set(part, offset)
    offset += part.length
  }
  return body
}

// The page's HTML and final URL, following redirects safely.
async function fetchHtml(url: string, fetch: Fetch): Promise<[string, string] | null> {
  const fetched = await fetchChecked(url, fetch)
  if (!fetched) return null
  const [response, finalUrl] = fetched
  const type = response.headers.get('content-type') ?? ''
  if (response.status !== 200 || !type.includes('html')) {
    await response.body?.cancel()
    return null
  }
  const body = (await readCapped(response, MAX_PAGE_BYTES))!
  const charset = type.match(/charset=["']?([\w-]+)/i)?.[1] ?? 'utf-8'
  let decoder: TextDecoder
  try {
    decoder = new TextDecoder(charset)
  } catch {
    decoder = new TextDecoder()
  }
  return [decoder.decode(body), finalUrl]
}

function resolve(raw: string, base: string): string | null {
  try {
    const url = new URL(raw, base)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

// The page's declared preview image.
export function extractImage(html: string, pageUrl: string): string | null {
  const found = new Map<string, string>()
  for (const [tag] of html.matchAll(META_TAG)) {
    const attributes = new Map<string, string>()
    for (const m of tag.matchAll(ATTRIBUTE)) {
      attributes.set(m[1].toLowerCase(), decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''))
    }
    const key = (attributes.get('property') || attributes.get('name') || '').toLowerCase()
    const content = (attributes.get('content') ?? '').trim()
    if (IMAGE_PROPERTIES.includes(key) && content && !found.has(key)) found.set(key, content)
  }
  for (const key of IMAGE_PROPERTIES) {
    if (found.has(key)) return resolve(found.get(key)!, pageUrl)
  }
  return null
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

// Photos the page references, most promising first.
export function photoCandidates(html: string, pageUrl: string): string[] {
  const text = html.replaceAll('\\/', '/') // URLs inside embedded JSON
  const found = [
    ...[...text.matchAll(IMAGE_URL)].map((m) => m[0]),
    ...[...text.matchAll(RELATIVE_SRC)].map((m) => m[1]),
  ]
  // URL -> its best score and where it first appeared.
  const scored = new Map<string, [number, number]>()
  found.forEach((raw, order) => {
    const resolved = resolve(raw.trim(), pageUrl)
    if (!resolved) return
    const path = new URL(resolved).pathname
    if (NOT_A_PHOTO.test(path)) return
    const url = largestVariant(resolved)
    const width = widthHint(url)
    if (width !== null && width < MIN_PHOTO_WIDTH) return
    // Bigger first; unknown sizes count as medium; PNGs are often graphics.
    const score = (width ?? 900) - (path.toLowerCase().endsWith('.png') ? 300 : 0)
    const [best, first] = scored.get(url) ?? [score, order]
    scored.set(url, [Math.max(best, score), first])
  })
  return [...scored.entries()]
    .sort(([, a], [, b]) => b[0] - a[0] || a[1] - b[1])
    .map(([url]) => url)
}

// Point resized copies at a large version (WordPress -WxH, Showit width path).
function largestVariant(url: string): string {
  return url.replace(WP_SIZE, '').replace(SHOWIT_SIZE, '$11200$3')
}

function widthHint(url: string): number | null {
  const showit = url.match(SHOWIT_SIZE)
  if (showit) return Number(showit[2])
  const param = url.match(WIDTH_PARAM)
  return param ? Number(param[1]) : null
}

// A real, reasonably large image (headers only; the body isn't downloaded).
async function looksLikePhoto(url: string, fetch: Fetch): Promise<boolean> {
  try {
    const fetched = await fetchChecked(url, fetch)
    if (!fetched) return false
    const [response] = fetched
    await response.body?.cancel()
    if (response.status !== 200) return false
    if (!(response.headers.get('content-type') ?? '').startsWith('image/')) return false
    const length = response.headers.get('content-length')
    return length === null || Number(length) >= MIN_PHOTO_BYTES
  } catch {
    return false
  }
}

// An image's bytes and media type, fetched with the same safety checks as pages
// (every redirect hop re-checked, size capped); https first for http URLs.
export async function fetchImage(
  url: string,
  fetch: Fetch,
): Promise<[Uint8Array<ArrayBuffer>, string] | null> {
  for (const start of httpsFirst(url)) {
    try {
      const fetched = await fetchChecked(start, fetch)
      if (!fetched) continue
      const [response] = fetched
      const mediaType = (response.headers.get('content-type') ?? '').split(';')[0].trim()
      if (response.status !== 200 || !mediaType.startsWith('image/')) {
        await response.body?.cancel()
        continue
      }
      const body = await readCapped(response, MAX_IMAGE_BYTES, true)
      if (body) return [body, mediaType]
    } catch {
      continue
    }
  }
  return null
}

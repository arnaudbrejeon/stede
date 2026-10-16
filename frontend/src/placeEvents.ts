import { finalizeEvent, getPublicKey, nip44, type NostrEvent } from 'nostr-tools'
import type { PlaceIconKey } from './placeIcons'
import type { Place } from './places'
import { uniqueLabels } from './tags'

// Places as Nostr events: NIP-XX Places (https://github.com/nostr-protocol/nips/issues/2492).
//
// Your places are private: a kind 31301 event whose only tag is `d` and whose
// content is the NIP-44 encryption, to yourself, of an unsigned kind 31300
// place event {kind, tags, content}. The inner event follows the 31300 rules.
//
// What a place stores: its name, position, OpenStreetMap link, category (for its
// icon), address, your labels, note and icon. Other OSM details (hours, phone,
// website…) are fetched when the place is opened; an `osm:*`, `r` or `location`
// tag in the event is the user's own value and wins over the fetched one.

export const PLACE_KIND = 31300
export const PRIVATE_PLACE_KIND = 31301
const DELETION_KIND = 5
// NIP-32 label namespace (reverse domain of stede.cc) for the icon chosen in stede.
const ICON_LABEL = 'cc.stede.icon'
// NIP-73 identifier of the OpenStreetMap object: osm:node/123, osm:way/…, osm:relation/…
const OSM_ID_KIND = 'osm'
const OSM_TYPES: Record<string, string> = { N: 'node', W: 'way', R: 'relation' }
// The OSM keys whose value is a place's category, in the order they're tried.
const CATEGORY_KEYS = [
  'amenity',
  'shop',
  'tourism',
  'leisure',
  'craft',
  'office',
  'healthcare',
  'historic',
  'natural',
  'place',
  'sport',
  'public_transport',
  'railway',
  'aeroway',
  'highway',
  'man_made',
  'waterway',
  'landuse',
  'boundary',
  'building',
]

export type InnerPlace = { kind: number; tags: string[][]; content: string }

// What the user adds to a place themselves.
export type UserFields = {
  labels: string[]
  note: string
  // undefined: the category's default icon.
  icon?: PlaceIconKey
}

export const NO_USER_FIELDS: UserFields = { labels: [], note: '' }

// What's needed to save a new place, or a new version of one.
export type PlaceDraft = {
  id?: string
  name: string
  lngLat: [number, number]
  // OSM key and value of its category, e.g. amenity / restaurant.
  osmKey?: string
  osmValue?: string
  osmType?: string
  osmId?: number
  address?: string | null
  labels?: string[]
  note?: string | null
  icon?: string
}

export function placeTags(draft: PlaceDraft & { id: string }): string[][] {
  const [lng, lat] = draft.lngLat
  const tags: string[][] = [
    ['d', draft.id],
    ['name', draft.name.trim()],
    ['geo', `${round(lat)},${round(lng)}`],
    ...[4, 6, 9].map((length) => ['g', geohash(lat, lng, length)]),
  ]
  if (draft.address) tags.push(['location', draft.address])
  for (const label of uniqueLabels(draft.labels ?? [])) tags.push(['t', label])
  const osmType = draft.osmType && OSM_TYPES[draft.osmType]
  if (osmType && draft.osmId) {
    tags.push(['i', `${OSM_ID_KIND}:${osmType}/${draft.osmId}`], ['k', OSM_ID_KIND])
  }
  if (draft.osmKey && draft.osmValue) tags.push([`osm:${draft.osmKey}`, draft.osmValue])
  if (draft.icon) tags.push(['L', ICON_LABEL], ['l', draft.icon, ICON_LABEL])
  return tags
}

export function innerPlace(draft: PlaceDraft & { id: string }): InnerPlace {
  return { kind: PLACE_KIND, tags: placeTags(draft), content: draft.note?.trim() ?? '' }
}

// Tags the app writes from a draft. Any other tag (another app's label, an OSM
// value you set, an unknown tag) is carried over when a place is saved again.
const MANAGED_TAGS = new Set(['d', 'name', 'geo', 'g', 'location', 't', 'i', 'k'])

// A new version of a place: the draft's tags plus the previous version's tags
// the app doesn't manage.
export function keepUnmanagedTags(next: InnerPlace, previous: InnerPlace | undefined): InnerPlace {
  if (!previous) return next
  // Labels (L/l) are told apart by namespace, not by tag name.
  const written = new Set(next.tags.map((t) => t[0]).filter((name) => name !== 'L' && name !== 'l'))
  const isIconLabel = (t: string[]) =>
    (t[0] === 'L' && t[1] === ICON_LABEL) || (t[0] === 'l' && t[2] === ICON_LABEL)
  const kept = previous.tags.filter(
    (t) => !MANAGED_TAGS.has(t[0]) && !written.has(t[0]) && !isIconLabel(t),
  )
  // An `L` namespace tag is only kept once, however many labels use it.
  const tags = [...next.tags]
  for (const tag of kept) {
    if (tag[0] === 'L' && tags.some((t) => t[0] === 'L' && t[1] === tag[1])) continue
    tags.push(tag)
  }
  return { ...next, tags }
}

// The app's view of a decrypted place; null when it isn't a valid place.
export function placeFromInner(inner: InnerPlace): Place | null {
  const value = (name: string) => inner.tags.find((t) => t[0] === name)?.[1]
  const id = value('d')
  const name = value('name')?.trim()
  const geo = value('geo')
  if (inner.kind !== PLACE_KIND || !id || !name || !geo) return null
  const coordinates = parseGeo(geo)
  if (!coordinates) return null

  const osmTag = (key: string) => value(`osm:${key}`)
  const categoryKey = CATEGORY_KEYS.find((key) => osmTag(key))
  const osm = inner.tags
    .find((t) => t[0] === 'i' && t[1]?.startsWith(`${OSM_ID_KIND}:`))?.[1]
    ?.match(/^osm:(node|way|relation)\/(\d+)$/)
  const icon = inner.tags.find((t) => t[0] === 'l' && t[2] === ICON_LABEL)?.[1]
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates },
    properties: {
      id,
      name,
      category: categoryKey ? osmTag(categoryKey)! : '',
      ...(categoryKey && { category_key: categoryKey }),
      tags: inner.tags.filter((t) => t[0] === 't' && t[1]).map((t) => t[1]),
      website: value('r') ?? null,
      address: value('location') ?? null,
      comment: inner.content || null,
      ...(osm && { osm_type: osm[1][0].toUpperCase(), osm_id: Number(osm[2]) }),
      ...(icon && { icon: icon as Place['properties']['icon'] }),
    },
  }
}

// The draft a saved place starts from when it's saved again.
export function draftFromPlace(place: Place): PlaceDraft & { id: string } {
  const p = place.properties
  const [lng, lat] = place.geometry.coordinates
  return {
    id: p.id,
    name: p.name,
    lngLat: [lng, lat],
    osmKey: p.category_key,
    osmValue: p.category || undefined,
    osmType: p.osm_type,
    osmId: p.osm_id,
    address: p.address,
    labels: p.tags,
    note: p.comment,
    icon: p.icon,
  }
}

export function conversationKey(secretKey: Uint8Array): Uint8Array {
  return nip44.v2.utils.getConversationKey(secretKey, getPublicKey(secretKey))
}

// Encrypts a place to its author and signs the private place event.
export function sealPlace(inner: InnerPlace, secretKey: Uint8Array, createdAt = now()): NostrEvent {
  const d = inner.tags.find((t) => t[0] === 'd')![1]
  return finalizeEvent(
    {
      kind: PRIVATE_PLACE_KIND,
      created_at: createdAt,
      tags: [['d', d]],
      content: nip44.v2.encrypt(JSON.stringify(inner), conversationKey(secretKey)),
    },
    secretKey,
  )
}

// Decrypts a private place event; throws when it isn't one of ours.
export function openPlace(event: NostrEvent, key: Uint8Array): InnerPlace {
  if (event.kind !== PRIVATE_PLACE_KIND) throw new Error(`Not a private place: kind ${event.kind}`)
  const inner = JSON.parse(nip44.v2.decrypt(event.content, key)) as InnerPlace
  const outerD = event.tags.find((t) => t[0] === 'd')?.[1]
  const innerD = inner.tags?.find((t) => t[0] === 'd')?.[1]
  if (!outerD || outerD !== innerD) throw new Error('The place inside does not match its event')
  return inner
}

// NIP-09 deletion request for private places (one event can carry hundreds).
// It only covers versions dated up to its own created_at, and relays then refuse
// versions of those places dated up to it.
export function deletionEvent(
  ids: string | readonly string[],
  secretKey: Uint8Array,
  createdAt = now(),
): NostrEvent {
  const pubkey = getPublicKey(secretKey)
  return finalizeEvent(
    {
      kind: DELETION_KIND,
      created_at: createdAt,
      tags: [
        ...(typeof ids === 'string' ? [ids] : ids).map((id) => [
          'a',
          `${PRIVATE_PLACE_KIND}:${pubkey}:${id}`,
        ]),
        ['k', String(PRIVATE_PLACE_KIND)],
      ],
      content: '',
    },
    secretKey,
  )
}

// [lng, lat] of an RFC 5870 geo path ("48.86004,2.32663", optionally "geo:" and ";params").
export function parseGeo(value: string): [number, number] | null {
  const path = value.trim().replace(/^geo:/i, '').split(';')[0]
  const [lat, lng] = path.split(',').map(Number)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return [lng, lat]
}

const GEOHASH_ALPHABET = '0123456789bcdefghjkmnpqrstuvwxyz'

export function geohash(lat: number, lng: number, length: number): string {
  const latRange = [-90, 90]
  const lngRange = [-180, 180]
  let out = ''
  let bits = 0
  let bit = 0
  let even = true
  while (out.length < length) {
    const range = even ? lngRange : latRange
    const value = even ? lng : lat
    const mid = (range[0] + range[1]) / 2
    bits = bits * 2 + (value >= mid ? 1 : 0)
    range[value >= mid ? 0 : 1] = mid
    even = !even
    if (++bit === 5) {
      out += GEOHASH_ALPHABET[bits]
      bits = 0
      bit = 0
    }
  }
  return out
}

// 7 decimals is about a centimetre.
function round(degrees: number): string {
  return String(Math.round(degrees * 1e7) / 1e7)
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

import { keepUnmanagedTags, placeFromInner, type InnerPlace } from './placeEvents'
import { uniqueLabels } from './tags'

// Export and import of your places as a JSON file. Each place is the unsigned
// NIP-XX Places event (kind 31300) that the private place event encrypts, so
// the file reads like the events themselves, and other data (a Mapstr export,
// see backend/scripts/mapstr_to_stede.py) converts to it without an app.
//
//   {
//     "format": "stede-places", "version": 1, "exported_at": 1760650000,
//     "labels": { "To try": { "color": "#6edf38" } },   // optional
//     "places": [{ "kind": 31300, "created_at": …, "tags": [["d", …], …], "content": "…" }]
//   }
//
// The file is not encrypted: it holds your places in plain text.

export const FILE_FORMAT = 'stede-places'
export const FILE_VERSION = 1

export type FilePlace = InnerPlace & { created_at?: number }
export type PlacesFile = {
  format: typeof FILE_FORMAT
  version: number
  exported_at: number
  labels?: Record<string, { color?: string }>
  places: FilePlace[]
}

// A place as the store holds it: its decrypted event and the version's date.
export type PlaceRecord = { inner: InnerPlace; createdAt: number }

export function buildPlacesFile(records: Iterable<PlaceRecord>, exportedAt: number): PlacesFile {
  const places = [...records]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ inner, createdAt }) => ({
      kind: inner.kind,
      created_at: createdAt,
      tags: inner.tags,
      content: inner.content,
    }))
  return { format: FILE_FORMAT, version: FILE_VERSION, exported_at: exportedAt, places }
}

export type ParsedFile = { places: FilePlace[]; invalid: number }

// The valid places of a file; throws when it isn't a stede places file at all.
export function parsePlacesFile(text: string): ParsedFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('This file is not JSON.')
  }
  const file = data as Partial<PlacesFile> | null
  if (file?.format !== FILE_FORMAT || !Array.isArray(file.places))
    throw new Error('This is not a stede places file.')
  if (typeof file.version !== 'number' || file.version > FILE_VERSION)
    throw new Error('This file was made by a newer version of stede.')
  const places: FilePlace[] = []
  let invalid = 0
  for (const raw of file.places) {
    const place = cleanPlace(raw)
    if (place && placeFromInner(place)) places.push(place)
    else invalid++
  }
  return { places, invalid }
}

function cleanPlace(raw: unknown): FilePlace | null {
  const p = raw as Partial<FilePlace> | null
  if (!p || p.kind !== 31300 || !Array.isArray(p.tags)) return null
  const tags = p.tags.filter(
    (t): t is string[] =>
      Array.isArray(t) && t.length >= 2 && t.every((v) => typeof v === 'string'),
  )
  const createdAt = Number.isInteger(p.created_at) ? p.created_at : undefined
  return {
    kind: 31300,
    tags,
    content: typeof p.content === 'string' ? p.content : '',
    ...(createdAt !== undefined && { created_at: createdAt }),
  }
}

// What an import writes. `previous` is the version it replaces, if any.
export type ImportWrite = { inner: InnerPlace; previous?: PlaceRecord }
export type ImportPlan = {
  writes: ImportWrite[]
  added: number
  // Same place (same d) in a newer version.
  updated: number
  // A different event for a place you already have (or twice in the file).
  merged: number
  unchanged: number
}

// Duplicates: the same name (ignoring case, accents and punctuation) and either
// the same OpenStreetMap object or within this distance.
const DUPLICATE_DISTANCE_M = 100

// Works out what importing `incoming` into `existing` (by d) writes. A place
// with a d you already have replaces it only if the file's version is newer;
// a duplicate of another place is merged into it (see mergePlaces).
export function planImport(
  existing: ReadonlyMap<string, PlaceRecord>,
  incoming: readonly FilePlace[],
): ImportPlan {
  // Where each place stands as the import goes, keyed by d.
  const current = new Map<string, { inner: InnerPlace; record?: PlaceRecord; touched?: boolean }>()
  for (const [d, record] of existing) current.set(d, { inner: record.inner, record })
  const byName = new Map<string, string[]>()
  const index = (d: string, inner: InnerPlace) => {
    const key = nameKey(inner)
    if (key) byName.set(key, [...(byName.get(key) ?? []), d])
  }
  for (const [d, { inner }] of current) index(d, inner)

  let added = 0
  let updated = 0
  let merged = 0
  let unchanged = 0
  const changed = new Set<string>()

  for (const place of incoming) {
    const d = tag(place, 'd')!
    const { created_at: createdAt, ...inner } = place
    const same = current.get(d)
    if (same) {
      // Another version of a place you have: the newer one wins.
      const theirs = createdAt ?? 0
      const ours = same.record?.createdAt ?? 0
      if (same.touched) {
        // Twice in this file: one place, so merge what the second copy adds.
        const result = mergePlaces(same.inner, inner)
        if (equalPlaces(result, same.inner)) unchanged++
        else {
          same.inner = result
          changed.add(d)
          merged++
        }
        continue
      }
      if (theirs <= ours || equalPlaces(same.inner, inner)) {
        unchanged++
        continue
      }
      same.inner = keepUnmanagedTags(inner, same.inner)
      same.touched = true
      changed.add(d)
      updated++
      continue
    }
    const duplicate = (byName.get(nameKey(inner) ?? '') ?? [])
      .map((id) => ({ id, entry: current.get(id)! }))
      .find(({ entry }) => isDuplicate(entry.inner, inner))
    if (duplicate) {
      const result = mergePlaces(duplicate.entry.inner, inner)
      if (equalPlaces(result, duplicate.entry.inner)) unchanged++
      else {
        duplicate.entry.inner = result
        changed.add(duplicate.id)
        merged++
      }
      continue
    }
    current.set(d, { inner, touched: true })
    index(d, inner)
    changed.add(d)
    added++
  }

  const writes = [...changed].map((d) => {
    const entry = current.get(d)!
    return { inner: entry.inner, ...(entry.record && { previous: entry.record }) }
  })
  return { writes, added, updated, merged, unchanged }
}

// `base` with what `other` adds: its labels, a comment that differs, and any
// tag `base` lacks (address, OSM link, icon, other apps' labels). The name and
// position stay `base`'s.
export function mergePlaces(base: InnerPlace, other: InnerPlace): InnerPlace {
  const labels = uniqueLabels([...values(base, 't'), ...values(other, 't')])
  const tags = base.tags.filter((t) => t[0] !== 't')
  tags.push(...labels.map((l) => ['t', l]))
  const has = (t: string[]) =>
    t[0] === 'l'
      ? tags.some((x) => x[0] === 'l' && x[2] === t[2])
      : t[0] === 'L'
        ? tags.some((x) => x[0] === 'L' && x[1] === t[1])
        : tags.some((x) => x[0] === t[0])
  // An `i` link comes with its `k`, so both are taken only when base has no link.
  const baseLinked = base.tags.some((t) => t[0] === 'i')
  for (const t of other.tags) {
    if (t[0] === 't' || t[0] === 'g') continue
    if (t[0] === 'i' || t[0] === 'k') {
      if (!baseLinked) tags.push(t)
      continue
    }
    if (!has(t)) tags.push(t)
  }
  const a = base.content.trim()
  const b = other.content.trim()
  const content = !b || a.includes(b) ? base.content : !a ? b : `${a}\n\n${b}`
  return { kind: base.kind, tags, content }
}

function isDuplicate(a: InnerPlace, b: InnerPlace): boolean {
  if (nameKey(a) !== nameKey(b)) return false
  const osmA = osmLink(a)
  if (osmA && osmA === osmLink(b)) return true
  const pa = placeFromInner(a)?.geometry.coordinates
  const pb = placeFromInner(b)?.geometry.coordinates
  return (
    !!pa &&
    !!pb &&
    distanceM(pa as [number, number], pb as [number, number]) <= DUPLICATE_DISTANCE_M
  )
}

// "Gili-Gili" and "gili gili" are the same name.
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function nameKey(inner: InnerPlace): string | undefined {
  const name = tag(inner, 'name')
  return name ? normalizeName(name) || undefined : undefined
}

function osmLink(inner: InnerPlace): string | undefined {
  return inner.tags.find((t) => t[0] === 'i' && t[1].startsWith('osm:'))?.[1]
}

function equalPlaces(a: InnerPlace, b: InnerPlace): boolean {
  return a.content === b.content && JSON.stringify(a.tags) === JSON.stringify(b.tags)
}

function tag(inner: InnerPlace, name: string): string | undefined {
  return inner.tags.find((t) => t[0] === name)?.[1]
}

function values(inner: InnerPlace, name: string): string[] {
  return inner.tags.filter((t) => t[0] === name).map((t) => t[1])
}

// Great-circle distance between two [lng, lat] points.
export function distanceM([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h))
}

// Tag colours: medieval pigments as they looked when new, anchored on gold leaf
// and kept just short of the screen's maximum saturation so they read as paint,
// not neon. Light and dark pigments alternate so similar hues still differ in
// lightness. No 14-colour set stays fully distinguishable (closest pair ΔE 11.2;
// worst for colour-blind viewers 3.4), so tag names are always shown next to
// colours (chips, drawer). See docs/palette.md.
export const TAG_PALETTE = [
  '#3351ed', // lapis ultramarine
  '#f8701c', // red lead
  '#19b7a1', // verdigris
  '#e5b320', // gold leaf
  '#f44488', // madder rose
  '#189152', // malachite
  '#8c25bb', // folium purple
  '#ea241c', // vermilion
  '#864311', // burnt sienna
  '#006b6e', // terre verte
  '#8f185f', // murex
  '#889a19', // sap green
  '#ba8cec', // woad lilac
  '#053ca4', // azurite
]
export const UNTAGGED_COLOR = '#7a8794'

export type TagColors = ReadonlyMap<string, string>

// Assign slots in a fixed order over the full tag list (not the filtered one), so a
// tag keeps its colour whatever is filtered. Past the palette size colours repeat.
// "To try" and "been there" always take the first two slots; ratings share gold.
export function buildTagColors(tags: readonly string[]): TagColors {
  const ordered = [TO_TRY, BEEN_THERE, ...tags.filter((t) => !DEFAULT_TAGS.includes(t))]
  const colors = new Map(ordered.map((tag, i) => [tag, TAG_PALETTE[i % TAG_PALETTE.length]]))
  for (const tag of STAR_TAGS) colors.set(tag, TAG_PALETTE[3])
  return colors
}

export function tagColor(colors: TagColors, tag: string): string {
  return colors.get(tag) ?? UNTAGGED_COLOR
}

// Labels every user has: whether you've been, and a rating out of five. Labels
// keep the case they were written in ("Best OC"); two labels that differ only in
// case are the same label (see sameLabel).
export const TO_TRY = 'To try'
export const BEEN_THERE = 'Been there'
export const STAR_TAGS = [1, 2, 3, 4, 5].map((n) => (n === 1 ? '1 star' : `${n} stars`))
export const DEFAULT_TAGS = [TO_TRY, BEEN_THERE, ...STAR_TAGS]

// The rating a place's labels give it, 0 when none.
export function starsOf(labels: readonly string[]): number {
  return STAR_TAGS.findIndex((tag) => labels.includes(tag)) + 1
}

// Sets one of the built-in labels, keeping them consistent: "to try" and "been
// there" exclude each other, and a rating means you've been there.
export function withDefaultTag(labels: readonly string[], tag: string, on: boolean): string[] {
  const rest = labels.filter((l) => l !== tag)
  if (!on) return tag === BEEN_THERE ? rest.filter((l) => !STAR_TAGS.includes(l)) : rest
  if (tag === TO_TRY) return [...rest.filter((l) => l !== BEEN_THERE && !STAR_TAGS.includes(l)), tag]
  if (tag === BEEN_THERE) return [...rest.filter((l) => l !== TO_TRY), tag]
  // A rating replaces any other and implies "been there".
  const others = rest.filter((l) => l !== TO_TRY && !STAR_TAGS.includes(l))
  return [...others, ...(others.includes(BEEN_THERE) ? [] : [BEEN_THERE]), tag]
}

// How a label reads: as written, and "★★★" for "3 stars".
export function tagLabel(tag: string): string {
  const stars = STAR_TAGS.indexOf(tag) + 1
  return stars ? '★'.repeat(stars) : tag
}

export function sameLabel(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0
}

// Labels without repeats, ignoring case; the first spelling wins, and the
// built-in labels take their own spelling ("to try" becomes "To try").
export function uniqueLabels(labels: readonly string[]): string[] {
  const out: string[] = []
  for (const raw of labels) {
    const label = raw.trim()
    if (!label || out.some((l) => sameLabel(l, label))) continue
    out.push(DEFAULT_TAGS.find((t) => sameLabel(t, label)) ?? label)
  }
  return out
}

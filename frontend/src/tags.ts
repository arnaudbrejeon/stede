// Tag colours: each hue pushed to near its maximum sRGB saturation (OKLCH), with
// lightness moved toward where that hue is most vivid; navy and brown keep their
// darkness, which is what separates them from blue and orange. No 14-colour set
// stays distinguishable (validator: red/orange ΔE 8.9, olive/green ΔE 0.9 protan),
// so tag names are always shown next to colours (chips, drawer).
export const TAG_PALETTE = [
  '#167ded', // blue
  '#f8601a', // orange
  '#25c58b', // aqua
  '#f2a613', // yellow
  '#fb4c9a', // magenta
  '#1eb11b', // green
  '#601df7', // violet
  '#f82032', // red
  '#94560f', // brown
  '#1fa7b3', // teal
  '#d51dba', // plum
  '#97ac1e', // olive
  '#c93bfa', // lavender
  '#053894', // navy
]
export const UNTAGGED_COLOR = '#7a8794'

export type TagColors = ReadonlyMap<string, string>

// Assign slots in a fixed order over the full tag list (not the filtered one), so a
// tag keeps its colour whatever is filtered. Past the palette size colours repeat.
export function buildTagColors(tags: readonly string[]): TagColors {
  return new Map(tags.map((tag, i) => [tag, TAG_PALETTE[i % TAG_PALETTE.length]]))
}

export function tagColor(colors: TagColors, tag: string): string {
  return colors.get(tag) ?? UNTAGGED_COLOR
}

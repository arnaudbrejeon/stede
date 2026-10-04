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
export function buildTagColors(tags: readonly string[]): TagColors {
  return new Map(tags.map((tag, i) => [tag, TAG_PALETTE[i % TAG_PALETTE.length]]))
}

export function tagColor(colors: TagColors, tag: string): string {
  return colors.get(tag) ?? UNTAGGED_COLOR
}

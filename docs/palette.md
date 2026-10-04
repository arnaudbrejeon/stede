# Palette: Vellum & ink, fresh pigments

Drawn from the Ellesmere Chaucer manuscript: a quiet vellum interface, iron-gall
ink for text, and pigments as they looked when new for the tag colours, which
stay the only vivid things on the map. Preview: `npm run dev` in `frontend/`,
then `/palette.html`.

## Interface

Defined as CSS variables in `frontend/src/index.css` (`:root`). Canvas and map
layers can't read CSS, so the ink is repeated as `INK` in
`frontend/src/placeMarker.ts`.

| Token | Hex | Role | Contrast on vellum |
|---|---|---|---|
| `--vellum` | `#f5efe3` | page and header background | n/a |
| `--panel` | `#fbf8f1` | panels, drawer, cards | n/a |
| `--line` | `#e2d8c4` | borders and dividers | decorative |
| `--hover` | `#f1e9d8` | hovered or active rows | n/a |
| `--ink` | `#2b241d` | text, icons, logo, primary button, clusters | 13.4 : 1 |
| `--muted` | `#6e6352` | secondary text | 5.1 : 1 |
| `--rubric` | `#b8321f` | the one accent: focus outlines, selection | 5.2 : 1 |
| `--lapis` | `#2b4fb8` | links | 6.3 : 1 |
| `--gold` | `#e5b320` | decoration only (header quote marks) | 1.7 : 1, never for text |

## Tag colours

`TAG_PALETTE` in `frontend/src/tags.ts`, assigned to tags in a fixed order.

| Slot | Pigment | Hex |
|---|---|---|
| 1 | Lapis ultramarine | `#3351ed` |
| 2 | Red lead | `#f8701c` |
| 3 | Verdigris | `#19b7a1` |
| 4 | Gold leaf | `#e5b320` |
| 5 | Madder rose | `#f44488` |
| 6 | Malachite | `#189152` |
| 7 | Folium purple | `#8c25bb` |
| 8 | Vermilion | `#ea241c` |
| 9 | Burnt sienna | `#864311` |
| 10 | Terre verte | `#006b6e` |
| 11 | Murex | `#8f185f` |
| 12 | Sap green | `#889a19` |
| 13 | Woad lilac | `#ba8cec` |
| 14 | Azurite | `#053ca4` |

How they were chosen: gold leaf sets the strength (close to the earlier tag
yellow); the others keep their pigment hue at about 90% of the maximum sRGB
saturation for their lightness. At 100% vermilion and madder turn neon and
burnt sienna collapses into vermilion for red-blind viewers. Light and dark
pigments alternate so similar hues (verdigris / terre verte, lapis / azurite)
differ in lightness.

Distinctness (OKLab ΔE ×100, all pairs): closest pair for normal vision 11.2,
worst for colour-blind viewers 3.4 (the previous neon palette: 8.9 / 0.9). No
14-colour set passes the usual thresholds, so tag names are always shown next
to their colour.

## Base map

OpenFreeMap's liberty style, flattened (no 3D buildings, no points of interest;
transit kept) and tinted: every colour it uses is mapped to a vellum equivalent
in `VELLUM_MAP_COLORS` (`frontend/src/mapStyle.ts`). Light parchment land,
near-white streets with darker edges, ochre major roads, teal water and olive
parks keep about the original style's contrast. Transit icons are sprite images
and keep their own blue.

# Place icons

Icons shown in the middle of map pins. Single-colour silhouettes with a medieval
touch, drawn on a 24×24 grid and readable at pin size (~19 px).

## Set

The first icon of each category is its default; alternatives are kept for users
to pick per place later.

| # | Category | Default | Alternatives | OSM tags (default mapping) |
|---|---|---|---|---|
| 1 | Restaurant | Plate and spoon (`plate`) | Roast leg (`drumstick`), Cauldron (`cauldron`) | `restaurant`, `fast_food`, `food_court` |
| 2 | Café & bakery | Steaming pot (`steaming-pot`) | Round loaf (`loaf`) | `cafe`, `bakery`, `pastry`, `ice_cream`, `confectionery`, `tea`, `coffee` |
| 3 | Bar & pub | Goblet (`goblet`) | Lidded tankard (`tankard`) | `bar`, `pub`, `biergarten`, `wine`, `alcohol` |
| 4 | Museum & art | Arched portico (`portico`) | Illuminated manuscript (`manuscript`) | `museum`, `gallery`, `artwork`, `arts_centre` |
| 5 | Monument & history | Castle keep (`keep`) | City gate (`city-gate`) | `attraction`, `monument`, `memorial`, `castle`, `ruins`, `archaeological_site`, `tower`; any `historic=*` |
| 6 | Place of worship | Arched window (`gothic-window`) | Bell (`bell`) | `place_of_worship`, `church`, `cathedral`, `chapel`, `monastery` |
| 7 | Lodging | Inn sign (`inn-sign`) | Four-poster bed (`four-poster`) | `hotel`, `guest_house`, `hostel`, `motel`, `camp_site`, `chalet`, `apartment` |
| 8 | Shop & market | Market stall (`market-stall`) | Coin purse (`coin-purse`) | `marketplace`, `mall`; any `shop=*` |
| 9 | Park & nature | Oak tree (`oak`) | Fleur-de-lis (`fleur-de-lis`) | `park`, `garden`, `nature_reserve`, `wood`, `forest`, `beach`, `peak`, `viewpoint`; any `natural=*` |
| 10 | Sport & leisure | Heater shield (`shield`) | Crossed lances (`crossed-lances`) | `sports_centre`, `pitch`, `stadium`, `fitness_centre`, `swimming_pool`, `golf_course`; any `sport=*` |
| 11 | Music & shows | Lute (`lute`) | Jester's cap (`jester-cap`) | `theatre`, `cinema`, `nightclub`, `music_venue`, `concert_hall` |
| 12 | Home & other | Lantern (`lantern`) | Thatched cottage (`cottage`) | everything else |

## Ideas not drawn yet

| Category | Motif | Would cover |
|---|---|---|
| Viewpoint & scenery | Watchtower | `tourism=viewpoint` (now under Park & nature) |
| Books & study | Open book | `amenity=library`, `university` |
| Water & beach | Cog ship | `natural=beach`, marinas |
| Health | Apothecary jar | `amenity=pharmacy`, `hospital` |

## Notes from review

- Clear at pin size: plate, roast leg, loaf, goblet, manuscript, keep, city gate,
  bell, arched window, coin purse, oak, fleur-de-lis, shield, lute, lantern.
- Weaker: four-poster bed (hard to read small), arched portico (arches only show
  large), steaming pot (reads as a modern cup), thatched cottage (thatch doesn't
  show), inn sign (a bit busy), cauldron flames (small).
- The jester's cap first read as a crown with upright points; drooping points fixed it.

## Design rules

- One colour (ink `#1d2733`) on the pin's white centre; colour belongs to the tag ring.
- No thin lines: solid masses, gaps of at least ~2 px at 24×24.
- Distinct outlines per icon, especially among buildings (portico, keep, gate, window).
- Neutral motifs for place of worship (window, bell rather than a cross or spire).

## Where things live

- `frontend/scripts/place_icons.py`: the source of truth. Icons are built from simple
  shapes (`fill` painted in ink, `holes` cut in white), plus the category list
  (default first). Run `python3 scripts/place_icons.py` from `frontend/` to
  regenerate `frontend/src/placeIcons.ts`; never edit that file by hand.
- `frontend/src/placeIconChoice.ts`: OSM tag → category mapping, and which icon a
  place shows (its own choice, else its category's default).
- `frontend/src/placeMarker.ts`: draws the icon inside the pin.
- Preview: `npm run dev` in `frontend/`, then open `/icons.html` (dev only, not
  shipped) to see every icon large, at 24 px and inside real-size pins.

## Adding an icon

1. Draw it in `scripts/place_icons.py` with `icon(...)` and add its key to a
   category in `CATEGORIES` (first position makes it the default).
2. For a new category, also map its OSM values or keys in `placeIconChoice.ts`.
3. Regenerate, check `/icons.html` at pin size, and update the tables above.

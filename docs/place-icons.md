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
| 7 | Lodging | Inn sign (`inn-sign`) | Pavilion tent (`pavilion`) | `hotel`, `guest_house`, `hostel`, `motel`, `camp_site`, `chalet`, `apartment` |
| 8 | Shop & market | Market stall (`market-stall`) | Coin purse (`coin-purse`) | `marketplace`, `mall`, `supermarket`, `deli`, `clothes`, `gift`, `jewelry`, `electronics`, `garden_centre`, `farm`; any `shop=*` |
| 9 | Park & nature | Oak tree (`oak`) | Fleur-de-lis (`fleur-de-lis`) | `park`, `garden`, `nature_reserve`, `wood`, `forest`, `viewpoint`, `zoo`; any `natural=*` |
| 10 | Sport & leisure | Heater shield (`shield`) | Crossed lances (`crossed-lances`) | `sports_centre`, `pitch`, `stadium`, `fitness_centre`, `swimming_pool`, `golf_course`; any `sport=*` |
| 11 | Music & shows | Lute (`lute`) | Jester's cap (`jester-cap`) | `theatre`, `cinema`, `nightclub`, `music_venue`, `concert_hall` |
| 12 | Travel & roads | Covered wagon (`carriage`) | Horse's head (`horse`), Wayside signpost (`signpost`) | `road`, `car_rental`, `driving_school`, `parking`, `rest_area`, `services`, `fuel`, `charging_station`, `station`, `bus_station`, `aerodrome` |
| 13 | Water & beach | Cog ship (`cog-ship`) | | `beach`, `marina`, `harbour`, `ferry_terminal`, `bay`, `coastline` |
| 14 | Mountains & hiking | Mountain peaks (`peaks`) | Campfire (`campfire`) | `peak`, `volcano`, `mountain_pass`, `saddle`, `ridge`, `cliff`, `trailhead` |
| 15 | Towns & cities | Walled town (`walled-town`) | | `city`, `town`, `village`, `hamlet`, `suburb`, `neighbourhood`, `quarter` |
| 16 | Books & learning | Clasped tome (`tome`) | | `library`, `school`, `university`, `college`, `kindergarten` |
| 17 | Health | Apothecary jar (`apothecary-jar`) | | `pharmacy`, `hospital`, `clinic`, `doctors`, `dentist`, `chemist` |
| 18 | Civic | Scales of justice (`scales`) | | `townhall`, `courthouse`, `embassy`, `post_office`, `police` |
| 19 | Home & other | Lantern (`lantern`) | Thatched cottage (`cottage`) | everything else |

## Ideas not drawn yet

| Category | Motif | Would cover |
|---|---|---|
| Viewpoint & scenery | Watchtower | `tourism=viewpoint` (now under Park & nature) |
| Work & industry | Watermill or anvil | Mapstr `business`, `industry` |
| Fun & fairs | Carousel | `theme_park`, Mapstr `amusement` |
| Zoo | Rampant lion or bear | `zoo` (now under Park & nature) |
| Food variety | Pie, pretzel, wafer… | alternatives for burger, pizza, ice cream |

## Notes from review

- Clear at pin size: plate, roast leg, loaf, goblet, manuscript, keep, city gate,
  bell, arched window, coin purse, oak, fleur-de-lis, shield, lute, lantern,
  covered wagon, horse's head.
- Removed: four-poster bed (hard to read small), scallop shell, pilgrim's staff (read as a pin), walking boot.
- Weaker: arched portico (arches only show
  large), steaming pot (reads as a modern cup), thatched cottage (thatch doesn't
  show), inn sign (a bit busy). The cauldron's flames were too small; removed.
- The jester's cap first read as a crown with upright points; drooping points fixed it.
- The horse's head had white mane notches that read as claw marks at pin size; removed.
  Its first outline read as an otter; it's now a chess-knight-like head with a tufted mane.
  It echoes the rider in the logo, which is why the wagon is the default.

## Design rules

- One colour (ink `#1d2733`) on the pin's white centre; colour belongs to the tag ring.
- No thin lines: solid masses, gaps of at least ~2 px at 24×24.
- Distinct outlines per icon, especially among buildings (portico, keep, gate, window).
- Neutral motifs for place of worship (window, bell rather than a cross or spire).

## Where things live

- `frontend/scripts/place_icons.py`: the source of truth. Icons are built from simple
  shapes (`fill` painted in ink, `holes` cut in white), the category list
  (default first), and which OSM values and keys belong to each category. Run
  `python3 scripts/place_icons.py` from `frontend/` to regenerate
  `frontend/src/placeIcons.ts` and `frontend/src/placeIconCategories.json`;
  never edit those by hand.
- `frontend/src/placeIconChoice.ts`: which icon a place shows (its own choice,
  else its category's default).
- `frontend/src/placeMarker.ts`: draws the icon inside the pin.
- `backend/src/stede/places.py`: how an imported Mapstr place gets its category
  (`PLACE_CATEGORIES` by name, then your tags in `TAG_CATEGORIES`, then Mapstr's
  icon in `MAPSTR_CATEGORIES`).
- `backend/scripts/assign_icons.py`: records each Mapstr place's category and icon
  in `data/mapstr.json` (`properties.stede`), using `placeIconCategories.json`.
  Recorded icons are kept; only new places are decided.
- Preview: `npm run dev` in `frontend/`, then open `/icons.html` (dev only, not
  shipped) to see every icon large, at 24 px and inside real-size pins.

## Adding an icon

1. Draw it in `scripts/place_icons.py` with `icon(...)` and add its key to a
   category in `CATEGORIES` (first position makes it the default).
2. For a new category, also list its OSM values or keys in `OSM_VALUES` /
   `OSM_KEYS` in the same file.
3. Regenerate, check `/icons.html` at pin size, and update the tables above.
4. Already recorded places keep their icon; run
   `uv run python scripts/assign_icons.py --redo` in `backend/` to re-decide them all.

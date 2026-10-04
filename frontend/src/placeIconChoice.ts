import { ICON_CATEGORIES, PLACE_ICONS, type IconCategoryKey, type PlaceIconKey } from './placeIcons'

// Which icon category an OpenStreetMap feature belongs to. Values are matched
// first (a "restaurant" is food whatever its key), then whole keys (any shop).
const BY_VALUE: Record<string, IconCategoryKey> = {}
const add = (category: IconCategoryKey, values: string[]) =>
  values.forEach((value) => (BY_VALUE[value] = category))

add('restaurant', ['restaurant', 'fast_food', 'food_court'])
add('cafe', ['cafe', 'bakery', 'pastry', 'ice_cream', 'confectionery', 'tea', 'coffee'])
add('bar', ['bar', 'pub', 'biergarten', 'wine', 'alcohol'])
add('museum', ['museum', 'gallery', 'artwork', 'arts_centre'])
add('monument', ['attraction', 'monument', 'memorial', 'castle', 'ruins', 'archaeological_site', 'tower'])
add('worship', ['place_of_worship', 'church', 'cathedral', 'chapel', 'monastery'])
add('lodging', ['hotel', 'guest_house', 'hostel', 'motel', 'camp_site', 'chalet', 'apartment'])
add('shop', ['marketplace', 'mall'])
add('park', ['park', 'garden', 'nature_reserve', 'wood', 'forest', 'beach', 'peak', 'viewpoint'])
add('sport', ['sports_centre', 'pitch', 'stadium', 'fitness_centre', 'swimming_pool', 'golf_course'])
add('music', ['theatre', 'cinema', 'nightclub', 'music_venue', 'concert_hall'])

const BY_KEY: Record<string, IconCategoryKey> = {
  shop: 'shop',
  historic: 'monument',
  natural: 'park',
  sport: 'sport',
}

export function iconCategoryFor(value?: string, key?: string): IconCategoryKey {
  return (value && BY_VALUE[value]) || (key && BY_KEY[key]) || 'other'
}

// The icon a place shows: the one chosen for it, else its category's default.
export function placeIcon(chosen: string | undefined, value?: string, key?: string): PlaceIconKey {
  if (chosen && chosen in PLACE_ICONS) return chosen as PlaceIconKey
  const category = iconCategoryFor(value, key)
  return ICON_CATEGORIES.find((c) => c.key === category)!.icons[0]
}

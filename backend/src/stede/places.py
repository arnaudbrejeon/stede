"""The OSM-style category of a Mapstr place (used by scripts/assign_icons.py)."""

from typing import Any

# Your tag → the OSM-style value it implies. Your tags say what a place is more
# reliably than Mapstr's icon (often just "generic"), so they're tried first, in
# this order: the first listed tag a place has wins. More specific tags come
# before broader ones, e.g. "Glace" before "Restaurant", "Hôtel" before
# "Restaurant" (a hotel with a good restaurant is still a hotel).
# Tags about status, rating or source ("To try", "Best LA", "Livre/guide"…)
# aren't listed and never pick the icon.
TAG_CATEGORIES = {
    # Café & bakery
    "Glace": "ice_cream",
    "Patisserie/pt dej": "cafe",
    "Cafe": "cafe",
    # Bar & pub
    "Vin": "wine",
    "Drink": "bar",
    # Museum & art
    "Musée etc": "museum",
    # Lodging
    "Hôtel": "hotel",
    # Restaurant: the tag itself, then cuisines and styles
    "Restaurant": "restaurant",
    "Bbq": "restaurant",
    "Burger": "fast_food",
    "Sandwichs": "fast_food",
    "Asiatique": "restaurant",
    "Italien": "restaurant",
    "Mexicain": "restaurant",
    "Français": "restaurant",
    "Indien": "restaurant",
    "Poisson": "restaurant",
    "Cheap Michelin": "restaurant",
    # Shop & market
    "Epicerie": "deli",
    "Shopping": "marketplace",
    # Park & nature
    "Plage": "beach",
    "Parc/hike": "park",
    # Music & shows
    "Musique": "music_venue",
    # Sport & leisure
    "Foot⚽️": "pitch",
    "Loisirs": "sports_centre",
    # Travel & roads: scenic drives, after museums and parks along the way
    "Route": "road",
    # No icon of its own yet, but names the category in the details panel
    "Parking/rest": "parking",
}

# Mapstr icon name → the OSM-style value the frontend picks marker icons from.
# Icons with no sensible OSM equivalent (generic, geocode…) get no category.
MAPSTR_CATEGORIES = {
    # Mapstr's "travel" icon marks sights (museums, landmarks), not transport.
    "travel": "attraction",
    # Mostly scenic drives; the exceptions are in PLACE_CATEGORIES.
    "car": "road",
    "restaurant": "restaurant",
    "pizza": "restaurant",
    "soup": "restaurant",
    "fastfood": "fast_food",
    "streetfood": "fast_food",
    "cafe": "cafe",
    "bakery": "bakery",
    "donuts": "pastry",
    "icecream": "ice_cream",
    "bar": "bar",
    "beer": "pub",
    "wine": "wine",
    "nightclub": "nightclub",
    "museum": "museum",
    "library": "library",
    "historic": "monument",
    "monument": "monument",
    "tourism": "attraction",
    "worship": "place_of_worship",
    "worship_christian": "church",
    "worship_judaism": "place_of_worship",
    "lodging": "hotel",
    "camping": "camp_site",
    "shopping": "marketplace",
    "shopping_women": "clothes",
    "shopping_men": "clothes",
    "clothes": "clothes",
    "supermarket": "supermarket",
    "gift": "gift",
    "jewelry": "jewelry",
    "electronics": "electronics",
    "gardening": "garden_centre",
    "park": "park",
    "nature": "nature_reserve",
    "beach": "beach",
    "forest": "forest",
    "mountain": "peak",
    "hiking": "trailhead",
    "zoo": "zoo",
    "stadium": "stadium",
    "swimming": "swimming_pool",
    "golf": "golf_course",
    "fitness": "fitness_centre",
    "sport": "sports_centre",
    "ski": "sports_centre",
    "climbing": "sports_centre",
    "basketball": "pitch",
    "football": "pitch",
    "rugby": "pitch",
    "tennis": "pitch",
    "riding": "horse_riding",
    "amusement": "theme_park",
    "music": "music_venue",
    "spectacle": "theatre",
    "movies": "cinema",
    "casino": "casino",
    "train": "station",
    "bus": "bus_station",
    "airport": "aerodrome",
    "boat": "ferry_terminal",
    "parking": "parking",
    "gas_station": "fuel",
    "school": "school",
    "hospital": "hospital",
    "health": "clinic",
    "barber": "hairdresser",
    "beauty": "beauty",
    "atm": "atm",
}

# Single places whose icon neither your tags nor Mapstr get right, by exact name.
PLACE_CATEGORIES = {
    # Visitor centres along scenic roads (Mapstr: car)
    "Blue Ridge Parkway Visitors Center": "museum",
    "Craggy Gardens Visitor Center": "museum",
    "Linville Falls Visitor Center": "museum",
    "Waterrock Knob Visitor Center": "museum",
    "Cherohala Skyway Visitor Center": "museum",
    "Echo Canyon Welcome Center Rest Area": "museum",
    "Blue Ridge Mountain Home Center": "museum",
    "folk art center": "museum",
    "George Washington Memorial Parkway Maintenance Facility": "museum",
    # Car rental (Mapstr: car)
    "Adobe Rent a Car": "car_rental",
    "Maritza's Car Rental": "car_rental",
    # Other places Mapstr gave a car icon
    "Brentwood Driver Training": "driving_school",
    "Irwindale Event Center": "stadium",
    "Selma to Montgomery National Historic Trail": "memorial",
    "Grassy Island Loop Trail": "trailhead",
    "From Sap to Sugar tour": "farm",
    "Mercado La Laguna": "marketplace",
    "Royal Botanic Garden West Gate": "garden",
}


def category_for(props: dict[str, Any]) -> str:
    """The OSM-style category a Mapstr place belongs to.

    Tried in order: the place itself (PLACE_CATEGORIES), your tags
    (TAG_CATEGORIES), the OSM element it was matched to (scripts/match_osm.py),
    then Mapstr's icon (MAPSTR_CATEGORIES).
    """
    name = props.get("name") or ""
    if name in PLACE_CATEGORIES:
        return PLACE_CATEGORIES[name]
    tags = {tag["name"] for tag in props.get("tags") or []}
    for tag, category in TAG_CATEGORIES.items():
        if tag in tags:
            return category
    kind = (props.get("osm") or {}).get("kind")
    if kind:
        return kind[1]
    return MAPSTR_CATEGORIES.get(props.get("icon") or "", "")

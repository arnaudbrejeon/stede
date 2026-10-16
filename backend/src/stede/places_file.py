"""A Mapstr export as a stede places file, the format the app imports.

The file holds each place as the unsigned NIP-XX Places event (kind 31300)
that the app encrypts into a private place event; see
frontend/src/placesFile.ts for the format and frontend/src/placeEvents.ts for
the tags. What a Mapstr place becomes:

    name, coordinates   -> name, geo, g (geohashes at 4, 6 and 9)
    address             -> location
    userComment         -> content
    tags                -> t (as written; colours go in the file's `labels`)
    icon (Mapstr's)     -> l label in the com.mapstr.icon namespace
    stede.icon          -> l label in the cc.stede.icon namespace
    stede.category      -> osm:<key> = category, when its OSM key is known
    osm.type, osm.id    -> i = osm:<type>/<id>, k = osm

The matching details (osm.name, distance, score, source, osm_tried) are left
out: they describe how a place was matched, not the place.

Each place's d is derived from its name and position, so converting again
gives the same places, and importing again updates them instead of adding
copies. The app merges duplicates when importing.
"""

import time
import uuid
from typing import Any

FILE_FORMAT = "stede-places"
FILE_VERSION = 1
PLACE_KIND = 31300
ICON_LABEL = "cc.stede.icon"
MAPSTR_ICON_LABEL = "com.mapstr.icon"
OSM_TYPES = {"node", "way", "relation"}
# Namespace for the d of converted places (uuid5 of the place's name and position).
PLACE_ID_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_DNS, "stede.cc")

# The OSM key each category recorded by scripts/assign_icons.py is a value of.
# Categories not listed here are left out; the place keeps its icon anyway.
CATEGORY_KEYS = {
    "aerodrome": "aeroway",
    "attraction": "tourism",
    "bakery": "shop",
    "bar": "amenity",
    "beach": "natural",
    "beauty": "shop",
    "bus_station": "amenity",
    "cafe": "amenity",
    "camp_site": "tourism",
    "car_rental": "amenity",
    "casino": "amenity",
    "church": "building",
    "cinema": "amenity",
    "clinic": "amenity",
    "clothes": "shop",
    "deli": "shop",
    "driving_school": "amenity",
    "farm": "shop",
    "fast_food": "amenity",
    "ferry_terminal": "amenity",
    "fitness_centre": "leisure",
    "forest": "landuse",
    "fuel": "amenity",
    "garden": "leisure",
    "garden_centre": "shop",
    "horse_riding": "leisure",
    "hospital": "amenity",
    "hotel": "tourism",
    "ice_cream": "amenity",
    "library": "amenity",
    "marketplace": "amenity",
    "memorial": "historic",
    "monument": "historic",
    "museum": "tourism",
    "music_venue": "amenity",
    "nature_reserve": "leisure",
    "park": "leisure",
    "parking": "amenity",
    "peak": "natural",
    "pitch": "leisure",
    "place_of_worship": "amenity",
    "restaurant": "amenity",
    "road": "highway",
    "school": "amenity",
    "sports_centre": "leisure",
    "stadium": "leisure",
    "station": "railway",
    "supermarket": "shop",
    "swimming_pool": "leisure",
    "theatre": "amenity",
    "theme_park": "tourism",
    "trailhead": "highway",
    "wine": "shop",
    "zoo": "tourism",
}

GEOHASH_ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz"


def from_mapstr(export: dict[str, Any], now: int | None = None) -> dict[str, Any]:
    """The places file for a Mapstr export (as enriched by the stede scripts)."""
    created_at = int(time.time()) if now is None else now
    places = []
    labels: dict[str, dict[str, str]] = {}
    used_ids: set[str] = set()
    for feature in export.get("features", []):
        place = to_place(feature, used_ids)
        if place is None:
            continue
        place["created_at"] = created_at
        places.append(place)
        for tag in feature["properties"].get("tags") or []:
            name = (tag.get("name") or "").strip()
            if name and tag.get("color") and name not in labels:
                labels[name] = {"color": tag["color"]}
    return {
        "format": FILE_FORMAT,
        "version": FILE_VERSION,
        "exported_at": created_at,
        "labels": labels,
        "places": places,
    }


def to_place(feature: dict[str, Any], used_ids: set[str]) -> dict[str, Any] | None:
    """One Mapstr place as an unsigned kind 31300 event; None without name or position."""
    props = feature.get("properties") or {}
    name = (props.get("name") or "").strip()
    try:
        lon, lat = (float(v) for v in feature["geometry"]["coordinates"][:2])
    except KeyError, TypeError, ValueError:
        return None
    if not name or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None

    tags = [
        ["d", place_id(name, lat, lon, used_ids)],
        ["name", name],
        ["geo", f"{round(lat, 7)},{round(lon, 7)}"],
        *(["g", geohash(lat, lon, length)] for length in (4, 6, 9)),
    ]
    address = (props.get("address") or "").strip()
    if address:
        tags.append(["location", address])
    seen: set[str] = set()
    for tag in props.get("tags") or []:
        label = (tag.get("name") or "").strip()
        if label and label.casefold() not in seen:
            seen.add(label.casefold())
            tags.append(["t", label])
    osm = props.get("osm") or {}
    if osm.get("type") in OSM_TYPES and osm.get("id"):
        tags += [["i", f"osm:{osm['type']}/{osm['id']}"], ["k", "osm"]]
    recorded = props.get("stede") or {}
    category = recorded.get("category")
    if category in CATEGORY_KEYS:
        tags.append([f"osm:{CATEGORY_KEYS[category]}", category])
    if recorded.get("icon"):
        tags += [["L", ICON_LABEL], ["l", recorded["icon"], ICON_LABEL]]
    if props.get("icon"):
        tags += [["L", MAPSTR_ICON_LABEL], ["l", props["icon"], MAPSTR_ICON_LABEL]]

    return {
        "kind": PLACE_KIND,
        "tags": tags,
        "content": (props.get("userComment") or "").strip(),
    }


def place_id(name: str, lat: float, lon: float, used: set[str]) -> str:
    """The same id for the same place on every run; repeats get their own."""
    key = f"mapstr:{name}|{lat:.6f},{lon:.6f}"
    candidate, n = str(uuid.uuid5(PLACE_ID_NAMESPACE, key)), 1
    while candidate in used:
        n += 1
        candidate = str(uuid.uuid5(PLACE_ID_NAMESPACE, f"{key}#{n}"))
    used.add(candidate)
    return candidate


def geohash(lat: float, lon: float, length: int) -> str:
    """Standard geohash of a point (as relay/policy.py checks it)."""
    lat_range, lon_range = [-90.0, 90.0], [-180.0, 180.0]
    out, bits, bit, even = [], 0, 0, True
    while len(out) < length:
        rng, value = (lon_range, lon) if even else (lat_range, lat)
        mid = (rng[0] + rng[1]) / 2
        if value >= mid:
            bits = bits * 2 + 1
            rng[0] = mid
        else:
            bits *= 2
            rng[1] = mid
        even = not even
        bit += 1
        if bit == 5:
            out.append(GEOHASH_ALPHABET[bits])
            bits = bit = 0
    return "".join(out)

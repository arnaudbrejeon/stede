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

import math
import re
import time
import unicodedata
import uuid
from datetime import datetime
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
    return from_exports([export], now)


def from_exports(
    exports: list[dict[str, Any]], now: int | None = None
) -> dict[str, Any]:
    """One places file for several exports (Mapstr, Pindrop via
    scripts/pindrop_import.py), with duplicates merged into the first place
    seen: same name and the same OSM element or within 100 m, as the app does
    on import (frontend/src/placesFile.ts)."""
    created_at = int(time.time()) if now is None else now
    places: list[dict[str, Any]] = []
    labels: dict[str, dict[str, str]] = {}
    used_ids: set[str] = set()
    by_name: dict[str, list[dict[str, Any]]] = {}
    for export in exports:
        for feature in export.get("features", []):
            place = to_place(feature, used_ids)
            if place is None:
                continue
            place.setdefault("created_at", created_at)
            key = normalise(tag_value(place, "name") or "")
            same = next(
                (p for p in by_name.get(key, []) if is_duplicate(p, place)), None
            )
            if same is not None:
                merged = merge_places(same, place)
                same["tags"], same["content"] = merged["tags"], merged["content"]
            else:
                places.append(place)
                by_name.setdefault(key, []).append(place)
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

    pindrop = props.get("pindrop") or {}
    own_id = pindrop.get("id")
    if own_id and own_id not in used_ids:
        used_ids.add(own_id)
        d = own_id
    else:
        d = place_id(name, lat, lon, used_ids)
    tags = [
        ["d", d],
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
    category_key = recorded.get("category_key") or CATEGORY_KEYS.get(category or "")
    if category and category_key:
        tags.append([f"osm:{category_key}", category])
    if recorded.get("icon"):
        tags += [["L", ICON_LABEL], ["l", recorded["icon"], ICON_LABEL]]
    if props.get("icon"):
        tags += [["L", MAPSTR_ICON_LABEL], ["l", props["icon"], MAPSTR_ICON_LABEL]]
    pindrop = props.get("pindrop") or {}
    tags += [["image", url] for url in pindrop.get("photos") or []]

    place: dict[str, Any] = {
        "kind": PLACE_KIND,
        "tags": tags,
        "content": (props.get("userComment") or "").strip(),
    }
    if dropped := pindrop.get("date_dropped"):
        try:
            place["created_at"] = int(datetime.fromisoformat(dropped).timestamp())
        except ValueError:
            pass
    return place


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


DUPLICATE_DISTANCE_M = 100


def normalise(name: str) -> str:
    """ "Gili-Gili" and "gili gili" are the same name (as the app's normalizeName)."""
    name = unicodedata.normalize("NFD", name)
    name = "".join(c for c in name if not unicodedata.combining(c)).lower()
    return re.sub(r"[^\w]+|_", " ", name).strip()


def tag_value(place: dict[str, Any], name: str) -> str | None:
    return next((t[1] for t in place["tags"] if t[0] == name), None)


def is_duplicate(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """Same name, and the same OSM element or close by (as the app's isDuplicate)."""
    if normalise(tag_value(a, "name") or "") != normalise(tag_value(b, "name") or ""):
        return False
    osm_a = tag_value(a, "i")
    if osm_a and osm_a == tag_value(b, "i"):
        return True
    (lat1, lon1), (lat2, lon2) = (
        map(float, (tag_value(p, "geo") or "0,0").split(",")[:2]) for p in (a, b)
    )
    r = math.radians
    h = (
        math.sin(r(lat2 - lat1) / 2) ** 2
        + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(r(lon2 - lon1) / 2) ** 2
    )
    return 2 * 6371008.8 * math.asin(math.sqrt(h)) <= DUPLICATE_DISTANCE_M


def merge_places(base: dict[str, Any], other: dict[str, Any]) -> dict[str, Any]:
    """`base` with what `other` adds (as the app's mergePlaces): its labels, a
    comment that differs, and any tag `base` lacks. Name and position stay."""
    labels: list[str] = []
    for label in [t[1] for t in base["tags"] + other["tags"] if t[0] == "t"]:
        if label.casefold() not in {l.casefold() for l in labels}:
            labels.append(label)
    tags = [t for t in base["tags"] if t[0] != "t"] + [["t", l] for l in labels]

    def has(t: list[str]) -> bool:
        if t[0] == "l":
            return any(x[0] == "l" and x[2:3] == t[2:3] for x in tags)
        if t[0] == "L":
            return any(x[0] == "L" and x[1] == t[1] for x in tags)
        if t[0] == "image":
            return t in tags
        return any(x[0] == t[0] for x in tags)

    base_linked = any(t[0] == "i" for t in base["tags"])
    for t in other["tags"]:
        if t[0] in ("t", "g"):
            continue
        if t[0] in ("i", "k"):
            if not base_linked:
                tags.append(t)
            continue
        if not has(t):
            tags.append(t)
    a, b = base["content"].strip(), other["content"].strip()
    content = base["content"] if not b or b in a else b if not a else f"{a}\n\n{b}"
    return {"kind": base["kind"], "tags": tags, "content": content}

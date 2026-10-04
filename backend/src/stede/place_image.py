"""Find an image for an OpenStreetMap place.

Tries, in order:
1. a Wikimedia Commons file named by the OSM `image` or `wikimedia_commons` tags;
2. the main image (P18) of the Wikidata item linked by the `wikidata` tag;
3. otherwise, of a Wikidata item found by the place's names near its location
   (most OSM objects aren't linked, even when Wikidata knows the place);
4. a direct image URL in `image`;
5. the website's preview image, or failing that the largest photo on its page.
Results are cached in memory.
"""

import asyncio
import math
import re
import time
from collections import OrderedDict
from typing import Literal
from urllib.parse import quote, unquote, urlsplit

import httpx
from pydantic import BaseModel

from stede.website_image import UnsafeURLError, find_website_image

OSM_API = "https://api.openstreetmap.org/api/0.6"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
OSM_ELEMENT_TYPES = {"N": "node", "W": "way", "R": "relation"}
THUMB_WIDTH = 640
CACHE_SIZE = 1024
# Finding nothing may be a transient failure (timeouts, bot challenges): retry later.
EMPTY_RESULT_TTL_S = 10 * 60
# Wikidata search radius, then how close an item's own coordinates must be.
WIKIDATA_SEARCH_RADIUS = "500m"
WIKIDATA_MAX_DISTANCE_M = 300
NAME_TAGS = ("name", "name:en", "official_name", "old_name", "alt_name")

OsmType = Literal["N", "W", "R"]

# e.g. https://fr.wikipedia.org/wiki/Fichier:Tour_Eiffel.jpg or .../wiki/File:X.jpg
_FILE_PAGE = re.compile(r"/wiki/[^/:]+:([^/?#]+)$")
# Characters with a meaning in Wikidata's search syntax.
_SEARCH_SYNTAX = re.compile(r"[\"':()\[\]{}~*?!^\\/|&+-]")
_DIRECT_IMAGE = re.compile(r"^https?://.+\.(jpe?g|png|webp|gif)(\?.*)?$", re.IGNORECASE)


class ImageSource(BaseModel):
    label: str
    href: str


class PlaceImage(BaseModel):
    # Where the image lives; what to keep when a place is saved.
    url: str
    # Shown next to the image as credit.
    source: ImageSource


class ServedPlaceImage(PlaceImage):
    # What browsers should load: the same image, served by us (see main.py).
    display_url: str


class PlaceImageResponse(BaseModel):
    image: ServedPlaceImage | None


# Key -> (image, time it was found).
_cache: OrderedDict[tuple[str, int], tuple[PlaceImage | None, float]] = OrderedDict()


LatLon = tuple[float, float]


async def find_place_image(
    client: httpx.AsyncClient,
    osm_type: OsmType,
    osm_id: int,
    near: LatLon | None = None,
) -> PlaceImage | None:
    key = (osm_type, osm_id)
    if key in _cache:
        cached, found_at = _cache[key]
        if cached is not None or time.monotonic() - found_at < EMPTY_RESULT_TTL_S:
            _cache.move_to_end(key)
            return cached
    tags = await fetch_osm_tags(client, osm_type, osm_id)
    image = await image_from_tags(client, tags, near)
    _cache[key] = (image, time.monotonic())
    _cache.move_to_end(key)
    if len(_cache) > CACHE_SIZE:
        _cache.popitem(last=False)
    return image


async def fetch_osm_tags(
    client: httpx.AsyncClient, osm_type: OsmType, osm_id: int
) -> dict[str, str]:
    response = await client.get(
        f"{OSM_API}/{OSM_ELEMENT_TYPES[osm_type]}/{osm_id}.json"
    )
    if response.status_code in (404, 410):  # unknown or deleted
        return {}
    response.raise_for_status()
    elements = response.json().get("elements") or [{}]
    return elements[0].get("tags", {})


async def image_from_tags(
    client: httpx.AsyncClient, tags: dict[str, str], near: LatLon | None = None
) -> PlaceImage | None:
    file = commons_file_from_tags(tags)
    if not file and tags.get("wikidata"):
        file = await wikidata_image(client, tags["wikidata"])
    if not file and not tags.get("wikidata") and near:
        file = await wikidata_image_nearby(client, place_names(tags), near)
    if file:
        return commons_image(file)

    image = tags.get("image", "")
    if _DIRECT_IMAGE.match(image):
        return PlaceImage(
            url=image, source=ImageSource(label=hostname(image), href=image)
        )

    website = tags.get("website") or tags.get("contact:website")
    if website:
        try:
            url = await find_website_image(website, client)
        except UnsafeURLError, httpx.HTTPError:
            url = None
        if url:
            return PlaceImage(
                url=url, source=ImageSource(label=hostname(website), href=website)
            )
    return None


def place_names(tags: dict[str, str]) -> list[str]:
    names: list[str] = []
    for key in NAME_TAGS:
        for name in tags.get(key, "").split(";"):
            if name.strip() and name.strip() not in names:
                names.append(name.strip())
    return names


async def wikidata_image_nearby(
    client: httpx.AsyncClient, names: list[str], near: LatLon
) -> str | None:
    """Main image of the closest Wikidata item matching a name, if close enough."""
    lat, lon = near
    ids: list[str] = []
    for name in names:
        query = _SEARCH_SYNTAX.sub(" ", name).strip()
        if not query:
            continue
        params = {
            "action": "query",
            "list": "search",
            "srsearch": f"{query} nearcoord:{WIKIDATA_SEARCH_RADIUS},{lat},{lon}",
            "srlimit": 3,
            "format": "json",
        }
        try:
            response = await client.get(WIKIDATA_API, params=params)
            response.raise_for_status()
            hits = response.json().get("query", {}).get("search", [])
        except httpx.HTTPError, ValueError:
            continue
        ids += [hit["title"] for hit in hits if hit["title"] not in ids]

    async def candidate(item: str) -> tuple[float, str] | None:
        claims = await wikidata_claims(client, item, ("P625", "P18"))
        try:
            coords = claims["P625"][0]["mainsnak"]["datavalue"]["value"]
            image = claims["P18"][0]["mainsnak"]["datavalue"]["value"]
        except KeyError, IndexError:
            return None
        distance = distance_m(lat, lon, coords["latitude"], coords["longitude"])
        return (distance, image) if distance <= WIKIDATA_MAX_DISTANCE_M else None

    found = [c for c in await asyncio.gather(*(candidate(i) for i in ids[:5])) if c]
    return min(found)[1] if found else None


async def wikidata_claims(
    client: httpx.AsyncClient, item: str, properties: tuple[str, ...]
) -> dict:
    claims: dict = {}
    for prop in properties:
        params = {
            "action": "wbgetclaims",
            "entity": item,
            "property": prop,
            "format": "json",
        }
        try:
            response = await client.get(WIKIDATA_API, params=params)
            response.raise_for_status()
            claims |= response.json().get("claims", {})
        except httpx.HTTPError, ValueError:
            pass
    return claims


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance (haversine)."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi, dlmb = phi2 - phi1, math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    )
    return 2 * 6_371_000 * math.asin(math.sqrt(a))


def commons_file_from_tags(tags: dict[str, str]) -> str | None:
    if match := _FILE_PAGE.search(tags.get("image", "")):
        return unquote(match.group(1))
    commons = tags.get("wikimedia_commons", "")
    # A Category: names many images, not one.
    if commons.startswith("File:"):
        return commons.removeprefix("File:")
    return None


async def wikidata_image(client: httpx.AsyncClient, item: str) -> str | None:
    params = {
        "action": "wbgetclaims",
        "entity": item,
        "property": "P18",
        "format": "json",
    }
    try:
        response = await client.get(WIKIDATA_API, params=params)
        response.raise_for_status()
        claims = response.json().get("claims", {}).get("P18", [])
        return claims[0]["mainsnak"]["datavalue"]["value"] if claims else None
    except httpx.HTTPError, ValueError, KeyError:
        return None


def commons_image(file: str) -> PlaceImage:
    name = quote(file.replace(" ", "_"))
    return PlaceImage(
        url=f"https://commons.wikimedia.org/wiki/Special:FilePath/{name}?width={THUMB_WIDTH}",
        source=ImageSource(
            label="Wikimedia Commons",
            href=f"https://commons.wikimedia.org/wiki/File:{name}",
        ),
    )


def hostname(url: str) -> str:
    host = urlsplit(url).hostname or url
    return host.removeprefix("www.")

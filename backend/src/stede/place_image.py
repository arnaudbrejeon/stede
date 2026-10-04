"""Find an image for an OpenStreetMap place.

Tries, in order: a Wikimedia Commons file named by the OSM `image` or
`wikimedia_commons` tags, the Wikidata item's main image (P18), a direct image
URL in `image`, then the website's og:image. Results are cached in memory.
"""

import re
from collections import OrderedDict
from typing import Literal
from urllib.parse import quote, unquote, urlsplit

import httpx
from pydantic import BaseModel

from stede.og_image import UnsafeURLError, find_og_image

OSM_API = "https://api.openstreetmap.org/api/0.6"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
OSM_ELEMENT_TYPES = {"N": "node", "W": "way", "R": "relation"}
THUMB_WIDTH = 640
CACHE_SIZE = 1024

OsmType = Literal["N", "W", "R"]

# e.g. https://fr.wikipedia.org/wiki/Fichier:Tour_Eiffel.jpg or .../wiki/File:X.jpg
_FILE_PAGE = re.compile(r"/wiki/[^/:]+:([^/?#]+)$")
_DIRECT_IMAGE = re.compile(r"^https?://.+\.(jpe?g|png|webp|gif)(\?.*)?$", re.IGNORECASE)


class ImageSource(BaseModel):
    label: str
    href: str


class PlaceImage(BaseModel):
    url: str
    # Shown next to the image as credit.
    source: ImageSource


class PlaceImageResponse(BaseModel):
    image: PlaceImage | None


_cache: OrderedDict[tuple[str, int], PlaceImage | None] = OrderedDict()


async def find_place_image(
    client: httpx.AsyncClient, osm_type: OsmType, osm_id: int
) -> PlaceImage | None:
    key = (osm_type, osm_id)
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    tags = await fetch_osm_tags(client, osm_type, osm_id)
    image = await image_from_tags(client, tags)
    _cache[key] = image
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
    client: httpx.AsyncClient, tags: dict[str, str]
) -> PlaceImage | None:
    file = commons_file_from_tags(tags)
    if not file and tags.get("wikidata"):
        file = await wikidata_image(client, tags["wikidata"])
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
            url = await find_og_image(website, client)
        except UnsafeURLError, httpx.HTTPError:
            url = None
        if url:
            return PlaceImage(
                url=url, source=ImageSource(label=hostname(website), href=website)
            )
    return None


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

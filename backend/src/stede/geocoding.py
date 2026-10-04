"""Place search, proxied to Photon (https://photon.komoot.io, OpenStreetMap data).

Kept behind our API so the provider, its parameters and its fair-use limits are
managed in one place. Given the user's map view, results are split into places
near that view and places elsewhere: Photon ranks mostly by text match, so a
single query mixes continents (e.g. "eiffel tower" -> Paris, Canada, Brussels).
"""

import asyncio
import math
from dataclasses import dataclass
from typing import Any

import httpx

PHOTON_URL = "https://photon.komoot.io/api/"
# Languages Photon accepts for result names; anything else is a 400 there.
PHOTON_LANGS = {"en", "de", "fr"}
# "Near" reaches this fraction of the view's size beyond each edge.
VIEW_MARGIN = 0.25

Feature = dict[str, Any]


class GeocodingError(RuntimeError):
    """The provider failed or returned something unusable."""


@dataclass(frozen=True)
class View:
    """The visible map area, in degrees."""

    west: float
    south: float
    east: float
    north: float

    @classmethod
    def parse(cls, bbox: str) -> View:
        """From "west,south,east,north"; raises ValueError when malformed."""
        west, south, east, north = (float(part) for part in bbox.split(","))
        if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise ValueError("bbox must be west,south,east,north within world bounds")
        return cls(west, south, east, north)

    @property
    def center(self) -> tuple[float, float]:
        return (self.west + self.east) / 2, (self.south + self.north) / 2

    def padded(self, fraction: float = VIEW_MARGIN) -> View:
        dx, dy = (
            (self.east - self.west) * fraction,
            (self.north - self.south) * fraction,
        )
        return View(
            max(-180, self.west - dx),
            max(-90, self.south - dy),
            min(180, self.east + dx),
            min(90, self.north + dy),
        )

    def contains(self, lon: float, lat: float) -> bool:
        return self.west <= lon <= self.east and self.south <= lat <= self.north

    def as_param(self) -> str:
        return ",".join(
            f"{v:.5f}" for v in (self.west, self.south, self.east, self.north)
        )


async def search_places(
    client: httpx.AsyncClient,
    query: str,
    *,
    limit: int,
    view: View | None = None,
    lang: str | None = None,
) -> dict[str, list[Feature]]:
    """{"nearby": [...], "elsewhere": [...]}, each at most `limit` GeoJSON features.

    With a view, one Photon query is restricted to the (padded) view and one is
    worldwide but biased to its centre; they're merged without duplicates.
    """
    common: dict[str, str | int | float] = {"q": query}
    if lang and lang[:2].lower() in PHOTON_LANGS:
        common["lang"] = lang[:2].lower()

    if view is None:
        return {
            "nearby": [],
            "elsewhere": await _photon(client, common | {"limit": limit}),
        }

    near = view.padded()
    lon, lat = view.center
    local, worldwide = await asyncio.gather(
        _photon(client, common | {"limit": limit, "bbox": near.as_param()}),
        # More than `limit`: some of these will turn out to be near too.
        _photon(
            client,
            common | {"limit": limit * 2, "lat": round(lat, 5), "lon": round(lon, 5)},
        ),
        return_exceptions=True,
    )
    if isinstance(local, BaseException) and isinstance(worldwide, BaseException):
        raise GeocodingError("place search is unavailable") from worldwide
    local = [] if isinstance(local, BaseException) else local
    worldwide = [] if isinstance(worldwide, BaseException) else worldwide

    nearby: list[Feature] = []
    elsewhere: list[Feature] = []
    seen: set[tuple[str, int]] = set()
    for feature in [*local, *worldwide]:
        key = (
            feature["properties"].get("osm_type"),
            feature["properties"].get("osm_id"),
        )
        if key in seen:
            continue
        seen.add(key)
        f_lon, f_lat = feature["geometry"]["coordinates"]
        feature["properties"]["distance_m"] = round(_distance_m(lon, lat, f_lon, f_lat))
        (nearby if near.contains(f_lon, f_lat) else elsewhere).append(feature)
    return {"nearby": nearby[:limit], "elsewhere": elsewhere[:limit]}


async def _photon(
    client: httpx.AsyncClient, params: dict[str, str | int | float]
) -> list[Feature]:
    try:
        response = await client.get(PHOTON_URL, params=params)
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise GeocodingError("place search is unavailable") from exc
    if data.get("type") != "FeatureCollection":
        raise GeocodingError("unexpected response from place search")
    return [
        f
        for f in data.get("features", [])
        if f.get("geometry", {}).get("type") == "Point"
    ]


def _distance_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Great-circle distance (haversine)."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi, dlmb = phi2 - phi1, math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    )
    return 2 * 6_371_000 * math.asin(math.sqrt(a))

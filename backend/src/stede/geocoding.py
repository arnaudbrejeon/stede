"""Addresses from Photon (https://photon.komoot.io, OpenStreetMap data), for the
import scripts (scripts/pindrop_import.py). The app's API does the same in
TypeScript: frontend/worker/geocoding.ts.
"""

from typing import Any

import httpx

PHOTON_REVERSE_URL = "https://photon.komoot.io/reverse"
# A street or house within this many kilometres of a dropped pin is its address;
# further out (a mountain, a beach) the pin is described by the nearest town.
ADDRESS_RADIUS_KM = 0.3
# Languages Photon accepts for result names; anything else is a 400 there.
PHOTON_LANGS = {"en", "de", "fr"}

Feature = dict[str, Any]


class GeocodingError(RuntimeError):
    """The provider failed or returned something unusable."""


async def address_at(
    client: httpx.AsyncClient, lon: float, lat: float, *, lang: str | None = None
) -> str | None:
    """A readable address for a point on the map, e.g. for a dropped pin.

    "12 Rue de Buci, Paris, France" when a house or street is close by, else
    "Near Grand Canyon Village, Arizona, United States"; None when Photon knows
    nothing around.
    """
    common: dict[str, str | int | float] = {
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "limit": 1,
    }
    if lang and lang[:2].lower() in PHOTON_LANGS:
        common["lang"] = lang[:2].lower()
    # httpx sends a list as the same parameter repeated: layer=house&layer=street.
    close = await _photon(
        client,
        common | {"layer": ["house", "street"], "radius": ADDRESS_RADIUS_KM},
        PHOTON_REVERSE_URL,
    )
    if close:
        p = close[0]["properties"]
        street = p.get("street") or (
            p.get("name") if p.get("type") == "street" else None
        )
        if street and p.get("housenumber"):
            street = f"{p['housenumber']} {street}"
        return _join(
            street,
            # Out of town, a path or road is placed by its county or state.
            p.get("city")
            or p.get("locality")
            or p.get("district")
            or p.get("county")
            or p.get("state"),
            p.get("country"),
        )
    around = await _photon(client, common, PHOTON_REVERSE_URL)
    if not around:
        return None
    p = around[0]["properties"]
    place = _join(p.get("name") or p.get("city"), p.get("state"), p.get("country"))
    return f"Near {place}" if place else None


def _join(*parts: str | None) -> str | None:
    """The parts that are there, each once, comma-separated."""
    kept = list(dict.fromkeys(part for part in parts if part))
    return ", ".join(kept) or None


async def _photon(
    client: httpx.AsyncClient, params: dict[str, Any], url: str
) -> list[Feature]:
    try:
        response = await client.get(url, params=params)
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

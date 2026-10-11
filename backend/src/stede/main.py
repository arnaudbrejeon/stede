from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI, Header, HTTPException, Query, Response

from stede.geocoding import GeocodingError, View, address_at, search_places
from stede.place_image import (
    OsmType,
    PlaceImageResponse,
    ServedPlaceImage,
    find_place_image,
)
from stede.places import load_places, places_file
from stede.website_image import fetch_image, make_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with make_client() as client:
        app.state.http = client
        yield


app = FastAPI(title="stede", lifespan=lifespan)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/places")
def places(accept_encoding: str = Header(default="")) -> Response:
    """Your saved places, as a GeoJSON FeatureCollection.

    Gzipped for clients that accept it (all browsers): the collection runs to
    megabytes but compresses well.
    """
    served = load_places(places_file())
    # Vary: caches must not hand the gzipped body to a client that can't read it.
    headers = {"Vary": "Accept-Encoding"}
    if accepts_gzip(accept_encoding):
        headers["Content-Encoding"] = "gzip"
        return Response(served.gzipped, media_type="application/json", headers=headers)
    return Response(served.json, media_type="application/json", headers=headers)


def accepts_gzip(accept_encoding: str) -> bool:
    """Whether an Accept-Encoding header allows gzip (and doesn't refuse it with q=0)."""
    weights = {}
    for coding in accept_encoding.split(","):
        name, _, params = coding.partition(";")
        q = params.strip().removeprefix("q=").strip() or "1"
        try:
            weights[name.strip().lower()] = float(q)
        except ValueError:
            continue
    # An explicit gzip entry beats the "*" wildcard.
    return weights.get("gzip", weights.get("*", 0)) > 0


@app.get("/api/search")
async def search(
    q: str = Query(min_length=1, max_length=200),
    limit: int = Query(default=6, ge=1, le=10),
    bbox: str | None = Query(
        default=None, max_length=100, description="west,south,east,north"
    ),
    lang: str | None = Query(default=None, max_length=16),
) -> dict[str, list[dict[str, Any]]]:
    """Places matching the query, split into those near the map view and the rest.

    Each list holds GeoJSON features with a `distance_m` property (from the view's
    centre) when a view is given.
    """
    try:
        view = View.parse(bbox) if bbox else None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        return await search_places(
            app.state.http, q.strip(), limit=limit, view=view, lang=lang
        )
    except GeocodingError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/address")
async def address(
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=180),
    lang: str | None = Query(default=None, max_length=16),
) -> dict[str, str | None]:
    """The address of a point on the map (a dropped pin), or null when unknown."""
    try:
        return {"address": await address_at(app.state.http, lon, lat, lang=lang)}
    except GeocodingError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/place-image")
async def place_image(
    osm_type: OsmType,
    osm_id: int = Query(gt=0),
    lat: float | None = Query(default=None, ge=-90, le=90),
    lon: float | None = Query(default=None, ge=-180, le=180),
) -> PlaceImageResponse:
    """An image for an OpenStreetMap place, or null when none can be found.

    The place's location, when given, lets unlinked places be matched on Wikidata.
    """
    near = (lat, lon) if lat is not None and lon is not None else None
    try:
        image = await find_place_image(app.state.http, osm_type, osm_id, near)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502, detail="place lookup is unavailable"
        ) from exc
    if image is None:
        return PlaceImageResponse(image=None)
    # Browsers load it through /api/place-image/file: third-party sites may block
    # them (hotlink protection, bot challenges, plain http) yet answer us.
    served = ServedPlaceImage(
        **image.model_dump(),
        display_url=f"/api/place-image/file?osm_type={osm_type}&osm_id={osm_id}",
    )
    return PlaceImageResponse(image=served)


@app.get("/api/place-image/file")
async def place_image_file(osm_type: OsmType, osm_id: int = Query(gt=0)) -> Response:
    """The image found for a place, fetched and served by us.

    Only ever serves the image the lookup chose, never an arbitrary URL.
    """
    try:
        image = await find_place_image(app.state.http, osm_type, osm_id)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502, detail="place lookup is unavailable"
        ) from exc
    if image is None:
        raise HTTPException(status_code=404, detail="no image for this place")
    fetched = await fetch_image(image.url, app.state.http)
    if fetched is None:
        raise HTTPException(status_code=502, detail="image is unavailable")
    body, media_type = fetched
    return Response(
        content=body,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )

from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query

from stede.geocoding import GeocodingError, View, search_places
from stede.og_image import make_client
from stede.place_image import OsmType, PlaceImageResponse, find_place_image


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with make_client() as client:
        app.state.http = client
        yield


app = FastAPI(title="stede", lifespan=lifespan)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


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


@app.get("/api/place-image")
async def place_image(
    osm_type: OsmType, osm_id: int = Query(gt=0)
) -> PlaceImageResponse:
    """An image for an OpenStreetMap place, or null when none can be found."""
    try:
        image = await find_place_image(app.state.http, osm_type, osm_id)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502, detail="place lookup is unavailable"
        ) from exc
    return PlaceImageResponse(image=image)

import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from stede.main import app
from stede.places import category_for, from_mapstr, load_places

MAPSTR_EXPORT = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [2.3266, 48.86]},
            "properties": {
                "name": "Musée d'Orsay",
                "address": "Paris, France",
                "icon": "museum",
                "tags": [{"name": "Visit", "color": "#6edf38"}],
                "userComment": "Impressionists",
            },
        },
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [-0.1, 51.5]},
            "properties": {"name": "Somewhere", "address": "", "tags": []},
        },
    ],
}


def test_from_mapstr_numbers_places_and_keeps_tag_names() -> None:
    first, second = from_mapstr(MAPSTR_EXPORT)["features"]
    assert first["id"] == 1
    assert first["geometry"]["coordinates"] == [2.3266, 48.86]
    assert first["properties"] == {
        "id": 1,
        "name": "Musée d'Orsay",
        "category": "museum",
        "tags": ["Visit"],
        "website": None,
        "address": "Paris, France",
        "comment": "Impressionists",
    }
    # No icon, empty address, no comment.
    assert second["properties"]["category"] == ""
    assert second["properties"]["address"] is None
    assert second["properties"]["comment"] is None


def test_from_mapstr_maps_icons_to_osm_values() -> None:
    export = {
        "features": [
            {**MAPSTR_EXPORT["features"][0], "properties": {"name": "x", "icon": icon}}
            for icon in ["fastfood", "lodging", "generic", "travel", "car"]
        ]
    }
    categories = [f["properties"]["category"] for f in from_mapstr(export)["features"]]
    assert categories == ["fast_food", "hotel", "", "attraction", "road"]


def test_from_mapstr_overrides_single_places_by_name() -> None:
    place = MAPSTR_EXPORT["features"][0]
    export = {
        "features": [
            {**place, "properties": {"name": name, "icon": "car"}}
            for name in [
                "Linville Falls Visitor Center",
                "Adobe Rent a Car",
                "Hana Highway",
            ]
        ]
    }
    categories = [f["properties"]["category"] for f in from_mapstr(export)["features"]]
    assert categories == ["museum", "car_rental", "road"]


def test_places_endpoint_serves_the_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "mapstr.json"
    path.write_text(json.dumps(MAPSTR_EXPORT), encoding="utf-8")
    monkeypatch.setenv("STEDE_PLACES_FILE", str(path))
    response = TestClient(app).get("/api/places")
    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "FeatureCollection"
    assert [f["properties"]["name"] for f in body["features"]] == [
        "Musée d'Orsay",
        "Somewhere",
    ]


def test_missing_file_means_no_places(tmp_path: Path) -> None:
    assert json.loads(load_places(tmp_path / "missing.json").json) == {
        "type": "FeatureCollection",
        "features": [],
    }


def test_category_for_prefers_the_place_then_tags_then_mapstr() -> None:
    def props(name: str, icon: str, *tags: str) -> dict:
        return {"name": name, "icon": icon, "tags": [{"name": t} for t in tags]}

    # Named override beats a matching tag.
    assert (
        category_for(props("Linville Falls Visitor Center", "car", "Route")) == "museum"
    )
    # The first listed tag wins: Hôtel comes before Restaurant.
    assert category_for(props("Inn", "restaurant", "Restaurant", "Hôtel")) == "hotel"
    # Musée etc comes before Route.
    assert category_for(props("folk art", "car", "Route", "Musée etc")) == "museum"
    # Status tags don't count; Mapstr's icon decides.
    assert category_for(props("Somewhere", "lodging", "To try")) == "hotel"


def test_from_mapstr_uses_the_recorded_category_and_icon() -> None:
    place = MAPSTR_EXPORT["features"][0]
    recorded = {
        **place["properties"],
        "stede": {"category": "garden", "icon": "fleur-de-lis"},
    }
    (feature,) = from_mapstr({"features": [{**place, "properties": recorded}]})[
        "features"
    ]
    assert feature["properties"]["category"] == "garden"
    assert feature["properties"]["icon"] == "fleur-de-lis"


def test_places_endpoint_follows_changes_to_the_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "mapstr.json"
    path.write_text(json.dumps(MAPSTR_EXPORT), encoding="utf-8")
    monkeypatch.setenv("STEDE_PLACES_FILE", str(path))
    client = TestClient(app)
    assert len(client.get("/api/places").json()["features"]) == 2
    one_place = {**MAPSTR_EXPORT, "features": MAPSTR_EXPORT["features"][:1]}
    path.write_text(json.dumps(one_place), encoding="utf-8")
    # Make sure the modification time moves on, whatever the clock resolution.
    stat = path.stat()
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000))
    assert len(client.get("/api/places").json()["features"]) == 1


@pytest.mark.parametrize(
    ("accept_encoding", "gzipped"),
    [
        ("gzip, deflate, br", True),
        ("br;q=1.0, gzip;q=0.8", True),
        ("gzip;q=0", False),
        ("*;q=0, gzip", True),
        ("gzip;q=oops", False),
        ("identity", False),
        ("", False),
    ],
)
def test_places_are_gzipped_when_accepted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, accept_encoding: str, gzipped: bool
) -> None:
    path = tmp_path / "mapstr.json"
    path.write_text(json.dumps(MAPSTR_EXPORT), encoding="utf-8")
    monkeypatch.setenv("STEDE_PLACES_FILE", str(path))
    response = TestClient(app).get(
        "/api/places", headers={"Accept-Encoding": accept_encoding}
    )
    assert response.status_code == 200
    assert response.headers.get("content-encoding") == ("gzip" if gzipped else None)
    assert response.headers["vary"] == "Accept-Encoding"
    # httpx undoes the gzip, so either way the body reads as the same places.
    assert len(response.json()["features"]) == 2


def test_from_mapstr_passes_on_the_osm_match() -> None:
    place = MAPSTR_EXPORT["features"][0]
    matched = {**place["properties"], "osm": {"type": "way", "id": 42, "score": 1.0}}
    unmatched = MAPSTR_EXPORT["features"][1]
    first, second = from_mapstr(
        {"features": [{**place, "properties": matched}, unmatched]}
    )["features"]
    assert (first["properties"]["osm_type"], first["properties"]["osm_id"]) == ("W", 42)
    assert "osm_type" not in second["properties"]

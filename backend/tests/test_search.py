import httpx
import pytest
from fastapi.testclient import TestClient

from stede.geocoding import View
from stede.main import app

PARIS_VIEW = "2.25,48.81,2.42,48.91"


def feature(osm_id: int, lon: float, lat: float, name: str = "x") -> dict:
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {"osm_type": "N", "osm_id": osm_id, "name": name},
    }


TOWER = feature(1, 2.2945, 48.8583, "Tour Eiffel")
TOWER_HOTEL = feature(2, 2.2852, 48.8647, "Hotel Eiffel")
JUST_OUTSIDE = feature(3, 2.22, 48.86, "Boulogne")  # beyond the view, within its margin
CANADA = feature(4, -116.235, 51.3336, "Eiffel Tower")
BRUSSELS = feature(5, 4.35, 50.85, "Eiffel Tower")


def photon_returning(local: list[dict], worldwide: list[dict], seen: list[httpx.URL]):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url)
        features = local if "bbox" in request.url.params else worldwide
        return httpx.Response(
            200, json={"type": "FeatureCollection", "features": features}
        )

    return handler


def search_with(handler, **params) -> httpx.Response:
    with TestClient(app) as client:
        app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        return client.get("/api/search", params=params)


def test_splits_results_into_nearby_and_elsewhere() -> None:
    seen: list[httpx.URL] = []
    handler = photon_returning(
        local=[TOWER, TOWER_HOTEL],
        # Worldwide repeats the tower and adds one more nearby place among far ones.
        worldwide=[CANADA, TOWER, BRUSSELS, JUST_OUTSIDE],
        seen=seen,
    )
    response = search_with(handler, q="eiffel tower", bbox=PARIS_VIEW, lang="fr-FR")

    assert response.status_code == 200
    body = response.json()
    assert [f["properties"]["osm_id"] for f in body["nearby"]] == [1, 2, 3]
    assert [f["properties"]["osm_id"] for f in body["elsewhere"]] == [4, 5]
    assert body["nearby"][0]["properties"]["distance_m"] < 5_000
    assert body["elsewhere"][0]["properties"]["distance_m"] > 5_000_000

    local_query, worldwide_query = sorted(
        seen, key=lambda url: "bbox" not in url.params
    )
    assert local_query.params["q"] == "eiffel tower"
    assert local_query.params["lang"] == "fr"
    # The local query is limited to the view plus its margin.
    west, south, east, north = map(float, local_query.params["bbox"].split(","))
    assert west < 2.25 and east > 2.42 and south < 48.81 and north > 48.91
    # The worldwide one is biased toward the view's centre.
    assert float(worldwide_query.params["lat"]) == pytest.approx(48.86)
    assert float(worldwide_query.params["lon"]) == pytest.approx(2.335)


def test_each_group_is_capped_at_limit() -> None:
    far = [feature(100 + i, -100 + i, 40) for i in range(10)]
    handler = photon_returning(local=[TOWER, TOWER_HOTEL], worldwide=far, seen=[])
    body = search_with(handler, q="x", bbox=PARIS_VIEW, limit=1).json()
    assert len(body["nearby"]) == 1 and len(body["elsewhere"]) == 1


def test_without_a_view_everything_is_elsewhere() -> None:
    seen: list[httpx.URL] = []
    handler = photon_returning(local=[], worldwide=[TOWER, CANADA], seen=seen)
    body = search_with(handler, q="eiffel tower").json()
    assert body["nearby"] == []
    assert len(body["elsewhere"]) == 2
    assert len(seen) == 1 and "bbox" not in seen[0].params


def test_one_failing_query_still_returns_the_other() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if "bbox" in request.url.params:
            return httpx.Response(500)
        return httpx.Response(
            200, json={"type": "FeatureCollection", "features": [CANADA]}
        )

    body = search_with(handler, q="x", bbox=PARIS_VIEW).json()
    assert [f["properties"]["osm_id"] for f in body["elsewhere"]] == [4]


def test_drops_language_photon_does_not_support() -> None:
    seen: list[httpx.URL] = []
    search_with(photon_returning([], [], seen), q="louvre", lang="es")
    assert "lang" not in seen[0].params


def test_provider_failure_is_a_502() -> None:
    assert (
        search_with(lambda request: httpx.Response(500), q="louvre").status_code == 502
    )


@pytest.mark.parametrize(
    "params",
    [
        {"q": ""},
        {"q": "x", "limit": 50},
        {"q": "x", "bbox": "1,2,3"},
        {"q": "x", "bbox": "3,48,2,49"},  # west > east
        {"q": "x", "bbox": "a,b,c,d"},
        {"q": "x", "bbox": "0,-100,1,1"},
    ],
)
def test_validates_parameters(params: dict) -> None:
    def photon(request: httpx.Request) -> httpx.Response:
        raise AssertionError("should not be called")

    assert search_with(photon, **params).status_code == 422


def test_view_margin_is_clamped_to_the_world() -> None:
    padded = View(-180, -90, 180, 90).padded()
    assert (padded.west, padded.south, padded.east, padded.north) == (
        -180,
        -90,
        180,
        90,
    )

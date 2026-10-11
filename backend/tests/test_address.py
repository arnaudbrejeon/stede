import httpx
from fastapi.testclient import TestClient

from stede.main import app


def photon(properties: dict) -> dict:
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [2.3389, 48.8519]},
        "properties": properties,
    }


def address_with(close: list[dict], around: list[dict], seen=None, **params):
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request.url)
        assert request.url.path == "/reverse"
        features = close if "layer" in request.url.params else around
        return httpx.Response(
            200, json={"type": "FeatureCollection", "features": features}
        )

    with TestClient(app) as client:
        app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        return client.get(
            "/api/address", params={"lat": 48.8519, "lon": 2.3389} | params
        )


def test_house_nearby_gives_a_street_address() -> None:
    seen: list[httpx.URL] = []
    house = photon(
        {
            "type": "house",
            "name": "Le Relais Saint-Germain",
            "housenumber": "9",
            "street": "Carrefour de l'Odéon",
            "city": "Paris",
            "country": "France",
        }
    )
    response = address_with([house], [], seen, lang="fr-FR")
    assert response.json() == {"address": "9 Carrefour de l'Odéon, Paris, France"}
    assert seen[0].params.get_list("layer") == ["house", "street"]
    assert seen[0].params["lang"] == "fr"


def test_a_street_is_named_by_its_name() -> None:
    street = photon(
        {
            "type": "street",
            "name": "Apache Street",
            "city": "Grand Canyon Village",
            "country": "United States",
        }
    )
    assert address_with([street], []).json() == {
        "address": "Apache Street, Grand Canyon Village, United States"
    }


def test_far_from_streets_says_near_the_town() -> None:
    village = photon(
        {
            "type": "city",
            "name": "Grand Canyon Village",
            "state": "Arizona",
            "country": "United States",
        }
    )
    assert address_with([], [village]).json() == {
        "address": "Near Grand Canyon Village, Arizona, United States"
    }


def test_nothing_around_is_null() -> None:
    assert address_with([], []).json() == {"address": None}


def test_rejects_points_off_the_map() -> None:
    assert address_with([], [], lat=95).status_code == 422


def test_provider_failure_is_a_502() -> None:
    with TestClient(app) as client:
        app.state.http = httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: httpx.Response(500))
        )
        assert (
            client.get("/api/address", params={"lat": 1, "lon": 1}).status_code == 502
        )

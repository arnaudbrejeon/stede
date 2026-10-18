import httpx
import pytest

from stede.geocoding import GeocodingError, address_at


def photon(properties: dict) -> dict:
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [2.3389, 48.8519]},
        "properties": properties,
    }


async def address_with(close: list[dict], around: list[dict], seen=None, lang=None):
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request.url)
        assert request.url.path == "/reverse"
        features = close if "layer" in request.url.params else around
        return httpx.Response(
            200, json={"type": "FeatureCollection", "features": features}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        return await address_at(client, 2.3389, 48.8519, lang=lang)


async def test_house_nearby_gives_a_street_address() -> None:
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
    address = await address_with([house], [], seen, lang="fr-FR")
    assert address == "9 Carrefour de l'Odéon, Paris, France"
    assert seen[0].params.get_list("layer") == ["house", "street"]
    assert seen[0].params["lang"] == "fr"


async def test_a_street_is_named_by_its_name() -> None:
    street = photon(
        {
            "type": "street",
            "name": "Apache Street",
            "city": "Grand Canyon Village",
            "country": "United States",
        }
    )
    assert (
        await address_with([street], [])
        == "Apache Street, Grand Canyon Village, United States"
    )


async def test_far_from_streets_says_near_the_town() -> None:
    village = photon(
        {
            "type": "city",
            "name": "Grand Canyon Village",
            "state": "Arizona",
            "country": "United States",
        }
    )
    assert (
        await address_with([], [village])
        == "Near Grand Canyon Village, Arizona, United States"
    )


async def test_nothing_around_is_none() -> None:
    assert await address_with([], []) is None


async def test_provider_failure_raises() -> None:
    transport = httpx.MockTransport(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(GeocodingError):
            await address_at(client, 1, 1)

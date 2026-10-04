import httpx
import pytest
from fastapi.testclient import TestClient

from stede import og_image, place_image
from stede.main import app
from stede.place_image import commons_file_from_tags, find_place_image


@pytest.fixture(autouse=True)
def clear_cache() -> None:
    place_image._cache.clear()


def osm(tags: dict[str, str]) -> httpx.Response:
    return httpx.Response(200, json={"elements": [{"tags": tags}]})


def client_for(routes: dict[str, httpx.Response]) -> httpx.AsyncClient:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.host)
        return routes.get(request.url.host, httpx.Response(404))

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client.calls = calls  # type: ignore[attr-defined]
    return client


@pytest.mark.parametrize(
    ("tags", "file"),
    [
        (
            {"image": "https://fr.wikipedia.org/wiki/Fichier:Tour_Eiffel.jpg"},
            "Tour_Eiffel.jpg",
        ),
        (
            {"image": "https://commons.wikimedia.org/wiki/File:Caf%C3%A9.jpg"},
            "Café.jpg",
        ),
        ({"wikimedia_commons": "File:Louvre at night.jpg"}, "Louvre at night.jpg"),
        ({"wikimedia_commons": "Category:Eiffel Tower"}, None),
        ({"image": "https://example.com/photo.jpg"}, None),
    ],
)
def test_commons_file_from_tags(tags: dict[str, str], file: str | None) -> None:
    assert commons_file_from_tags(tags) == file


async def test_commons_tag_wins_without_further_lookups() -> None:
    client = client_for(
        {
            "api.openstreetmap.org": osm(
                {"image": "https://commons.wikimedia.org/wiki/File:A b.jpg"}
            )
        }
    )
    image = await find_place_image(client, "W", 1)
    assert image is not None
    assert image.url.endswith("/Special:FilePath/A_b.jpg?width=640")
    assert image.source.label == "Wikimedia Commons"
    assert client.calls == ["api.openstreetmap.org"]  # type: ignore[attr-defined]


async def test_falls_back_to_wikidata_main_image() -> None:
    wikidata = {
        "claims": {"P18": [{"mainsnak": {"datavalue": {"value": "Louvre.jpg"}}}]}
    }
    client = client_for(
        {
            "api.openstreetmap.org": osm({"wikidata": "Q19675"}),
            "www.wikidata.org": httpx.Response(200, json=wikidata),
        }
    )
    image = await find_place_image(client, "R", 7515426)
    assert image is not None and image.url.endswith("/Louvre.jpg?width=640")


async def test_falls_back_to_website_og_image(monkeypatch: pytest.MonkeyPatch) -> None:
    async def allow(url: str) -> None:
        return None

    monkeypatch.setattr(og_image, "check_public_url", allow)
    client = client_for(
        {
            "api.openstreetmap.org": osm({"website": "https://www.bistro.example/"}),
            "www.bistro.example": httpx.Response(
                200, html='<meta property="og:image" content="/front.jpg">'
            ),
        }
    )
    image = await find_place_image(client, "N", 2)
    assert image is not None
    assert image.url == "https://www.bistro.example/front.jpg"
    assert image.source.label == "bistro.example"


async def test_none_when_nothing_found_and_result_is_cached() -> None:
    client = client_for({"api.openstreetmap.org": osm({"name": "Somewhere"})})
    assert await find_place_image(client, "N", 3) is None
    assert await find_place_image(client, "N", 3) is None
    assert client.calls == ["api.openstreetmap.org"]  # type: ignore[attr-defined]


def test_endpoint_validates_osm_reference() -> None:
    with TestClient(app) as client:
        assert (
            client.get(
                "/api/place-image", params={"osm_type": "X", "osm_id": 1}
            ).status_code
            == 422
        )
        assert (
            client.get(
                "/api/place-image", params={"osm_type": "N", "osm_id": 0}
            ).status_code
            == 422
        )

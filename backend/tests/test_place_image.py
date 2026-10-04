import httpx
import pytest
from fastapi.testclient import TestClient

from stede import place_image, website_image
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

    monkeypatch.setattr(website_image, "check_public_url", allow)
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


def wikidata_handler(
    search_hits: list[str], items: dict[str, tuple[float, float, str]]
):
    """Fake OSM + Wikidata: search returns `search_hits`; items give lat, lon, image."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.openstreetmap.org":
            return osm({"name": "MUMASK", "old_name": "Musée du Carnaval"})
        params = request.url.params
        if params.get("list") == "search":
            assert "nearcoord:" in params["srsearch"]
            return httpx.Response(
                200, json={"query": {"search": [{"title": t} for t in search_hits]}}
            )
        lat, lon, image = items[params["entity"]]
        value = (
            {"latitude": lat, "longitude": lon}
            if params["property"] == "P625"
            else image
        )
        return httpx.Response(
            200,
            json={
                "claims": {
                    params["property"]: [{"mainsnak": {"datavalue": {"value": value}}}]
                }
            },
        )

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_finds_unlinked_wikidata_item_by_name_near_the_place() -> None:
    client = wikidata_handler(
        ["Q1", "Q2"],
        {
            "Q1": (50.4120, 4.1660, "Far.jpg"),  # ~300 m+ away: rejected
            "Q2": (50.4094, 4.1661, "Musee du masque.JPG"),
        },
    )
    image = await find_place_image(client, "W", 1122654457, near=(50.4093, 4.1660))
    assert image is not None and image.url.endswith("/Musee_du_masque.JPG?width=640")


async def test_ignores_wikidata_matches_that_are_too_far() -> None:
    client = wikidata_handler(["Q1"], {"Q1": (50.4200, 4.1660, "Elsewhere.jpg")})
    assert (
        await find_place_image(client, "W", 1122654457, near=(50.4093, 4.1660)) is None
    )


async def test_skips_wikidata_search_without_a_location() -> None:
    client = wikidata_handler([], {})
    assert await find_place_image(client, "W", 1122654457) is None


async def test_empty_results_expire_but_found_images_stay(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = client_for({"api.openstreetmap.org": osm({"name": "Somewhere"})})
    assert await find_place_image(client, "N", 4) is None
    later = place_image.time.monotonic() + place_image.EMPTY_RESULT_TTL_S + 1
    monkeypatch.setattr(place_image.time, "monotonic", lambda: later)
    assert await find_place_image(client, "N", 4) is None
    # Looked up again once the empty result expired.
    assert client.calls == ["api.openstreetmap.org", "api.openstreetmap.org"]  # type: ignore[attr-defined]


def test_endpoint_serves_the_found_image_itself(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def allow(url: str) -> None:
        return None

    monkeypatch.setattr(website_image, "check_public_url", allow)
    jpeg = b"\xff\xd8\xff" + b"0" * 1000

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.openstreetmap.org":
            return osm({"image": "https://img.example/storefront.jpg"})
        if request.url.host == "img.example":
            return httpx.Response(
                200, content=jpeg, headers={"content-type": "image/jpeg"}
            )
        return httpx.Response(404)

    with TestClient(app) as client:
        app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        found = client.get(
            "/api/place-image", params={"osm_type": "N", "osm_id": 9}
        ).json()
        # The real image URL, plus where browsers should load it from.
        assert found["image"]["url"] == "https://img.example/storefront.jpg"
        assert (
            found["image"]["display_url"] == "/api/place-image/file?osm_type=N&osm_id=9"
        )
        file = client.get(found["image"]["display_url"])
    assert file.status_code == 200
    assert file.headers["content-type"] == "image/jpeg"
    assert file.content == jpeg


def test_image_file_is_404_when_the_place_has_none() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return osm({"name": "Nothing to see"})

    with TestClient(app) as client:
        app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        response = client.get(
            "/api/place-image/file", params={"osm_type": "N", "osm_id": 10}
        )
    assert response.status_code == 404

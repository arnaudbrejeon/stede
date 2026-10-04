import httpx
import pytest

from stede import website_image
from stede.website_image import (
    UnsafeURLError,
    check_public_url,
    extract_image,
    find_website_image,
)


def test_extract_prefers_og_image_and_resolves_relative_urls() -> None:
    html = """<head>
      <meta name="twitter:image" content="https://cdn.example.com/tw.jpg">
      <meta property="og:image" content="/img/cover.jpg">
    </head>"""
    assert (
        extract_image(html, "https://example.com/page")
        == "https://example.com/img/cover.jpg"
    )


def test_extract_returns_none_without_tags_or_with_non_http_image() -> None:
    assert extract_image("<head><title>x</title></head>", "https://example.com") is None
    html = '<meta property="og:image" content="javascript:alert(1)">'
    assert extract_image(html, "https://example.com") is None


@pytest.mark.parametrize(
    "url",
    [
        "ftp://example.com/",
        "file:///etc/passwd",
        "http://localhost/",
        "http://127.0.0.1:8000/api/health",
        "http://10.0.0.5/",
        "http://192.168.1.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/",
        "http://user:pass@example.com/",
    ],
)
async def test_rejects_non_public_urls(url: str) -> None:
    with pytest.raises(UnsafeURLError):
        await check_public_url(url)


async def test_follows_redirects_and_rechecks_each_hop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    checked: list[str] = []

    async def fake_check(url: str) -> None:
        checked.append(url)
        if "internal" in url:
            raise UnsafeURLError("non-public")

    monkeypatch.setattr(website_image, "check_public_url", fake_check)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/start":
            return httpx.Response(
                302, headers={"location": "http://internal.example/admin"}
            )
        return httpx.Response(200, html='<meta property="og:image" content="/x.jpg">')

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(UnsafeURLError):
            await find_website_image("https://public.example/start", client)
    assert checked == ["https://public.example/start", "http://internal.example/admin"]


async def test_finds_image_after_safe_redirect(monkeypatch: pytest.MonkeyPatch) -> None:
    async def allow(url: str) -> None:
        return None

    monkeypatch.setattr(website_image, "check_public_url", allow)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/":
            return httpx.Response(301, headers={"location": "/fr/"})
        return httpx.Response(
            200, html='<meta property="og:image" content="cover.jpg">'
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        image = await find_website_image("https://site.example/", client)
    assert image == "https://site.example/fr/cover.jpg"


def test_photo_candidates_skip_logos_and_small_sizes_and_prefer_large() -> None:
    html = """
      <img src="/wp-content/uploads/2025/02/MagpiesLogo2023-scaled.png">
      <img src="https://cdn.example.com/icons/favicon-192x192.png">
      <img src="/wp-content/uploads/2025/02/storefront-300x200.jpg">
      <div style="background-image: url('//static.showit.co/200/abc/1/patio.jpg')"></div>
      <img src="https://cdn.example.com/thumb.jpg?w=120">
    """
    candidates = website_image.photo_candidates(html, "https://shop.example/")
    # Resized copies point at their large version; logos, icons and tiny images are gone.
    assert candidates == [
        "https://static.showit.co/1200/abc/1/patio.jpg",
        "https://shop.example/wp-content/uploads/2025/02/storefront.jpg",
    ]


def test_photo_candidates_find_urls_inside_embedded_json() -> None:
    html = '<script>{"hero":"https:\\/\\/img.example.com\\/dining-room.webp"}</script>'
    assert website_image.photo_candidates(html, "https://x.example/") == [
        "https://img.example.com/dining-room.webp"
    ]


async def test_falls_back_to_a_photo_when_the_page_has_no_preview_image(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def allow(url: str) -> None:
        return None

    monkeypatch.setattr(website_image, "check_public_url", allow)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/":
            return httpx.Response(
                200, html='<img src="/img/tiny.jpg"><img src="/img/terrace.jpg">'
            )
        size = 2_000 if "tiny" in request.url.path else 150_000
        return httpx.Response(
            200, headers={"content-type": "image/jpeg", "content-length": str(size)}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        image = await find_website_image("https://bistro.example/", client)
    # tiny.jpg comes first on the page but is too small to be a photo.
    assert image == "https://bistro.example/img/terrace.jpg"


async def test_upgrades_http_images_to_https_when_available(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def allow(url: str) -> None:
        return None

    monkeypatch.setattr(website_image, "check_public_url", allow)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/":
            return httpx.Response(200, html='<img src="http://cdn.example/oven.jpg">')
        return httpx.Response(
            200, headers={"content-type": "image/jpeg", "content-length": "90000"}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        image = await find_website_image("https://pizzeria.example/", client)
    assert image == "https://cdn.example/oven.jpg"


async def test_checks_https_first_when_http_gets_a_bot_challenge(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def allow(url: str) -> None:
        return None

    monkeypatch.setattr(website_image, "check_public_url", allow)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/":
            return httpx.Response(200, html='<img src="http://host.example/oven.jpg">')
        if request.url.scheme == "http":  # e.g. SiteGround's anti-bot page
            return httpx.Response(202, html="<html>challenge</html>")
        return httpx.Response(
            200, headers={"content-type": "image/jpeg", "content-length": "380000"}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        image = await find_website_image("https://restaurant.example/", client)
    assert image == "https://host.example/oven.jpg"

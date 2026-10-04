import httpx
import pytest

from stede import og_image
from stede.og_image import (
    UnsafeURLError,
    check_public_url,
    extract_image,
    find_og_image,
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

    monkeypatch.setattr(og_image, "check_public_url", fake_check)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/start":
            return httpx.Response(
                302, headers={"location": "http://internal.example/admin"}
            )
        return httpx.Response(200, html='<meta property="og:image" content="/x.jpg">')

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(UnsafeURLError):
            await find_og_image("https://public.example/start", client)
    assert checked == ["https://public.example/start", "http://internal.example/admin"]


async def test_finds_image_after_safe_redirect(monkeypatch: pytest.MonkeyPatch) -> None:
    async def allow(url: str) -> None:
        return None

    monkeypatch.setattr(og_image, "check_public_url", allow)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/":
            return httpx.Response(301, headers={"location": "/fr/"})
        return httpx.Response(
            200, html='<meta property="og:image" content="cover.jpg">'
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        image = await find_og_image("https://site.example/", client)
    assert image == "https://site.example/fr/cover.jpg"

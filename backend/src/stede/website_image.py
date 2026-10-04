"""Find a photo of a place on its own website.

First the page's preview image (og:image / twitter:image); failing that, the
largest-looking photo the page references, which covers the many small-business
sites (WordPress, Showit, Squarespace…) that never set a preview image.

The page URL comes from OpenStreetMap data, so fetching it is a server-side
request forgery risk: only public http(s) hosts are allowed, every redirect hop
is re-checked, and time and size are capped.
"""

import asyncio
import ipaddress
import re
import socket
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpx

MAX_PAGE_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 3
TIMEOUT = httpx.Timeout(5.0)
USER_AGENT = "stede/0.1 (+https://github.com/arnaudbrejeon/stede)"
IMAGE_PROPERTIES = ("og:image:secure_url", "og:image", "og:image:url", "twitter:image")

# A referenced photo must look at least this wide, and weigh at least this much
# when checked, to skip thumbnails, icons and spacers.
MAX_IMAGE_BYTES = 10 * 1024 * 1024  # largest image we serve on a site's behalf
MIN_PHOTO_WIDTH = 400
MIN_PHOTO_BYTES = 20_000
PHOTOS_TO_CHECK = 3

# Image URLs anywhere in the page: attributes, inline styles, embedded JSON.
_IMAGE_URL = re.compile(
    r"(?:https?:)?//[^\s\"'()<>\\]+?\.(?:jpe?g|png|webp)(?:\?[^\s\"'()<>\\]*)?",
    re.IGNORECASE,
)
# Relative image paths in the usual attributes.
_RELATIVE_SRC = re.compile(
    r"(?:src|data-src|data-lazy-src|srcset|data-srcset)\s*=\s*[\"']([^\"']+?\.(?:jpe?g|png|webp)[^\"'\s,]*)",
    re.IGNORECASE,
)
_NOT_A_PHOTO = re.compile(
    r"logo|icon|favicon|sprite|avatar|badge|placeholder|spinner|loader|blank|pixel|emoji|"
    r"flag|payment|button|arrow|cropped-",
    re.IGNORECASE,
)
_WP_SIZE = re.compile(r"-(\d{2,4})x(\d{2,4})(?=\.(?:jpe?g|png|webp)\b)", re.IGNORECASE)
_SHOWIT_SIZE = re.compile(r"(static\.showit\.co/)(\d{2,4})(/)")
_WIDTH_PARAM = re.compile(r"[?&](?:w|width)=(\d{2,4})\b")


class UnsafeURLError(ValueError):
    """The URL isn't a public http(s) address we're willing to fetch."""


async def check_public_url(url: str) -> None:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise UnsafeURLError("only http(s) URLs with a host are allowed")
    if parts.username or parts.password:
        raise UnsafeURLError("URLs with credentials are not allowed")
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(
            parts.hostname, parts.port or (443 if parts.scheme == "https" else 80)
        )
    except socket.gaierror as exc:
        raise UnsafeURLError("host does not resolve") from exc
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if not address.is_global:
            raise UnsafeURLError("host resolves to a non-public address")


async def find_website_image(url: str, client: httpx.AsyncClient) -> str | None:
    page = await fetch_html(url, client)
    if page is None:
        return None
    html, page_url = page
    if image := extract_image(html, page_url):
        return await prefer_https(image, client)
    for candidate in photo_candidates(html, page_url)[:PHOTOS_TO_CHECK]:
        for copy in https_first(candidate):
            if await looks_like_photo(copy, client):
                return copy
    return None


def https_first(url: str) -> list[str]:
    """An http URL's https copy, then itself. Browsers block or rewrite http images
    on https pages, and some hosts answer plain http with a bot challenge."""
    if url.startswith("http://"):
        return ["https://" + url.removeprefix("http://"), url]
    return [url]


async def prefer_https(url: str, client: httpx.AsyncClient) -> str:
    """The first copy of a declared (unchecked) image that loads, https first."""
    for candidate in https_first(url)[:-1]:
        if await looks_like_photo(candidate, client):
            return candidate
    return url


async def fetch_html(url: str, client: httpx.AsyncClient) -> tuple[str, str] | None:
    """The page's HTML and final URL, following redirects safely."""
    for _ in range(MAX_REDIRECTS + 1):
        await check_public_url(url)
        async with client.stream("GET", url, follow_redirects=False) as response:
            if response.is_redirect:
                url = urljoin(url, response.headers.get("location", ""))
                continue
            if response.status_code != 200:
                return None
            if "html" not in response.headers.get("content-type", ""):
                return None
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body += chunk
                if len(body) >= MAX_PAGE_BYTES:
                    break
            encoding = response.encoding or "utf-8"
            return body.decode(encoding, errors="replace"), str(response.url)
    return None


class _MetaImageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.found: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "meta":
            return
        attributes = {name: value or "" for name, value in attrs}
        key = (attributes.get("property") or attributes.get("name") or "").lower()
        content = attributes.get("content", "").strip()
        if key in IMAGE_PROPERTIES and content:
            self.found.setdefault(key, content)


def extract_image(html: str, page_url: str) -> str | None:
    """The page's declared preview image."""
    parser = _MetaImageParser()
    parser.feed(html)
    for key in IMAGE_PROPERTIES:
        if key in parser.found:
            image = urljoin(page_url, parser.found[key])
            return image if urlsplit(image).scheme in ("http", "https") else None
    return None


def photo_candidates(html: str, page_url: str) -> list[str]:
    """Photos the page references, most promising first."""
    text = html.replace("\\/", "/")  # URLs inside embedded JSON
    found = [m.group(0) for m in _IMAGE_URL.finditer(text)]
    found += [m.group(1) for m in _RELATIVE_SRC.finditer(text)]

    scored: dict[str, tuple[int, int]] = {}
    for order, raw in enumerate(found):
        url = urljoin(page_url, raw.strip())
        if urlsplit(url).scheme not in ("http", "https"):
            continue
        path = urlsplit(url).path
        if _NOT_A_PHOTO.search(path):
            continue
        url = _largest_variant(url)
        width = _width_hint(url)
        if width is not None and width < MIN_PHOTO_WIDTH:
            continue
        # Bigger first; unknown sizes count as medium; PNGs are often graphics.
        score = (width or 900) - (300 if path.lower().endswith(".png") else 0)
        # Keep each URL once: its best score and where it first appeared.
        best, first = scored.get(url, (score, order))
        scored[url] = (max(best, score), first)
    return [
        url
        for url, _ in sorted(scored.items(), key=lambda item: (-item[1][0], item[1][1]))
    ]


def _largest_variant(url: str) -> str:
    """Point resized copies at a large version (WordPress -WxH, Showit width path)."""
    url = _WP_SIZE.sub("", url)
    return _SHOWIT_SIZE.sub(lambda m: f"{m.group(1)}1200{m.group(3)}", url)


def _width_hint(url: str) -> int | None:
    for pattern in (_SHOWIT_SIZE, _WIDTH_PARAM):
        if match := pattern.search(url):
            return int(match.group(2) if pattern is _SHOWIT_SIZE else match.group(1))
    return None


async def looks_like_photo(url: str, client: httpx.AsyncClient) -> bool:
    """A real, reasonably large image (headers only; the body isn't downloaded)."""
    try:
        await check_public_url(url)
        async with client.stream("GET", url, follow_redirects=True) as response:
            if response.status_code != 200:
                return False
            if not response.headers.get("content-type", "").startswith("image/"):
                return False
            length = response.headers.get("content-length")
            return length is None or int(length) >= MIN_PHOTO_BYTES
    except UnsafeURLError, httpx.HTTPError, ValueError:
        return False


async def fetch_image(url: str, client: httpx.AsyncClient) -> tuple[bytes, str] | None:
    """An image's bytes and media type, fetched with the same safety checks as pages
    (every redirect hop re-checked, size capped); https first for http URLs."""
    for start in https_first(url):
        try:
            if image := await _fetch_image_once(start, client):
                return image
        except UnsafeURLError, httpx.HTTPError:
            continue
    return None


async def _fetch_image_once(
    url: str, client: httpx.AsyncClient
) -> tuple[bytes, str] | None:
    for _ in range(MAX_REDIRECTS + 1):
        await check_public_url(url)
        async with client.stream("GET", url, follow_redirects=False) as response:
            if response.is_redirect:
                url = urljoin(url, response.headers.get("location", ""))
                continue
            media_type = response.headers.get("content-type", "").split(";")[0].strip()
            if response.status_code != 200 or not media_type.startswith("image/"):
                return None
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body += chunk
                if len(body) > MAX_IMAGE_BYTES:
                    return None
            return bytes(body), media_type
    return None


def make_client(**kwargs: object) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=TIMEOUT,
        headers={"User-Agent": USER_AGENT},
        **kwargs,  # type: ignore[arg-type]
    )

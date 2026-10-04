"""Find a web page's preview image (og:image / twitter:image).

The page URL comes from the client, so fetching it is a server-side request
forgery risk: only public http(s) hosts are allowed, every redirect hop is
re-checked, and time and size are capped.
"""

import asyncio
import ipaddress
import socket
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpx

MAX_BYTES = 512 * 1024  # og tags live in <head>; no need for the whole page
MAX_REDIRECTS = 3
TIMEOUT = httpx.Timeout(5.0)
USER_AGENT = "stede/0.1 (+https://github.com/arnaudbrejeon/stede)"
IMAGE_PROPERTIES = ("og:image:secure_url", "og:image", "og:image:url", "twitter:image")


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
    parser = _MetaImageParser()
    parser.feed(html)
    for key in IMAGE_PROPERTIES:
        if key in parser.found:
            image = urljoin(page_url, parser.found[key])
            return image if urlsplit(image).scheme in ("http", "https") else None
    return None


async def find_og_image(url: str, client: httpx.AsyncClient) -> str | None:
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
                if len(body) >= MAX_BYTES:
                    break
            encoding = response.encoding or "utf-8"
            return extract_image(
                body.decode(encoding, errors="replace"), str(response.url)
            )
    return None


def make_client(**kwargs: object) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=TIMEOUT,
        headers={"User-Agent": USER_AGENT},
        **kwargs,  # type: ignore[arg-type]
    )

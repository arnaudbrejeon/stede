#!/usr/bin/env python3
"""strfry write policy for the stede relay: only place events, only from known authors.

strfry feeds one JSON line per incoming event on stdin and expects one JSON line
back ({"id", "action", "msg"}). See https://github.com/hoytech/strfry/blob/master/docs/plugins.md

Accepted kinds:
  31300  place (NIP-XX Places, https://github.com/nostr-protocol/nips/issues/2492)
  31301  private place: a place NIP-44 encrypted to its author (proposed for NIP-XX)
  30003  bookmark set (NIP-51), e.g. a curated list of places
      5  deletion request (NIP-09)

Authors: hex pubkeys listed in the file named by STEDE_RELAY_AUTHORS
(default /app/authors.txt; one per line, "#" comments). Set
STEDE_RELAY_OPEN_WRITES=1 to accept any author (development only).

Only the standard library is used, so the script runs on the relay's python3.
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import sys
from pathlib import Path

PLACE_KIND = 31300
PRIVATE_PLACE_KIND = 31301
BOOKMARK_SET_KIND = 30003
DELETION_KIND = 5
ALLOWED_KINDS = {PLACE_KIND, PRIVATE_PLACE_KIND, BOOKMARK_SET_KIND, DELETION_KIND}

AUTHORS_FILE = Path(os.environ.get("STEDE_RELAY_AUTHORS", "/app/authors.txt"))
OPEN_WRITES = os.environ.get("STEDE_RELAY_OPEN_WRITES") == "1"

GEOHASH_ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz"
MAX_GEOHASH_LENGTH = 12
MAX_D_LENGTH = 64

# NIP-44 v2 payload: version byte, 32-byte nonce, padded ciphertext (32 to 65536
# bytes), 32-byte MAC; base64 encoded.
NIP44_VERSION = 2
NIP44_MIN_DECODED = 1 + 32 + 32 + 32
NIP44_MAX_DECODED = 1 + 32 + 65536 + 32


def load_authors(path: Path = AUTHORS_FILE) -> set[str] | None:
    """Allowed authors, or None when the file is missing (writes then stay closed)."""
    try:
        lines = path.read_text().splitlines()
    except OSError:
        return None
    authors = set()
    for line in lines:
        value = line.split("#", 1)[0].strip().lower()
        if value:
            authors.add(value)
    return authors


def check(
    event: dict, authors: set[str] | None, open_writes: bool = False
) -> str | None:
    """Why the event must be rejected, or None to accept it."""
    kind = event.get("kind")
    if kind not in ALLOWED_KINDS:
        return f"blocked: this relay only stores place events (kinds {sorted(ALLOWED_KINDS)})"
    if not open_writes:
        if authors is None:
            return "blocked: this relay is not accepting writes yet"
        if event.get("pubkey", "").lower() not in authors:
            return "restricted: this relay only stores places from registered authors"
    if kind == PLACE_KIND:
        return check_place(event)
    if kind == PRIVATE_PLACE_KIND:
        return check_private_place(event)
    return None


def check_place(event: dict) -> str | None:
    tags = event.get("tags") or []
    values: dict[str, list[str]] = {}
    for tag in tags:
        if isinstance(tag, list) and len(tag) >= 2 and isinstance(tag[1], str):
            values.setdefault(tag[0], []).append(tag[1])

    if len(values.get("d", [])) != 1 or not values["d"][0]:
        return "invalid: a place needs exactly one non-empty d tag"
    if not any(name.strip() for name in values.get("name", [])):
        return "invalid: a place needs a name tag"
    geo = values.get("geo", [])
    if len(geo) != 1:
        return "invalid: a place needs exactly one geo tag"
    try:
        lat, lon = parse_geo(geo[0])
    except ValueError as exc:
        return f"invalid: geo tag {exc}"

    expected = geohash(lat, lon, MAX_GEOHASH_LENGTH)
    for g in values.get("g", []):
        if not 1 <= len(g) <= MAX_GEOHASH_LENGTH or not expected.startswith(g):
            return "invalid: g tag is not a geohash of the place's geo coordinates"
    return None


def check_private_place(event: dict) -> str | None:
    """A private place shows only its d tag; everything else is in the NIP-44 content."""
    tags = event.get("tags") or []
    if (
        len(tags) != 1
        or not isinstance(tags[0], list)
        or len(tags[0]) != 2
        or tags[0][0] != "d"
        or not isinstance(tags[0][1], str)
        or not 0 < len(tags[0][1]) <= MAX_D_LENGTH
    ):
        return "invalid: a private place must have a d tag and no other tags"
    content = event.get("content")
    if not isinstance(content, str) or not is_nip44_payload(content):
        return "invalid: a private place's content must be a NIP-44 v2 payload"
    return None


def is_nip44_payload(content: str) -> bool:
    try:
        data = base64.b64decode(content, validate=True)
    except (binascii.Error, ValueError):
        return False
    return (
        NIP44_MIN_DECODED <= len(data) <= NIP44_MAX_DECODED and data[0] == NIP44_VERSION
    )


def parse_geo(value: str) -> tuple[float, float]:
    """Latitude and longitude of an RFC 5870 geo path, with or without the "geo:" scheme.

    geo:48.8519,2.3389 | 48.8519,2.3389,35 | 48.8519,2.3389;crs=wgs84;u=10
    """
    path = value.strip()
    if path.lower().startswith("geo:"):
        path = path[4:]
    coordinates, _, params = path.partition(";")
    for param in filter(None, params.split(";")):
        key, _, val = param.partition("=")
        if key.lower() == "crs" and val.lower() != "wgs84":
            raise ValueError("must use the wgs84 coordinate system")
    parts = coordinates.split(",")
    if len(parts) not in (2, 3):
        raise ValueError("must be latitude,longitude[,altitude]")
    try:
        lat, lon = float(parts[0]), float(parts[1])
    except ValueError:
        raise ValueError("must hold decimal coordinates") from None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("has coordinates out of range")
    return lat, lon


def geohash(lat: float, lon: float, length: int) -> str:
    """Standard geohash of a point (the same cells the `g` tag convention uses)."""
    lat_range, lon_range = [-90.0, 90.0], [-180.0, 180.0]
    out, bits, bit, even = [], 0, 0, True
    while len(out) < length:
        if even:
            mid = (lon_range[0] + lon_range[1]) / 2
            if lon >= mid:
                bits = bits * 2 + 1
                lon_range[0] = mid
            else:
                bits *= 2
                lon_range[1] = mid
        else:
            mid = (lat_range[0] + lat_range[1]) / 2
            if lat >= mid:
                bits = bits * 2 + 1
                lat_range[0] = mid
            else:
                bits *= 2
                lat_range[1] = mid
        even = not even
        bit += 1
        if bit == 5:
            out.append(GEOHASH_ALPHABET[bits])
            bits = bit = 0
    return "".join(out)


def main() -> None:
    authors = load_authors()
    if authors is None and not OPEN_WRITES:
        print(
            f"policy: {AUTHORS_FILE} not found, rejecting all writes",
            file=sys.stderr,
            flush=True,
        )
    for line in sys.stdin:
        try:
            request = json.loads(line)
            event = request["event"]
            reply = {"id": event["id"]}
        except (ValueError, KeyError, TypeError):
            continue
        reason = check(event, authors, OPEN_WRITES)
        if reason is None:
            reply["action"] = "accept"
        else:
            reply["action"] = "reject"
            reply["msg"] = reason
        print(json.dumps(reply, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()

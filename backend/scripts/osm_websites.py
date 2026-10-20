"""Add each place's website from OpenStreetMap to a stede places file.

For every place linked to an OSM element (its `i` tag, osm:node/123…) and
without a website yet, looks up the element's tags with Overpass, many
elements per query, and writes its `website` (or `contact:website`) as the
place's `r` tag, which the app shows and lets you edit. Places that already
have an `r` keep it.

A place given a website gets a new created_at, so that importing the file
into the app updates the place you already have. That replaces the app's
version with the file's: run this on a fresh export from the app (key drawer,
Export) rather than on an old file, so it carries your latest edits.

    cd backend
    uv run python scripts/osm_websites.py                       # data/stede-places.json
    uv run python scripts/osm_websites.py -f ~/stede-export.json  # an export
"""

import argparse
import hashlib
import json
import re
import shutil
import sys
import time
from collections import defaultdict
from pathlib import Path

import httpx

from stede.places_file import tag_value, web_url

DATA = Path(__file__).resolve().parents[2] / "data"
PLACES_FILE = DATA / "stede-places.json"
CACHE_DIR = DATA / ".osm_cache"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "stede/0.1 (personal places map; OSM websites script)"
# Elements per Overpass query.
BATCH_SIZE = 1000


def overpass_tags(ids: list[tuple[str, int]], client: httpx.Client) -> dict:
    """The tags of OSM elements, keyed by "type/id"."""
    by_type: dict[str, list[int]] = defaultdict(list)
    for osm_type, osm_id in ids:
        by_type[osm_type].append(osm_id)
    clauses = "".join(
        f"{osm_type}(id:{','.join(map(str, sorted(ids)))});"
        for osm_type, ids in sorted(by_type.items())
    )
    query = f"[out:json][timeout:180];({clauses});out tags;"
    cache = CACHE_DIR / f"{hashlib.sha1(query.encode()).hexdigest()}.json"
    if cache.exists():
        elements = json.loads(cache.read_text())["elements"]
    else:
        elements = overpass(query, cache, client)
    return {f"{el['type']}/{el['id']}": el.get("tags", {}) for el in elements}


def overpass(query: str, cache: Path, client: httpx.Client) -> list[dict]:
    for attempt in range(20):
        try:
            resp = client.post(OVERPASS_URL, data={"data": query})
        except httpx.HTTPError as e:
            print(f"  network error ({e!r}), retrying", file=sys.stderr)
        else:
            if resp.status_code == 200:
                cache.write_text(resp.text)
                return resp.json()["elements"]
            print(f"  Overpass said {resp.status_code}, retrying", file=sys.stderr)
        # 429 (no free slot) and 504 (server busy) both clear up within seconds.
        time.sleep(min(5 * (attempt + 1), 60))
    raise RuntimeError(
        "Overpass kept failing; rerun later, finished batches are cached"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "-f",
        "--file",
        type=Path,
        default=PLACES_FILE,
        help="stede places file (default: data/stede-places.json)",
    )
    args = parser.parse_args()
    path = args.file.resolve()

    data = json.loads(path.read_text())
    places = data["places"]
    todo: dict[str, list[dict]] = defaultdict(list)
    for place in places:
        link = tag_value(place, "i") or ""
        if tag_value(place, "r") is None and re.fullmatch(
            r"osm:(node|way|relation)/\d+", link
        ):
            todo[link.removeprefix("osm:")].append(place)
    ids = sorted(
        (osm_type, int(osm_id)) for osm_type, osm_id in (k.split("/") for k in todo)
    )
    print(f"{len(ids)} OSM elements to look up, {len(ids) // BATCH_SIZE + 1} queries")

    CACHE_DIR.mkdir(exist_ok=True)
    now = int(time.time())
    found = 0
    with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=240) as client:
        for start in range(0, len(ids), BATCH_SIZE):
            tags = overpass_tags(ids[start : start + BATCH_SIZE], client)
            for key, element_tags in tags.items():
                raw = element_tags.get("website") or element_tags.get("contact:website")
                url = web_url(raw or "")
                if not url:
                    continue
                for place in todo.get(key, []):
                    place["tags"].append(["r", url])
                    place["created_at"] = now
                    found += 1
            print(f"  {min(start + BATCH_SIZE, len(ids))}/{len(ids)}, {found} websites")

    backup = path.with_suffix(".json.bak")
    if not backup.exists():
        shutil.copy2(path, backup)
    # Written beside the file, then swapped in, so it's never left half-written.
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    tmp.replace(path)
    print(f"{found} places given a website, written to {path} (copy in {backup.name})")


if __name__ == "__main__":
    main()

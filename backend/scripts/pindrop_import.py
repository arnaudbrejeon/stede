"""Turn a Pindrop export into a Mapstr-shaped file the other scripts understand.

Reads data/pindrop.geojson and writes data/pindrop.json, with each place shaped
like a Mapstr place (name, address, tags, userComment), so scripts/match_osm.py,
scripts/assign_icons.py and scripts/mapstr_to_stede.py work on it as they do on
data/mapstr.json. Pindrop's own details are kept under `properties.pindrop`
(id, date dropped, photo links).

Pindrop's export names tags by id only. Their names come from
data/pindrop-tags.json, which this script creates the first time: tags found
on the places you also have in Mapstr (same name, within 100 m) get the Mapstr
tag they go with, when the match is clear; the others are left for you to name.
Edit the file and run the script again: tags left without a name are dropped.

Places without an address get one from Photon's reverse geocoding at the pin
(one place a second; answers are cached in data/.photon_cache/).

    cd backend
    uv run python scripts/pindrop_import.py                # tags file, then data/pindrop.json
    uv run python scripts/pindrop_import.py --no-addresses # skip the address lookups
"""

import argparse
import asyncio
import hashlib
import json
import math
import re
import time
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import httpx

from stede.geocoding import GeocodingError, address_at

DATA = Path(__file__).resolve().parents[2] / "data"
PINDROP_FILE = DATA / "pindrop.geojson"
MAPSTR_FILE = DATA / "mapstr.json"
TAGS_FILE = DATA / "pindrop-tags.json"
OUTPUT_FILE = DATA / "pindrop.json"
PHOTON_CACHE_DIR = DATA / ".photon_cache"
USER_AGENT = "stede/0.1 (personal places map; Pindrop import script)"
# Komoot's Photon server is free for fair use: about one request a second.
PHOTON_INTERVAL = 1.0
# A Pindrop tag is given a Mapstr tag's name when they go together this well
# (Jaccard similarity over the places in both) on at least this many places.
MIN_SIMILARITY = 0.7
MIN_SHARED = 5
DUPLICATE_DISTANCE_M = 100


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--no-addresses",
        action="store_true",
        help="don't look up addresses for places without one",
    )
    args = parser.parse_args()

    pindrop = json.loads(PINDROP_FILE.read_text())["features"]
    if not TAGS_FILE.exists():
        mapstr = json.loads(MAPSTR_FILE.read_text())["features"]
        tags = infer_tag_names(pindrop, mapstr)
        TAGS_FILE.write_text(json.dumps(tags, ensure_ascii=False, indent=2))
        named = sum(1 for t in tags.values() if t["name"])
        print(f"{TAGS_FILE}: {named} of {len(tags)} tags named from Mapstr")
    tags = json.loads(TAGS_FILE.read_text())

    features = [to_mapstr_shape(f, tags) for f in pindrop]
    carry_over(features)
    if not args.no_addresses:
        asyncio.run(fill_addresses(features))
    OUTPUT_FILE.write_text(
        json.dumps(
            {"type": "FeatureCollection", "features": features},
            ensure_ascii=False,
            indent=2,
        )
    )
    unnamed = [t for t in tags.values() if not t["name"]]
    print(f"{len(features)} places written to {OUTPUT_FILE}")
    if unnamed:
        uses = sum(t["uses"] for t in unnamed)
        print(
            f"{len(unnamed)} tags without a name dropped ({uses} uses); "
            f"name them in {TAGS_FILE} to keep them"
        )


# Found by this script or the others on an earlier run; kept when it runs again
# (to rename tags, say), so nothing has to be looked up twice.
CARRIED = ("osm", "osm_tried", "stede")


def carry_over(features: list[dict]) -> None:
    if not OUTPUT_FILE.exists():
        return
    before = {
        f["properties"]["pindrop"]["id"]: f["properties"]
        for f in json.loads(OUTPUT_FILE.read_text())["features"]
    }
    for f in features:
        props = f["properties"]
        old = before.get(props["pindrop"]["id"])
        if not old:
            continue
        for key in CARRIED:
            if key in old:
                props[key] = old[key]
        if not props["address"] and old.get("address"):
            props["address"] = old["address"]


def to_mapstr_shape(feature: dict, tags: dict) -> dict:
    props = feature["properties"]
    labels = []
    for tag_id in props.get("tags") or []:
        name = (tags.get(tag_id) or {}).get("name")
        if name and name not in labels:
            labels.append(name)
    return {
        "type": "Feature",
        "geometry": feature["geometry"],
        "properties": {
            "name": (props.get("name") or "").strip(),
            "address": clean_address(props.get("address") or ""),
            "tags": [{"name": label} for label in labels],
            **(
                {"userComment": d}
                if (d := (props.get("description") or "").strip())
                else {}
            ),
            "pindrop": {
                "id": props.get("id"),
                "date_dropped": props.get("date_dropped"),
                "photos": props.get("mediaLinks") or [],
            },
        },
    }


def clean_address(address: str) -> str:
    """ ", Wellington, NB, Canada" -> "Wellington, NB, Canada"."""
    parts = [p.strip() for p in address.split(",")]
    return ", ".join(p for p in parts if p)


def infer_tag_names(pindrop: list[dict], mapstr: list[dict]) -> dict:
    """Pindrop tag id -> the Mapstr tag it matches, from the places in both."""
    by_name = defaultdict(list)
    for f in mapstr:
        by_name[normalise(f["properties"]["name"])].append(f)
    pairs = []
    for f in pindrop:
        lon, lat = f["geometry"]["coordinates"][:2]
        for m in by_name.get(normalise(f["properties"]["name"]), []):
            mlon, mlat = m["geometry"]["coordinates"][:2]
            if distance_m(lat, lon, mlat, mlon) <= DUPLICATE_DISTANCE_M:
                pairs.append(
                    (
                        set(f["properties"]["tags"]),
                        {t["name"] for t in m["properties"]["tags"]},
                    )
                )
                break
    ids = Counter(t for ts, _ in pairs for t in ts)
    names = Counter(n for _, ns in pairs for n in ns)
    both = Counter((t, n) for ts, ns in pairs for t in ts for n in ns)
    uses = Counter(t for f in pindrop for t in f["properties"]["tags"])

    out = {}
    for tag_id, count in uses.most_common():
        entry = {"name": None, "uses": count, "shared_with_mapstr": ids[tag_id]}
        if ids[tag_id]:
            guess = max(
                names, key=lambda n: jaccard(both[(tag_id, n)], ids[tag_id], names[n])
            )
            score = jaccard(both[(tag_id, guess)], ids[tag_id], names[guess])
            entry["mapstr_guess"] = guess
            entry["similarity"] = round(score, 2)
            if score >= MIN_SIMILARITY and ids[tag_id] >= MIN_SHARED:
                entry["name"] = guess
        out[tag_id] = entry
    return out


def jaccard(together: int, a: int, b: int) -> float:
    return together / (a + b - together) if together else 0.0


async def fill_addresses(features: list[dict]) -> None:
    todo = [f for f in features if not f["properties"]["address"]]
    print(f"addresses: {len(todo)} places without one")
    PHOTON_CACHE_DIR.mkdir(exist_ok=True)
    found = 0
    async with httpx.AsyncClient(
        headers={"User-Agent": USER_AGENT}, timeout=30
    ) as client:
        for n, f in enumerate(todo, 1):
            lon, lat = f["geometry"]["coordinates"][:2]
            address = await cached_address(client, lon, lat)
            if address:
                f["properties"]["address"] = address
                found += 1
            if n % 100 == 0 or n == len(todo):
                print(f"  {n}/{len(todo)} looked up, {found} found")


async def cached_address(
    client: httpx.AsyncClient, lon: float, lat: float
) -> str | None:
    key = hashlib.sha1(f"reverse:{lat:.6f},{lon:.6f}".encode()).hexdigest()
    cache = PHOTON_CACHE_DIR / f"{key}.json"
    if cache.exists():
        return json.loads(cache.read_text())["address"]
    started = time.monotonic()
    for attempt in range(5):
        try:
            address = await address_at(client, lon, lat)
            break
        except (GeocodingError, httpx.HTTPError) as e:
            print(f"  Photon failed ({e}), retrying")
            await asyncio.sleep(5 * (attempt + 1))
    else:
        return None
    cache.write_text(json.dumps({"address": address}, ensure_ascii=False))
    # address_at may ask twice (house or street, then anything near).
    await asyncio.sleep(max(0.0, 2 * PHOTON_INTERVAL - (time.monotonic() - started)))
    return address


def normalise(name: str) -> str:
    """ "Gili-Gili" and "gili gili" are the same name (as the app's normalizeName)."""
    name = unicodedata.normalize("NFD", name)
    name = "".join(c for c in name if not unicodedata.combining(c)).lower()
    return re.sub(r"[^\w]+|_", " ", name).strip()


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = math.radians
    h = (
        math.sin(r(lat2 - lat1) / 2) ** 2
        + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(r(lon2 - lon1) / 2) ** 2
    )
    return 2 * 6371008.8 * math.asin(math.sqrt(h))


if __name__ == "__main__":
    main()

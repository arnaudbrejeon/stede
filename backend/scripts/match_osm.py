"""Find the OpenStreetMap element behind each saved Mapstr place.

For every feature in data/mapstr.json, asks Overpass for named OSM elements
around its coordinates and keeps the one whose name best matches. Matches are
written back into the file as `properties.osm`:

    {"type": "node", "id": 123, "name": "Le Comptoir", "distance_m": 12, "score": 0.95}

Overpass responses are cached in data/.osm_cache/, so an interrupted run can be
restarted and only the missing batches are fetched. A copy of the original
file is kept next to it as mapstr.json.bak.

    cd backend
    uv run python scripts/match_osm.py            # all places
    uv run python scripts/match_osm.py --limit 200  # try it on a sample
"""

import argparse
import hashlib
import json
import math
import re
import shutil
import sys
import time
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

import httpx

DATA = Path(__file__).resolve().parents[2] / "data"
PLACES_FILE = DATA / "mapstr.json"
CACHE_DIR = DATA / ".osm_cache"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "stede/0.1 (personal places map; OSM matching script)"

# Mapstr icons for places that cover a large area: their OSM element may be a
# park or mountain whose centre is far from the pin.
LARGE_ICONS = {
    "park",
    "forest",
    "beach",
    "mountain",
    "hiking",
    "nature",
    "geocode",
    "ski",
    "travel",
    "zoo",
    "amusement",
    "golf",
    "camping",
    "historic",
}

# (radius in metres, points per Overpass query, minimum name similarity, which
# places). The first pass looks close by; the later ones look further for
# what's left (places whose Mapstr pin is a bit off, parks, mountains), but
# insist on a closer name match.
PASSES = [
    (100, 10, 0.84, lambda icon: True),
    (400, 15, 0.9, lambda icon: icon not in LARGE_ICONS),
    (2000, 10, 0.9, lambda icon: icon in LARGE_ICONS),
]

NAME_TAGS = (
    "name",
    "official_name",
    "alt_name",
    "old_name",
    "short_name",
    "brand",
    "int_name",
)
# Words too common to tell two places apart.
STOPWORDS = {
    "le",
    "la",
    "les",
    "l",
    "de",
    "du",
    "des",
    "d",
    "et",
    "the",
    "of",
    "and",
    "a",
    "el",
    "los",
    "las",
    "il",
    "lo",
    "di",
    "del",
    "da",
    "der",
    "die",
    "das",
    "y",
    "restaurant",
    "hotel",
    "cafe",
    "bar",
    "chez",
    "musee",
    "museum",
    "museo",
}


def normalise(name: str) -> str:
    name = unicodedata.normalize("NFKD", name.casefold())
    name = "".join(c for c in name if not unicodedata.combining(c))
    name = re.sub(r"[^\w\s]", " ", name)
    return " ".join(name.split())


def similarity(a: str, b: str, near: bool = False) -> float:
    """How alike two place names are, from 0 to 1.

    `near` says the OSM element sits right on the pin: then a name that's
    part of the other ("Clover" for "Restaurant Clover Saint-Germain") is
    good enough.
    """
    a, b = normalise(a), normalise(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    ratio = SequenceMatcher(None, a, b).ratio()
    # "Asador Ordoki" vs "Restaurante Asador Ordoki": one name holds the other.
    ta, tb = set(a.split()) - STOPWORDS, set(b.split()) - STOPWORDS
    if ta and tb:
        short, long_ = sorted((ta, tb), key=len)
        short_len, long_len = sum(map(len, short)), sum(map(len, long_))
        if short <= long_ and short_len >= 4:
            # The more the longer name adds, the less sure we are.
            ratio = max(ratio, 0.85 if near else 0.7 + 0.25 * short_len / long_len)
        else:
            overlap = len(ta & tb) / len(ta | tb)
            ratio = max(ratio, overlap * 0.9)
    return ratio


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def element_position(el: dict) -> tuple[float, float] | None:
    if "lat" in el:
        return el["lat"], el["lon"]
    if "center" in el:
        return el["center"]["lat"], el["center"]["lon"]
    return None


def name_pattern(name: str) -> str | None:
    """A regex for the place's most telling word, for Overpass to filter on.

    Vowels, c and n become wildcards, so "Bodegon" still finds "Bodegón" and
    "Pacharan" finds "Patxarán"… mostly; the local match decides in the end.
    """
    words = [w for w in normalise(name).split() if w not in STOPWORDS and len(w) >= 4]
    if not words:
        return None
    word = max(words, key=len)
    return "".join("." if c in "aeiouycn" else re.escape(c) for c in word)


def overpass(
    points: list[tuple[float, float, str | None]], radius: int, client: httpx.Client
) -> list[dict]:
    filters = "[name][!highway][boundary!=administrative]"
    clauses = "".join(
        f"nwr(around:{radius},{lat:.7f},{lon:.7f}){filters}"
        + (f'[~"^(name|alt_name|official_name)"~"{pattern}",i]' if pattern else "")
        + ";"
        for lat, lon, pattern in points
    )
    query = f"[out:json][timeout:90];({clauses});out tags center;"
    cache = CACHE_DIR / f"{hashlib.sha1(query.encode()).hexdigest()}.json"
    if cache.exists():
        return json.loads(cache.read_text())["elements"]
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


def best_match(
    feature: dict, elements: list[dict], radius: int, min_score: float
) -> dict | None:
    lon, lat = feature["geometry"]["coordinates"][:2]
    name = feature["properties"]["name"]
    icon = feature["properties"].get("icon")
    # A building or park is near the pin even when its centre is further away;
    # Overpass already checked its outline, so allow some slack for areas.
    area_slack = 5000 if icon in LARGE_ICONS else 300
    best = None
    for el in elements:
        pos = element_position(el)
        if pos is None:
            continue
        dist = distance_m(lat, lon, *pos)
        if dist > (radius if el["type"] == "node" else radius + area_slack):
            continue
        tags = el.get("tags", {})
        # "Whitestone Inn" is not the village of Whitestone.
        if "place" in tags and icon not in ("geocode", "generic", None):
            continue
        # …and a town searched for in Mapstr is not a shop named after it.
        if icon == "geocode" and "place" not in tags:
            continue
        names = [v for k, v in tags.items() if k in NAME_TAGS or k.startswith("name:")]
        sim = max((similarity(name, n, near=dist <= 30) for n in names), default=0.0)
        if sim < min_score:
            continue
        # Prefer the better name, unless it's much further away: "Clover" on
        # the pin beats the "Saint-Germain" district 175 m off.
        rank = sim - dist / 1000
        if best is None or rank > best[0]:
            best = (rank, el, dist, sim)
    if best is None:
        return None
    _, el, dist, sim = best
    return {
        "type": el["type"],
        "id": el["id"],
        "name": el["tags"].get("name"),
        "distance_m": round(dist),
        "score": round(sim, 2),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--limit", type=int, help="only look at the first N places")
    parser.add_argument(
        "--redo", action="store_true", help="re-match places that already have osm"
    )
    args = parser.parse_args()

    collection = json.loads(PLACES_FILE.read_text())
    features = collection["features"][: args.limit]
    CACHE_DIR.mkdir(exist_ok=True)
    backup = PLACES_FILE.with_suffix(".json.bak")
    if not backup.exists():
        shutil.copy2(PLACES_FILE, backup)

    todo = [f for f in features if args.redo or "osm" not in f["properties"]]
    for f in todo:
        f["properties"].pop("osm", None)
    print(f"{len(todo)} places to match")

    with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=240) as client:
        for radius, batch_size, min_score, applies in PASSES:
            todo = [f for f in todo if "osm" not in f["properties"]]
            todo_pass = [f for f in todo if applies(f["properties"].get("icon"))]
            # Far around a point there are thousands of named things: past the
            # first pass, only ask for those sharing a word with the place.
            # (A place with no such word can only be found close by.)
            wide = radius > PASSES[0][0]
            if wide:
                todo_pass = [
                    f for f in todo_pass if name_pattern(f["properties"]["name"])
                ]
            # Sort roughly by location so each query covers one area.
            todo_pass.sort(
                key=lambda f: (
                    round(f["geometry"]["coordinates"][1]),
                    f["geometry"]["coordinates"][0],
                )
            )
            batches = [
                todo_pass[i : i + batch_size]
                for i in range(0, len(todo_pass), batch_size)
            ]
            print(f"pass {radius} m: {len(todo_pass)} places, {len(batches)} queries")
            found = 0
            for n, batch in enumerate(batches, 1):
                points = [
                    (
                        f["geometry"]["coordinates"][1],
                        f["geometry"]["coordinates"][0],
                        name_pattern(f["properties"]["name"]) if wide else None,
                    )
                    for f in batch
                ]
                elements = overpass(points, radius, client)
                for f in batch:
                    if match := best_match(f, elements, radius, min_score):
                        f["properties"]["osm"] = match
                        found += 1
                if n % 20 == 0 or n == len(batches):
                    print(f"  {n}/{len(batches)} queries, {found} matched")
                    PLACES_FILE.write_text(
                        json.dumps(collection, ensure_ascii=False, indent=2)
                    )

    matched = sum("osm" in f["properties"] for f in features)
    print(f"done: {matched}/{len(features)} places have an OSM reference")


if __name__ == "__main__":
    main()

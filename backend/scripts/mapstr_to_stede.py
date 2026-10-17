"""Write data/mapstr.json as a stede places file, to import in the app.

The places become NIP-XX Places events, ready for the app's Import button
(your key drawer); see stede.places_file for what each Mapstr field becomes.
data/mapstr.json is only read.

    cd backend
    uv run python scripts/mapstr_to_stede.py                   # -> data/stede-places.json
    uv run python scripts/mapstr_to_stede.py -o ~/places.json  # elsewhere
    uv run python scripts/mapstr_to_stede.py -i ../data/mapstr.json ../data/pindrop.json
                                                     # several exports, duplicates merged
"""

import argparse
import json
from collections import Counter
from pathlib import Path

from stede.places_file import from_exports

ROOT = Path(__file__).resolve().parents[2]
PLACES_FILE = ROOT / "data" / "mapstr.json"
OUTPUT_FILE = ROOT / "data" / "stede-places.json"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "-i",
        "--input",
        type=Path,
        nargs="+",
        default=[PLACES_FILE],
        help="exports, Mapstr-shaped (see scripts/pindrop_import.py); "
        "places in a later one that duplicate an earlier one are merged into it",
    )
    parser.add_argument(
        "-o", "--output", type=Path, default=OUTPUT_FILE, help="places file"
    )
    args = parser.parse_args()

    exports = [json.loads(path.read_text()) for path in args.input]
    converted = from_exports(exports)
    args.output.write_text(json.dumps(converted, ensure_ascii=False, indent=1))

    places = converted["places"]
    tag_names = Counter(t[0] for p in places for t in p["tags"])
    read = sum(len(e.get("features", [])) for e in exports)
    print(f"{read} places read, {len(places)} written to {args.output}")
    if read > len(places):
        print(
            f"{read - len(places)} merged into a duplicate or skipped (no name or position)"
        )
    print(
        f"{tag_names['t']} labels ({len(converted['labels'])} distinct), "
        f"{tag_names['i']} OSM links, {tag_names['location']} addresses, "
        f"{sum(1 for p in places if p['content'])} comments"
    )


if __name__ == "__main__":
    main()

"""Write data/mapstr.json as a stede places file, to import in the app.

The places become NIP-XX Places events, ready for the app's Import button
(your key drawer); see stede.places_file for what each Mapstr field becomes.
data/mapstr.json is only read.

    cd backend
    uv run python scripts/mapstr_to_stede.py                   # -> data/stede-places.json
    uv run python scripts/mapstr_to_stede.py -o ~/places.json  # elsewhere
"""

import argparse
import json
from collections import Counter
from pathlib import Path

from stede.places_file import from_mapstr

ROOT = Path(__file__).resolve().parents[2]
PLACES_FILE = ROOT / "data" / "mapstr.json"
OUTPUT_FILE = ROOT / "data" / "stede-places.json"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "-i", "--input", type=Path, default=PLACES_FILE, help="Mapstr export"
    )
    parser.add_argument(
        "-o", "--output", type=Path, default=OUTPUT_FILE, help="places file"
    )
    args = parser.parse_args()

    export = json.loads(args.input.read_text())
    converted = from_mapstr(export)
    args.output.write_text(json.dumps(converted, ensure_ascii=False, indent=1))

    places = converted["places"]
    tag_names = Counter(t[0] for p in places for t in p["tags"])
    skipped = len(export.get("features", [])) - len(places)
    print(f"{len(places)} places written to {args.output}")
    if skipped:
        print(f"{skipped} skipped (no name or position)")
    print(
        f"{tag_names['t']} labels ({len(converted['labels'])} distinct), "
        f"{tag_names['i']} OSM links, {tag_names['location']} addresses, "
        f"{sum(1 for p in places if p['content'])} comments"
    )


if __name__ == "__main__":
    main()

import base64
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import policy

ALICE = "a" * 64
BOB = "b" * 64
AUTHORS = {ALICE}


def place(**overrides) -> dict:
    tags = overrides.pop(
        "tags",
        [
            ["d", "odeon"],
            ["name", "Le Relais Saint-Germain"],
            ["geo", "geo:48.8519,2.3389"],
            ["g", "u09t"],
            ["g", "u09tvj"],
        ],
    )
    return {
        "id": "1" * 64,
        "pubkey": ALICE,
        "kind": policy.PLACE_KIND,
        "tags": tags,
    } | overrides


def test_place_from_registered_author_is_accepted() -> None:
    assert policy.check(place(), AUTHORS) is None


def test_other_kinds_are_blocked_even_from_registered_authors() -> None:
    assert policy.check(place(kind=1), AUTHORS).startswith("blocked")
    assert policy.check(place(kind=0), AUTHORS).startswith("blocked")


def test_deletions_bookmark_sets_and_relay_sets_are_accepted() -> None:
    assert policy.check(place(kind=policy.DELETION_KIND, tags=[]), AUTHORS) is None
    assert (
        policy.check(
            place(kind=policy.BOOKMARK_SET_KIND, tags=[["d", "to-try"]]), AUTHORS
        )
        is None
    )
    relays = [["d", "stede"], ["relay", "wss://relay.stede.cc/"]]
    assert (
        policy.check(place(kind=policy.RELAY_SET_KIND, tags=relays), AUTHORS) is None
    )


def test_unknown_author_is_restricted() -> None:
    assert policy.check(place(pubkey=BOB), AUTHORS).startswith("restricted")


def test_author_check_is_case_insensitive() -> None:
    assert policy.check(place(pubkey=ALICE.upper()), AUTHORS) is None


def test_missing_authors_file_closes_writes() -> None:
    assert policy.check(place(), None).startswith(
        "blocked: this relay is not accepting"
    )


def test_open_writes_skips_the_author_check_but_not_validation() -> None:
    assert policy.check(place(pubkey=BOB), None, open_writes=True) is None
    assert policy.check(
        place(pubkey=BOB, tags=[["d", "x"]]), None, open_writes=True
    ).startswith("invalid")


def test_place_needs_d_name_and_geo() -> None:
    assert "d tag" in policy.check(place(tags=[["name", "x"], ["geo", "1,2"]]), AUTHORS)
    assert "d tag" in policy.check(
        place(tags=[["d", "a"], ["d", "b"], ["name", "x"], ["geo", "1,2"]]), AUTHORS
    )
    assert "name" in policy.check(place(tags=[["d", "a"], ["geo", "1,2"]]), AUTHORS)
    assert "geo" in policy.check(place(tags=[["d", "a"], ["name", "x"]]), AUTHORS)


def test_geo_formats() -> None:
    assert policy.parse_geo("geo:48.8519,2.3389") == (48.8519, 2.3389)
    assert policy.parse_geo("48.8519,2.3389,35") == (48.8519, 2.3389)
    assert policy.parse_geo("48.8519,2.3389;crs=wgs84;u=10") == (48.8519, 2.3389)
    for bad in ["48.85", "91,0", "0,181", "a,b", "1,2;crs=moon"]:
        try:
            policy.parse_geo(bad)
        except ValueError:
            continue
        raise AssertionError(f"{bad!r} should be rejected")


def test_geohash_matches_reference_values() -> None:
    # Reference values checked against pygeohash.
    assert policy.geohash(48.8519, 2.3389, 6) == "u09tvj"
    assert policy.geohash(57.64911, 10.40744, 11) == "u4pruydqqvj"
    assert policy.geohash(-33.8688, 151.2093, 5) == "r3gx2"


def test_g_tags_must_match_the_coordinates() -> None:
    wrong = place(
        tags=[["d", "a"], ["name", "x"], ["geo", "48.8519,2.3389"], ["g", "u4pr"]]
    )
    assert "g tag" in policy.check(wrong, AUTHORS)
    too_long = place(
        tags=[["d", "a"], ["name", "x"], ["geo", "48.8519,2.3389"], ["g", "u" * 13]]
    )
    assert "g tag" in policy.check(too_long, AUTHORS)


def test_authors_file_parsing(tmp_path: Path) -> None:
    f = tmp_path / "authors.txt"
    f.write_text(f"# people\n{ALICE.upper()}  # alice\n\n{BOB}\n")
    assert policy.load_authors(f) == {ALICE, BOB}
    assert policy.load_authors(tmp_path / "missing.txt") is None


def test_script_speaks_strfry_protocol(tmp_path: Path) -> None:
    authors = tmp_path / "authors.txt"
    authors.write_text(ALICE + "\n")
    lines = [
        json.dumps(
            {"type": "new", "event": place(), "receivedAt": 0, "sourceType": "IP4"}
        ),
        json.dumps({"type": "new", "event": place(kind=1, id="2" * 64)}),
        "not json",
    ]
    result = subprocess.run(
        [sys.executable, str(Path(policy.__file__))],
        input="\n".join(lines) + "\n",
        capture_output=True,
        text=True,
        env={"STEDE_RELAY_AUTHORS": str(authors)},
        check=True,
    )
    replies = [json.loads(line) for line in result.stdout.splitlines()]
    assert replies == [
        {"id": "1" * 64, "action": "accept"},
        {"id": "2" * 64, "action": "reject", "msg": replies[1]["msg"]},
    ]
    assert replies[1]["msg"].startswith("blocked")


def private_place(**overrides) -> dict:
    payload = base64.b64encode(bytes([2]) + bytes(32 + 64 + 32)).decode()
    return {
        "id": "1" * 64,
        "pubkey": ALICE,
        "kind": policy.PRIVATE_PLACE_KIND,
        "tags": [["d", "a3f9c2e1-7b4d-4c8a-9e2f-1d6b8a0c5e7f"]],
        "content": payload,
    } | overrides


def test_private_place_is_accepted() -> None:
    assert policy.check(private_place(), AUTHORS) is None


def test_private_place_from_unknown_author_is_restricted() -> None:
    assert policy.check(private_place(pubkey=BOB), AUTHORS).startswith("restricted")


def test_private_place_must_not_show_place_tags() -> None:
    d = ["d", "a3f9c2e1-7b4d-4c8a-9e2f-1d6b8a0c5e7f"]
    for leak in (
        ["name", "Odéon"],
        ["geo", "48.85,2.33"],
        ["g", "u09t"],
        ["t", "cafe"],
    ):
        assert policy.check(private_place(tags=[d, leak]), AUTHORS).startswith(
            "invalid"
        )


def test_private_place_needs_a_single_d_tag() -> None:
    assert policy.check(private_place(tags=[]), AUTHORS).startswith("invalid")
    assert policy.check(private_place(tags=[["d", ""]]), AUTHORS).startswith("invalid")
    assert policy.check(private_place(tags=[["d", "x" * 65]]), AUTHORS).startswith(
        "invalid"
    )


def test_private_place_content_must_be_nip44() -> None:
    for content in (
        "",
        "a cosy café",
        "not base64!",
        base64.b64encode(b"\x02short").decode(),
    ):
        assert policy.check(private_place(content=content), AUTHORS).startswith(
            "invalid"
        )
    wrong_version = base64.b64encode(bytes([1]) + bytes(128)).decode()
    assert policy.check(private_place(content=wrong_version), AUTHORS).startswith(
        "invalid"
    )

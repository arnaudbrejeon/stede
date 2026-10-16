from stede.places_file import from_mapstr, geohash


def feature(name="Asador Ordoki", coords=(-1.488036, 43.179929), **props):
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": list(coords)},
        "properties": {
            "name": name,
            "address": "Baztan, Navarra, Spain",
            "tags": [],
            **props,
        },
    }


def test_converts_every_mapstr_field():
    converted = from_mapstr(
        {
            "features": [
                feature(
                    icon="restaurant",
                    userComment=" Book ahead ",
                    tags=[
                        {"name": "To try", "color": "#6edf38"},
                        {"name": "Best OC", "color": "#123456"},
                        {"name": "best oc", "color": "#123456"},
                    ],
                    stede={"category": "restaurant", "icon": "plate"},
                    osm={
                        "type": "node",
                        "id": 42,
                        "name": "x",
                        "distance_m": 3,
                        "score": 1.0,
                    },
                    osm_tried=["photon"],
                )
            ]
        },
        now=1700000000,
    )
    assert converted["format"] == "stede-places"
    assert converted["version"] == 1
    assert converted["labels"] == {
        "To try": {"color": "#6edf38"},
        "Best OC": {"color": "#123456"},
        "best oc": {"color": "#123456"},
    }
    [place] = converted["places"]
    assert place["kind"] == 31300
    assert place["created_at"] == 1700000000
    assert place["content"] == "Book ahead"
    tags = place["tags"]
    assert tags[0][0] == "d"
    assert tags[1:] == [
        ["name", "Asador Ordoki"],
        ["geo", "43.179929,-1.488036"],
        ["g", geohash(43.179929, -1.488036, 4)],
        ["g", geohash(43.179929, -1.488036, 6)],
        ["g", geohash(43.179929, -1.488036, 9)],
        ["location", "Baztan, Navarra, Spain"],
        ["t", "To try"],
        ["t", "Best OC"],
        ["i", "osm:node/42"],
        ["k", "osm"],
        ["osm:amenity", "restaurant"],
        ["L", "cc.stede.icon"],
        ["l", "plate", "cc.stede.icon"],
        ["L", "com.mapstr.icon"],
        ["l", "restaurant", "com.mapstr.icon"],
    ]


def test_same_place_same_id_and_repeats_get_their_own():
    first = from_mapstr({"features": [feature(), feature(), feature("Other")]})[
        "places"
    ]
    again = from_mapstr({"features": [feature(), feature(), feature("Other")]})[
        "places"
    ]
    ids = [p["tags"][0][1] for p in first]
    assert ids == [p["tags"][0][1] for p in again]
    assert len(set(ids)) == 3


def test_skips_places_without_name_or_position():
    converted = from_mapstr(
        {
            "features": [
                feature(""),
                feature(coords=(0, 95)),
                {"properties": {"name": "x"}},
            ]
        }
    )
    assert converted["places"] == []


def test_unknown_category_keeps_the_icon_only():
    [place] = from_mapstr(
        {"features": [feature(stede={"category": "", "icon": "lantern"})]}
    )["places"]
    assert not any(t[0].startswith("osm:") for t in place["tags"])
    assert ["l", "lantern", "cc.stede.icon"] in place["tags"]


def test_geohash_matches_the_relay():
    assert geohash(48.86004, 2.32663, 9) == "u09tuywnq"
    assert geohash(-33.8688, 151.2093, 9) == "r3gx2f77b"

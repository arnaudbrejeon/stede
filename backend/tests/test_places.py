from stede.places import category_for


def test_category_for_prefers_the_place_then_tags_then_mapstr() -> None:
    def props(name: str, icon: str, *tags: str) -> dict:
        return {"name": name, "icon": icon, "tags": [{"name": t} for t in tags]}

    # Named override beats a matching tag.
    assert (
        category_for(props("Linville Falls Visitor Center", "car", "Route")) == "museum"
    )
    # The first listed tag wins: Hôtel comes before Restaurant.
    assert category_for(props("Inn", "restaurant", "Restaurant", "Hôtel")) == "hotel"
    # Musée etc comes before Route.
    assert category_for(props("folk art", "car", "Route", "Musée etc")) == "museum"
    # Status tags don't count; Mapstr's icon decides.
    assert category_for(props("Somewhere", "lodging", "To try")) == "hotel"

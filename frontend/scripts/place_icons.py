"""Generate src/placeIcons.ts: the place icon set, drawn on a 24x24 grid.

Each icon is built from simple shapes. `fill` shapes are painted in ink, then
`holes` are painted in the pin's white to cut details (doors, text lines). Kept
as separate paths so overlapping shapes never cancel out.

Also writes src/placeIconCategories.json, the same OSM value → category →
default icon mapping, for the backend's scripts/assign_icons.py.

Run: python3 scripts/place_icons.py
"""

import json
import math
import re
from pathlib import Path


def n(v: float) -> str:
    return f"{v:.2f}".rstrip("0").rstrip(".")


def circle(cx, cy, r):
    return f"M{n(cx - r)} {n(cy)}a{n(r)} {n(r)} 0 1 0 {n(2 * r)} 0a{n(r)} {n(r)} 0 1 0 {n(-2 * r)} 0Z"


def ring(cx, cy, r_out, r_in):
    """Annulus: outer circle plus a reversed inner one, so the middle stays open."""
    return (
        circle(cx, cy, r_out)
        + f"M{n(cx - r_in)} {n(cy)}a{n(r_in)} {n(r_in)} 0 1 1 {n(2 * r_in)} 0a{n(r_in)} {n(r_in)} 0 1 1 {n(-2 * r_in)} 0Z"
    )


def ellipse(cx, cy, rx, ry, rot=0):
    a = math.radians(rot)
    dx, dy = rx * math.cos(a), rx * math.sin(a)
    x1, y1, x2, y2 = cx - dx, cy - dy, cx + dx, cy + dy
    return (
        f"M{n(x1)} {n(y1)}A{n(rx)} {n(ry)} {n(rot)} 1 0 {n(x2)} {n(y2)}"
        f"A{n(rx)} {n(ry)} {n(rot)} 1 0 {n(x1)} {n(y1)}Z"
    )


def rect(x, y, w, h, r=0):
    if not r:
        return f"M{n(x)} {n(y)}h{n(w)}v{n(h)}h{n(-w)}Z"
    r = min(r, w / 2, h / 2)
    return (
        f"M{n(x + r)} {n(y)}h{n(w - 2 * r)}a{n(r)} {n(r)} 0 0 1 {n(r)} {n(r)}"
        f"v{n(h - 2 * r)}a{n(r)} {n(r)} 0 0 1 {n(-r)} {n(r)}h{n(-(w - 2 * r))}"
        f"a{n(r)} {n(r)} 0 0 1 {n(-r)} {n(-r)}v{n(-(h - 2 * r))}a{n(r)} {n(r)} 0 0 1 {n(r)} {n(-r)}Z"
    )


def poly(*pts):
    return "M" + "L".join(f"{n(x)} {n(y)}" for x, y in pts) + "Z"


def bar(x1, y1, x2, y2, w, round_caps=False):
    """A thick line segment (optionally with round caps)."""
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy)
    px, py = -dy / length * w / 2, dx / length * w / 2
    shape = [poly((x1 + px, y1 + py), (x2 + px, y2 + py), (x2 - px, y2 - py), (x1 - px, y1 - py))]
    if round_caps:
        shape += [circle(x1, y1, w / 2), circle(x2, y2, w / 2)]
    return shape


def arch(x, y_spring, w, y_bottom):
    """Round-headed opening: a rectangle topped with a half circle."""
    return [rect(x, y_spring, w, y_bottom - y_spring), circle(x + w / 2, y_spring, w / 2)]


def lancet(x0, x1, y_spring, y_bottom):
    """Gothic pointed opening."""
    xc = (x0 + x1) / 2
    peak = y_spring - (x1 - x0) * 1.1
    return (
        f"M{n(x0)} {n(y_bottom)}V{n(y_spring)}Q{n(x0)} {n(peak + 1)} {n(xc)} {n(peak)}"
        f"Q{n(x1)} {n(peak + 1)} {n(x1)} {n(y_spring)}V{n(y_bottom)}Z"
    )


def star(cx, cy, r_out, r_in, points=5):
    pts = []
    for i in range(points * 2):
        r = r_out if i % 2 == 0 else r_in
        a = -math.pi / 2 + i * math.pi / points
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return poly(*pts)


def mirror(path: str) -> str:
    """Mirror an absolute-coordinate path (M/L/H/V/C/Q/Z) across x = 12."""
    out = []
    for cmd, args in re.findall(r"([MLHVCQZ])([^MLHVCQZ]*)", path.replace(",", " ")):
        nums = [float(v) for v in re.findall(r"-?\d*\.?\d+", args)]
        if cmd == "H":
            nums = [24 - v for v in nums]
        elif cmd != "V":
            for i in range(0, len(nums), 2):
                nums[i] = 24 - nums[i]
        out.append(cmd + " ".join(n(v) for v in nums))
    return "".join(out)


def flat(*parts):
    shapes = []
    for p in parts:
        shapes.extend(p if isinstance(p, list) else [p])
    return shapes


# --- The set -----------------------------------------------------------------

ICONS = {}


def icon(key, label, category, fill, holes=()):
    ICONS[key] = {"label": label, "category": category, "fill": flat(*fill), "holes": flat(*holes)}


# 1 Restaurant
icon(
    "plate", "Plate and spoon", "Restaurant",
    fill=[circle(9.6, 12, 7.8), ellipse(20.6, 6.8, 1.9, 3, 0), bar(20.6, 9.4, 20.6, 20.4, 1.6, True)],
    holes=[ring(9.6, 12, 5.6, 4.5)],
)
icon(
    "drumstick", "Roast leg", "Restaurant",
    fill=[
        ellipse(8.6, 8.6, 6.6, 5, 45),
        bar(11.6, 11.6, 17.6, 17.6, 2.8),
        circle(19.4, 17.2, 2), circle(17.2, 19.4, 2),
    ],
)
icon(
    "cauldron", "Cauldron", "Restaurant",
    fill=[
        # Round-bellied pot on short feet, with a hanging handle over the rim.
        "M5.4 7.4C5.4 2.4 18.6 2.4 18.6 7.4H16.8C16.8 4.4 7.2 4.4 7.2 7.4Z",
        rect(3.8, 6.4, 16.4, 2.6, 1.3),
        "M5 8.6H19C20 10 20.6 11.6 20.6 13.2 20.6 17.4 16.8 20.2 12 20.2S3.4 17.4 3.4 13.2C3.4 11.6 4 10 5 8.6Z",
        rect(6.2, 18, 2.4, 3.8, 1), rect(15.4, 18, 2.4, 3.8, 1),
    ],
)
# 2 Café & bakery
icon(
    "loaf", "Round loaf", "Café & bakery",
    fill=["M3 18C3 11 7 6.2 12 6.2S21 11 21 18Z", rect(2.4, 16.8, 19.2, 3, 1.4)],
    holes=[
        bar(6.8, 14.6, 8.8, 10.4, 1.5, True),
        bar(10.9, 14.6, 13, 9.2, 1.5, True),
        bar(15.1, 14.6, 17.1, 10.4, 1.5, True),
    ],
)
icon(
    "steaming-pot", "Steaming pot", "Café & bakery",
    fill=[
        "M4.5 11.2h12v3.4a6 5 0 0 1-12 0Z",
        circle(17.4, 13.6, 2.7),
        rect(3, 19.6, 15, 2, 1),
        bar(7.4, 9.6, 6.4, 7.2, 1.5, True), bar(6.4, 7.2, 7.4, 4.6, 1.5, True),
        bar(10.6, 9.6, 9.6, 7.2, 1.5, True), bar(9.6, 7.2, 10.6, 4.6, 1.5, True),
        bar(13.8, 9.6, 12.8, 7.2, 1.5, True), bar(12.8, 7.2, 13.8, 4.6, 1.5, True),
    ],
    holes=[circle(17.6, 13.6, 1.2)],
)
# 3 Bar & pub
icon(
    "tankard", "Lidded tankard", "Bar & pub",
    fill=[
        rect(4.5, 7, 10.5, 14.5, 1.6),
        rect(3.6, 4.4, 12.4, 3.2, 1.4),
        circle(16.2, 4.6, 1.8),
        rect(12.5, 9, 8, 9.5, 3.4),
    ],
    holes=[rect(15.1, 11.4, 3, 4.7, 1.3), rect(6.3, 10, 6.9, 1.4, 0.7), rect(6.3, 17, 6.9, 1.4, 0.7)],
)
icon(
    "goblet", "Goblet", "Bar & pub",
    fill=[
        "M5.6 3.4h12.8c0 5.4-2.7 9.4-6.4 9.4S5.6 8.8 5.6 3.4Z",
        rect(10.9, 12, 2.2, 6, 0.6),
        circle(12, 14.6, 1.9),
        "M6.8 21.4c0-2.3 2.3-3.8 5.2-3.8s5.2 1.5 5.2 3.8Z",
    ],
    holes=[bar(8.4, 5.6, 9.2, 8.8, 1.3, True)],
)
# 4 Museum & art
icon(
    "portico", "Arched portico", "Museum & art",
    fill=[poly((1.8, 8), (12, 2.8), (22.2, 8)), rect(3, 7.6, 18, 12.4), rect(1.8, 19.6, 20.4, 2.4, 0.6)],
    holes=[arch(4.6, 12.2, 3.6, 19.6), arch(10.2, 12.2, 3.6, 19.6), arch(15.8, 12.2, 3.6, 19.6)],
)
icon(
    "manuscript", "Illuminated manuscript", "Museum & art",
    fill=[
        "M11.4 6.2C9 4.8 5.7 4.3 2.2 5V19C5.7 18.3 9 18.8 11.4 20.2Z",
        mirror("M11.4 6.2C9 4.8 5.7 4.3 2.2 5V19C5.7 18.3 9 18.8 11.4 20.2Z"),
    ],
    holes=[
        rect(4, 7.4, 4.6, 4.6, 0.6),
        rect(4, 13.6, 5.6, 1.4, 0.7), rect(4, 16, 5.6, 1.4, 0.7),
        rect(14.2, 7.6, 5.8, 1.4, 0.7), rect(14.2, 10.2, 5.8, 1.4, 0.7),
        rect(14.2, 12.8, 5.8, 1.4, 0.7), rect(14.2, 15.4, 5.8, 1.4, 0.7),
    ],
)
# 5 Monument & history
icon(
    "keep", "Castle keep", "Monument & history",
    fill=[
        rect(6, 8, 12, 14),
        rect(4.8, 6, 14.4, 3, 0.4),
        rect(4.8, 2.6, 3.4, 4), rect(10.3, 2.6, 3.4, 4), rect(15.8, 2.6, 3.4, 4),
    ],
    holes=[arch(9.8, 16, 4.4, 22.2), rect(11.1, 10, 1.8, 3.6, 0.9)],
)
icon(
    "city-gate", "City gate", "Monument & history",
    fill=[
        rect(2, 6.2, 6.4, 15.8), rect(15.6, 6.2, 6.4, 15.8),
        rect(2, 3.6, 2, 3), rect(6.4, 3.6, 2, 3), rect(15.6, 3.6, 2, 3), rect(20, 3.6, 2, 3),
        rect(8, 10.2, 8, 11.8),
        rect(8.6, 8, 1.9, 2.6), rect(11.05, 8, 1.9, 2.6), rect(13.5, 8, 1.9, 2.6),
    ],
    holes=[arch(9.4, 15.4, 5.2, 22.2), rect(4.4, 10, 1.6, 3, 0.8), rect(18, 10, 1.6, 3, 0.8)],
)
# 6 Place of worship
icon(
    "bell", "Bell", "Place of worship",
    fill=[
        "M12 2.8c-1 0-1.7.8-1.7 1.7v.6C7.5 6 5.8 8.6 5.8 11.8v3.6L3.6 18.8h16.8l-2.2-3.4v-3.6c0-3.2-1.7-5.8-4.5-6.7v-.6c0-.9-.7-1.7-1.7-1.7Z",
        circle(12, 20.6, 2),
    ],
)
icon(
    "gothic-window", "Arched window", "Place of worship",
    fill=["M4.6 21.6V11C4.6 6.4 7.7 3.4 12 2.2c4.3 1.2 7.4 4.2 7.4 8.8v10.6Z"],
    holes=[lancet(6.9, 10.5, 13, 19.6), lancet(13.5, 17.1, 13, 19.6), circle(12, 7.6, 1.6)],
)
# 7 Lodging
icon(
    "inn-sign", "Inn sign", "Lodging",
    fill=[
        rect(2.6, 2.6, 2.4, 19.6, 0.6),
        rect(2.6, 3.4, 18, 2.2, 0.6),
        bar(4.6, 10.6, 10.2, 5, 1.8),
        rect(8.2, 5.2, 1.3, 3.6), rect(17.1, 5.2, 1.3, 3.6),
        rect(6.8, 8.4, 13, 9.6, 1.2),
    ],
    holes=[star(13.3, 13.3, 3.2, 1.35)],
)
# 8 Shop & market
icon(
    "market-stall", "Market stall", "Shop & market",
    fill=[
        poly((1.8, 6.6), (12, 2.4), (22.2, 6.6)),
        rect(1.8, 6.4, 20.4, 2.8),
        *[circle(3.5 + i * 3.4, 9.2, 1.7) for i in range(6)],
        rect(3.4, 9, 2, 13), rect(18.6, 9, 2, 13),
        rect(2.4, 15.6, 19.2, 2.6, 0.6),
        circle(8.4, 14.2, 1.6), circle(12, 14.2, 1.6), circle(15.6, 14.2, 1.6),
    ],
)
icon(
    "coin-purse", "Coin purse", "Shop & market",
    fill=[
        "M12 8.2c-4.6 0-7.7 4.2-7.7 8.4 0 3.1 2.6 4.9 7.7 4.9s7.7-1.8 7.7-4.9c0-4.2-3.1-8.4-7.7-8.4Z",
        rect(8.6, 6.4, 6.8, 2.4, 1.2),
        "M8.8 6.6 7.2 3 10.2 4.2 12 2.4 13.8 4.2 16.8 3 15.2 6.6Z",
    ],
    holes=[circle(12, 15.6, 2.3)],
)
# 9 Park & nature
icon(
    "oak", "Oak tree", "Park & nature",
    fill=[
        circle(12, 7.6, 5.2), circle(7, 10, 4.3), circle(17, 10, 4.3),
        circle(9.2, 13.4, 4), circle(14.8, 13.4, 4),
        "M10.5 14.6h3v4.7c0 .9.9 1.6 2.9 2.2H7.6c2-.6 2.9-1.3 2.9-2.2Z",
    ],
)
_petal = "M9.6 15.4C6.6 15.8 3.2 14 3.2 10.6 3.2 8.6 4.8 7.4 6.4 7.4 7.6 7.4 8.6 8.2 8.6 9.4 8.6 10.4 7.9 11 7.1 11 7.4 13 9.2 14.1 10.8 14.3Z"
icon(
    "fleur-de-lis", "Fleur-de-lis", "Park & nature",
    fill=[
        "M12 2.2C9.8 4.8 9 7.6 9.2 10.2 9.4 12.4 10.5 14 12 15.6 13.5 14 14.6 12.4 14.8 10.2 15 7.6 14.2 4.8 12 2.2Z",
        _petal, mirror(_petal),
        rect(6.6, 14.6, 10.8, 2.4, 1.2),
        "M10.4 17H13.6L15.2 21.8H8.8Z",
    ],
)
# 10 Sport & leisure
icon(
    "shield", "Heater shield", "Sport & leisure",
    fill=["M3.8 3h16.4v7.6c0 5.6-3.6 9.2-8.2 11-4.6-1.8-8.2-5.4-8.2-11Z"],
    holes=[bar(12, 7.4, 5.4, 13.6, 2), bar(12, 7.4, 18.6, 13.6, 2), circle(12, 7.4, 1)],
)
icon(
    "crossed-lances", "Crossed lances", "Sport & leisure",
    fill=[
        # Shafts along x + y = 24.8 and its mirror, with each tip and guard on its shaft.
        bar(4.2, 20.6, 18, 6.8, 1.8), poly((18.54, 8.94), (21.02, 3.78), (15.86, 6.26)),
        circle(7.4, 17.4, 2.4),
        bar(19.8, 20.6, 6, 6.8, 1.8), poly((8.14, 6.26), (2.98, 3.78), (5.46, 8.94)),
        circle(16.6, 17.4, 2.4),
    ],
)
# 11 Music & shows
icon(
    "lute", "Lute", "Music & shows",
    fill=[
        ellipse(9, 15, 6.6, 5.4, -45),
        bar(12.6, 11.4, 18.4, 5.6, 2.4),
        bar(18.4, 5.6, 21.4, 7.2, 2.4, True),
    ],
    holes=[circle(8.6, 15.4, 1.9), bar(5.6, 18.6, 7, 17.2, 1.4)],
)
icon(
    "jester-cap", "Jester's cap", "Music & shows",
    fill=[
        # Floppy points that droop sideways (upright points read as a crown).
        "M5.6 17.2C5.2 14.6 4.6 12.8 2.8 12 4.4 9.4 7.8 9.8 9.6 12.6 9.6 8.6 11.6 5 16 4 14 6.2 13.8 9.4 14.4 12.6 16.2 9.8 19.6 9.4 21.2 12 19.4 12.8 18.8 14.6 18.4 17.2Z",
        rect(4.8, 16.6, 14.4, 4, 1.6),
        circle(2.6, 13.4, 1.8), circle(17, 4.2, 1.8), circle(21.4, 13.4, 1.8),
    ],
    holes=[rect(7, 18, 2.2, 1.4, 0.7), rect(10.9, 18, 2.2, 1.4, 0.7), rect(14.8, 18, 2.2, 1.4, 0.7)],
)
# 12 Travel & roads
icon(
    "carriage", "Covered wagon", "Travel & roads",
    fill=[
        # Canvas hood over the bed, then two spoked wheels.
        "M3.4 13.4V9.6C3.4 5.8 7.2 3.2 12 3.2S20.6 5.8 20.6 9.6V13.4Z",
        rect(1.8, 12.8, 20.4, 2.6, 0.6),
        circle(6.6, 18.4, 3.6), circle(17.4, 18.4, 3.6),
    ],
    holes=[
        # Hoops showing through the canvas.
        rect(7.4, 6, 1.4, 6.8, 0.7), rect(11.3, 4.6, 1.4, 8.2, 0.7), rect(15.2, 6, 1.4, 6.8, 0.7),
        ring(6.6, 18.4, 2.3, 1.1), ring(17.4, 18.4, 2.3, 1.1),
    ],
)
icon(
    "horse", "Horse's head", "Travel & roads",
    fill=[
        # Head and arched neck facing left: pricked ears, a long face down to a
        # rounded muzzle, the round jowl, then the throat down to the chest. The
        # mane is a ridge of tufts along the back of the neck.
        "M8.8 22.4C9.6 19.6 10.8 17.6 12 16 10.6 16.6 9 16.8 7.6 16.4L5 16.9C3.8 17.1 2.8 16.4 2.8 15.2 2.8 14.4 3.2 13.8 3.8 13.3L10.2 6 10.4 1.8 12.6 4.4 13.6 2 14.8 4.8C18.6 5.6 21.4 9.4 21.4 14.4V22.4Z",
        circle(16.2, 5.8, 1.5), circle(18.8, 8, 1.5), circle(20.4, 11, 1.5),
    ],
    holes=[
        circle(11.2, 8.6, 1),
        circle(4.6, 14.6, 0.7),
        # The line of the jaw, so the head reads apart from the neck.
        bar(12.2, 15.4, 13.6, 11.4, 1.2, True),
    ],
)
icon(
    "signpost", "Wayside signpost", "Travel & roads",
    fill=[
        rect(10.8, 2.6, 2.4, 18, 0.6),
        poly((12, 4.2), (19.4, 4.2), (21.8, 6.5), (19.4, 8.8), (12, 8.8)),
        poly((12, 10.6), (4.6, 10.6), (2.2, 12.9), (4.6, 15.2), (12, 15.2)),
        "M5.8 21.8C6.8 20 9.2 19.2 12 19.2S17.2 20 18.2 21.8Z",
    ],
)
# 13 Home & other
icon(
    "cottage", "Thatched cottage", "Home & other",
    fill=[
        rect(5.4, 11.4, 13.2, 10.2),
        rect(15.4, 3.4, 2.4, 5.6),
        "M1.6 13.2 12 3 22.4 13.2 20.2 14.2 12 6.6 3.8 14.2Z",
        "M12 6.6 20.2 14.2H3.8Z",
    ],
    holes=[arch(10, 16.2, 4, 21.6), rect(14.8, 14.8, 2.4, 2.4, 0.4), rect(6.8, 14.8, 2.4, 2.4, 0.4)],
)
icon(
    "lantern", "Lantern", "Home & other",
    fill=[
        circle(12, 3.6, 2.1),
        poly((6.6, 8.4), (12, 4.6), (17.4, 8.4)),
        rect(7, 8, 10, 11.4, 1),
        rect(6.2, 19, 11.6, 2.4, 1.2),
    ],
    holes=[circle(12, 3.6, 0.9), arch(8.6, 11.2, 2.9, 17.4), arch(12.5, 11.2, 2.9, 17.4)],
)

# 14 Water & beach
icon(
    "cog-ship", "Cog ship", "Water & beach",
    fill=[
        # Square sail on a mast with a pennant, over a round hull with raised
        # castles at bow and stern.
        rect(11.3, 1.6, 1.4, 12), poly((12.6, 1.6), (16.4, 2.6), (12.6, 3.6)),
        "M7.4 4H16.6Q17.6 7.6 16.6 11.2H7.4Q6.4 7.6 7.4 4Z",
        rect(2, 10.6, 4.4, 3, 0.4), rect(17.6, 10.6, 4.4, 3, 0.4),
        "M1.6 13.2H22.4L19.8 19.4Q12 21.4 4.2 19.4Z",
    ],
    holes=[rect(11.3, 5.2, 1.4, 4.8), rect(9.2, 6.9, 5.6, 1.4)],
)
# 15 Mountains & hiking
icon(
    "peaks", "Mountain peaks", "Mountains & hiking",
    fill=[poly((1.4, 21.4), (9.6, 3.2), (17.8, 21.4)), poly((10.6, 21.4), (16.6, 9.6), (22.6, 21.4))],
    holes=[
        # A jagged snow line under the summit, and a gap where the near peak
        # stands in front of the far one.
        bar(6.2, 11.4, 8.2, 13.8, 1.7, True), bar(8.2, 13.8, 9.8, 11.6, 1.7, True),
        bar(9.8, 11.6, 11.2, 13.8, 1.7, True), bar(11.2, 13.8, 13, 11.4, 1.7, True),
        bar(16.6, 9.6, 10.6, 21.4, 1.4),
    ],
)
icon(
    "campfire", "Campfire", "Mountains & hiking",
    fill=[
        "M12 2.4C9 6 6.8 8.6 6.8 12 6.8 14.6 9 16.2 12 16.2S17.2 14.6 17.2 12C17.2 9.8 16 8 14.8 6.8 14.8 8.6 14 9.8 12.8 10.2 13.6 7.6 13.2 4.8 12 2.4Z",
        bar(4.4, 21, 19.6, 17.6, 2.4, True), bar(4.4, 17.6, 19.6, 21, 2.4, True),
    ],
    holes=["M12 9.8C10.6 11.6 9.8 12.6 9.8 13.6 9.8 14.6 10.8 15.2 12 15.2S14.2 14.6 14.2 13.6C14.2 12.6 13.4 11.6 12 9.8Z"],
)
# 16 Towns & cities
icon(
    "walled-town", "Walled town", "Towns & cities",
    fill=[
        # Skyline (tower, church spire, house) behind a town wall with a gate.
        rect(3.4, 8, 4.6, 6), poly((2.8, 8.4), (5.7, 4.4), (8.6, 8.4)),
        rect(10.2, 6.8, 3.6, 7.2), poly((9.8, 7.2), (12, 1.4), (14.2, 7.2)),
        rect(15.8, 9.2, 5, 5), poly((15.2, 9.6), (18.3, 6.4), (21.4, 9.6)),
        rect(1.6, 13.4, 20.8, 8.4, 0.4),
    ],
    holes=[rect(1.6, 13, 20.8, 1.3), arch(9.6, 17.6, 4.8, 21.8)],
)
# 17 Books & learning
icon(
    "tome", "Clasped tome", "Books & learning",
    fill=[
        # Cover with the page block showing along the bottom, and a clasp.
        "M6.6 2.4H19.6V17.2H6.8A1.7 1.7 0 0 0 6.8 20.6H19.6V21.8H6.6A2.6 2.6 0 0 1 4 19.2V5A2.6 2.6 0 0 1 6.6 2.4Z",
        rect(17, 7.4, 4.6, 4.2, 1),
    ],
    holes=[poly((12.2, 5.2), (14.8, 9.8), (12.2, 14.4), (9.6, 9.8)), circle(19.4, 9.5, 0.9)],
)
# 18 Health
icon(
    "apothecary-jar", "Apothecary jar", "Health",
    fill=[
        circle(12, 2.8, 1.5),
        rect(6.6, 3.6, 10.8, 2.6, 1.2),
        rect(8.2, 6, 7.6, 2),
        "M6 7.8H18C17 11 17 15 18 18.6 18 20.6 16.6 21.6 14.6 21.6H9.4C7.4 21.6 6 20.6 6 18.6 7 15 7 11 6 7.8Z",
    ],
    holes=[rect(7.8, 11.2, 8.4, 4.8, 0.8)],
)
# 19 Civic
icon(
    "scales", "Scales of justice", "Civic",
    fill=[
        circle(12, 3.8, 1.8), rect(11.1, 4, 1.8, 15.6),
        rect(6.6, 19.2, 10.8, 2.6, 1.2),
        bar(3.4, 6.4, 20.6, 6.4, 1.8, True),
        bar(5.2, 6.8, 2.2, 13.6, 1.2), bar(5.2, 6.8, 8.2, 13.6, 1.2),
        bar(18.8, 6.8, 15.8, 13.6, 1.2), bar(18.8, 6.8, 21.8, 13.6, 1.2),
        "M1.4 13.2H9a3.8 3.8 0 0 1-7.6 0Z", "M15 13.2H22.6a3.8 3.8 0 0 1-7.6 0Z",
    ],
)
# 7 Lodging, continued
icon(
    "pavilion", "Pavilion tent", "Lodging",
    fill=[
        # A striped tournament tent with a pennant.
        rect(11.3, 1.4, 1.4, 4), poly((12.6, 1.4), (16.4, 2.4), (12.6, 3.4)),
        poly((2.4, 11.6), (12, 4.6), (21.6, 11.6)),
        *[circle(4 + i * 3.2, 11.6, 1.6) for i in range(6)],
        rect(4, 11.6, 16, 10),
    ],
    holes=[poly((12, 13.6), (15.2, 21.6), (8.8, 21.6)), rect(5.8, 14.4, 1.4, 7.2), rect(16.8, 14.4, 1.4, 7.2)],
)


# Categories, in display order. The first icon is the default; the others are
# alternatives a user can pick for a place.
CATEGORIES = [
    ("restaurant", "Restaurant", ["plate", "drumstick", "cauldron"]),
    ("cafe", "Café & bakery", ["steaming-pot", "loaf"]),
    ("bar", "Bar & pub", ["goblet", "tankard"]),
    ("museum", "Museum & art", ["portico", "manuscript"]),
    ("monument", "Monument & history", ["keep", "city-gate"]),
    ("worship", "Place of worship", ["gothic-window", "bell"]),
    ("lodging", "Lodging", ["inn-sign", "pavilion"]),
    ("shop", "Shop & market", ["market-stall", "coin-purse"]),
    ("park", "Park & nature", ["oak", "fleur-de-lis"]),
    ("sport", "Sport & leisure", ["shield", "crossed-lances"]),
    ("music", "Music & shows", ["lute", "jester-cap"]),
    ("travel", "Travel & roads", ["carriage", "horse", "signpost"]),
    ("water", "Water & beach", ["cog-ship"]),
    ("mountain", "Mountains & hiking", ["peaks", "campfire"]),
    ("town", "Towns & cities", ["walled-town"]),
    ("learning", "Books & learning", ["tome"]),
    ("health", "Health", ["apothecary-jar"]),
    ("civic", "Civic", ["scales"]),
    ("other", "Home & other", ["lantern", "cottage"]),
]

# Which category an OpenStreetMap-style value belongs to. Values are matched
# first (a "restaurant" is food whatever its key), then whole keys (any shop);
# anything else is "other".
OSM_VALUES = {
    "restaurant": ["restaurant", "fast_food", "food_court"],
    "cafe": ["cafe", "bakery", "pastry", "ice_cream", "confectionery", "tea", "coffee"],
    "bar": ["bar", "pub", "biergarten", "wine", "alcohol"],
    "museum": ["museum", "gallery", "artwork", "arts_centre"],
    "monument": ["attraction", "monument", "memorial", "castle", "ruins", "archaeological_site", "tower"],
    "worship": ["place_of_worship", "church", "cathedral", "chapel", "monastery"],
    "lodging": ["hotel", "guest_house", "hostel", "motel", "camp_site", "chalet", "apartment"],
    "shop": [
        "marketplace", "mall", "supermarket", "deli", "clothes", "gift", "jewelry", "electronics",
        "garden_centre", "farm",
    ],
    "park": ["park", "garden", "nature_reserve", "wood", "forest", "viewpoint", "zoo"],
    "sport": [
        "sports_centre", "pitch", "stadium", "fitness_centre", "swimming_pool", "golf_course", "horse_riding",
        "theme_park",
    ],
    "music": ["theatre", "cinema", "nightclub", "music_venue", "concert_hall"],
    "travel": [
        "road", "car_rental", "driving_school", "parking", "rest_area", "services", "fuel", "charging_station",
        "station", "bus_station", "aerodrome",
    ],
    "water": ["beach", "marina", "harbour", "ferry_terminal", "bay", "coastline"],
    "mountain": ["peak", "volcano", "mountain_pass", "saddle", "ridge", "cliff", "trailhead"],
    "town": ["city", "town", "village", "hamlet", "suburb", "neighbourhood", "quarter"],
    "learning": ["library", "school", "university", "college", "kindergarten"],
    "health": ["pharmacy", "hospital", "clinic", "doctors", "dentist", "chemist"],
    "civic": ["townhall", "courthouse", "embassy", "post_office", "police"],
}
OSM_KEYS = {"shop": "shop", "historic": "monument", "natural": "park", "sport": "sport"}
assert {i for _, _, icons in CATEGORIES for i in icons} == set(ICONS), "every icon in one category"
CATEGORY_KEYS = {key for key, _, _ in CATEGORIES}
assert set(OSM_VALUES) | set(OSM_KEYS.values()) <= CATEGORY_KEYS, "OSM values map to known categories"
VALUE_CATEGORIES = {}
for category, values in OSM_VALUES.items():
    for value in values:
        assert value not in VALUE_CATEGORIES, f"{value} is in two categories"
        VALUE_CATEGORIES[value] = category


# --- Output ------------------------------------------------------------------

def ts_string_list(items):
    return "[" + ", ".join(f"'{p}'" for p in items) + "]"


lines = [
    "// Generated by scripts/place_icons.py; edit that file, not this one.",
    "// Silhouettes on a 24x24 grid: paint `fill` in ink, then `holes` in the pin's white.",
    "",
    "export type PlaceIcon = { label: string; category: string; fill: string[]; holes: string[] }",
    "",
    "export const PLACE_ICONS = {",
]
for key, ic in ICONS.items():
    ic["category"] = next(label for _, label, icons in CATEGORIES if key in icons)
    lines += [
        f"  '{key}': {{",
        f"    label: {ic['label']!r},",
        f"    category: {ic['category']!r},",
        f"    fill: {ts_string_list(ic['fill'])},",
        f"    holes: {ts_string_list(ic['holes'])},",
        "  },",
    ]
lines += ["} satisfies Record<string, PlaceIcon>", "", "export type PlaceIconKey = keyof typeof PLACE_ICONS", ""]
lines += [
    "// Display order; the first icon of each category is its default.",
    "export const ICON_CATEGORIES = [",
    *[
        f"  {{ key: '{key}', label: {label!r}, icons: [{', '.join(repr(i) for i in icons)}] }},"
        for key, label, icons in CATEGORIES
    ],
    "] as const satisfies readonly { key: string; label: string; icons: readonly PlaceIconKey[] }[]",
    "",
    "export type IconCategoryKey = (typeof ICON_CATEGORIES)[number]['key']",
    "",
    "// OSM-style value (restaurant, museum…) → its category. Anything unlisted is 'other'.",
    "export const OSM_VALUE_CATEGORIES: Record<string, IconCategoryKey> = {",
    *[f"  {value}: '{category}'," for value, category in VALUE_CATEGORIES.items()],
    "}",
    "",
    "// OSM key → category, for values not listed above (any shop=* is a shop).",
    "export const OSM_KEY_CATEGORIES: Record<string, IconCategoryKey> = {",
    *[f"  {key}: '{category}'," for key, category in OSM_KEYS.items()],
    "}",
    "",
]
out = Path(__file__).resolve().parent.parent / "src" / "placeIcons.ts"
out.write_text("\n".join(lines))
print(f"{len(ICONS)} icons -> {out}")

# The same choice for the backend, which records each saved place's icon.
mapping = {
    "values": VALUE_CATEGORIES,
    "keys": OSM_KEYS,
    "defaults": {key: icons[0] for key, _, icons in CATEGORIES},
}
json_out = out.with_name("placeIconCategories.json")
json_out.write_text(json.dumps(mapping, indent=2) + "\n")
print(f"category mapping -> {json_out}")

# SPDX-License-Identifier: GPL-2.0-or-later
"""Placeholder toolbar/store icons: a ring with a gap. Replaced by brand art later.
Run: python3 scripts/make-icons.py  (needs Pillow). Writes static/icons/icon-<n>.png."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "static" / "icons"
OUT.mkdir(parents=True, exist_ok=True)
for size in (16, 32, 48, 128):
    scale = 8
    big = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    pad, width = size * scale * 0.12, max(2, int(size * scale * 0.14))
    d.arc((pad, pad, size * scale - pad, size * scale - pad), start=-60, end=240, fill=(59, 130, 246, 255), width=width)
    big.resize((size, size), Image.LANCZOS).save(OUT / f"icon-{size}.png", optimize=True)
    print(f"wrote icon-{size}.png")

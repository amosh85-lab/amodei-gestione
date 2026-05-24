"""Generate PWA icons + iOS splash screens from the Amodei logo.

Reads:  /Users/amoshalfon/Desktop/logo_wine_bar_v3.png  (square, terracotta bg)

Writes:
  frontend/public/icons/icon-{72,96,128,144,152,192,384,512}.png
  frontend/public/icons/icon-512-maskable.png   (with 10% safe padding ring)
  frontend/public/splash/apple-splash-{w}x{h}.png  (8 sizes for iOS)

Usage:
    cd backend  # any cwd that has Pillow installed
    .venv/bin/python ../tools/generate_pwa_icons.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

# --- inputs -----------------------------------------------------------

LOGO_PATH = Path("/Users/amoshalfon/Desktop/logo_wine_bar_v3.png")
ROOT = Path(__file__).resolve().parents[1]
ICONS_DIR = ROOT / "frontend" / "public" / "icons"
SPLASH_DIR = ROOT / "frontend" / "public" / "splash"

# Theme colors (matching manifest.json)
BG_TERRACOTTA = (181, 57, 31)    # #B5391F  (also the logo background)
BG_CREAM = (251, 246, 236)        # #FBF6EC  (splash background)

# Standard PWA icon sizes
ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512]

# iOS splash sizes (portrait). Format: (width, height, device_label)
# Covers iPhone SE through iPad Pro.
SPLASH_SIZES = [
    (640,  1136, "iPhone 5/SE"),
    (750,  1334, "iPhone 6/7/8"),
    (828,  1792, "iPhone XR/11"),
    (1125, 2436, "iPhone X/XS/11Pro"),
    (1170, 2532, "iPhone 12/13/14"),
    (1284, 2778, "iPhone Pro Max"),
    (1536, 2048, "iPad"),
    (2048, 2732, "iPad Pro 12.9"),
]


def main() -> int:
    if not LOGO_PATH.exists():
        print(f"ERRORE: logo non trovato a {LOGO_PATH}")
        return 1

    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    SPLASH_DIR.mkdir(parents=True, exist_ok=True)

    logo = Image.open(LOGO_PATH).convert("RGBA")
    print(f"Logo: {logo.size[0]}×{logo.size[1]} mode={logo.mode}")

    # --- standard icons (any-purpose) -------------------------------
    for size in ICON_SIZES:
        resized = logo.resize((size, size), Image.LANCZOS)
        out = ICONS_DIR / f"icon-{size}.png"
        resized.save(out, format="PNG", optimize=True)
        print(f"  ✓ {out.relative_to(ROOT)} ({size}×{size})")

    # --- maskable icon: same logo with 10% safe padding ring ---------
    # Android adaptive icons crop down to a circle/squircle. The 10% margin
    # ensures the wordmark survives the crop.
    canvas = Image.new("RGBA", (512, 512), BG_TERRACOTTA + (255,))
    inner = logo.resize((410, 410), Image.LANCZOS)
    canvas.paste(inner, ((512 - 410) // 2, (512 - 410) // 2), inner)
    out = ICONS_DIR / "icon-512-maskable.png"
    canvas.save(out, format="PNG", optimize=True)
    print(f"  ✓ {out.relative_to(ROOT)} (maskable, 10% safe area)")

    # --- iOS splash screens -----------------------------------------
    # Logo centered on cream background. Logo width = 40% of the shorter side.
    for w, h, label in SPLASH_SIZES:
        canvas = Image.new("RGBA", (w, h), BG_CREAM + (255,))
        logo_size = int(min(w, h) * 0.4)
        scaled = logo.resize((logo_size, logo_size), Image.LANCZOS)
        canvas.paste(scaled, ((w - logo_size) // 2, (h - logo_size) // 2), scaled)
        # Splash is JPEG-safe on iOS, but PNG keeps the logo's alpha clean.
        out = SPLASH_DIR / f"apple-splash-{w}x{h}.png"
        canvas.convert("RGB").save(out, format="PNG", optimize=True)
        print(f"  ✓ {out.relative_to(ROOT)} ({w}×{h}, {label})")

    print("\nDone. Aggiorna manifest.json e index.html per linkare le nuove icone/splash.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

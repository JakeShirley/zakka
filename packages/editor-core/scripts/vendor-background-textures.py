"""Vendor CC0 seamless background textures from ambientCG.

Downloads each material's colour map, resizes it to a seamless JPEG tile plus a
small thumbnail under vendor/backgrounds/, and regenerates
src/background-textures.ts with the catalog metadata the renderer and API use.

Usage: py scripts/vendor-background-textures.py [--force]
"""

import argparse
import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

from PIL import Image, ImageStat

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
VENDOR_ROOT = PACKAGE_ROOT / "vendor" / "backgrounds"
TEXTURE_ROOT = VENDOR_ROOT / "textures"
CATALOG_PATH = PACKAGE_ROOT / "src" / "background-textures.ts"
USER_AGENT = "zakka-background-vendor/1.0"

TILE_SIZE = 1536
THUMBNAIL_SIZE = 320
JPEG_QUALITY = 80
# How much the paper's grain is exaggerated after tinting, so it stays visible on coloured stock.
TINT_GRAIN = 1.6

# (slug, ambientCG asset id, display name, category, optional tint colour)
TEXTURES = [
    ("white-paper", "Paper001", "White paper", "paper", None),
    ("creased-paper", "Paper003", "Creased paper", "paper", None),
    ("parchment", "Paper006", "Parchment", "paper", None),
    ("kraft-paper", "Paper004", "Kraft paper", "paper", None),
    ("chipboard", "Paper002", "Chipboard", "paper", None),
    ("packing-paper", "Paper005", "Packing paper", "paper", None),
    ("cardboard", "Cardboard002", "Cardboard", "paper", None),
    ("blush-cardstock", "Paper001", "Blush cardstock", "paper", "#f3cfd4"),
    ("peach-cardstock", "Paper001", "Peach cardstock", "paper", "#f6cfb2"),
    ("butter-cardstock", "Paper001", "Butter cardstock", "paper", "#f5e3a1"),
    ("mint-cardstock", "Paper001", "Mint cardstock", "paper", "#cbe8d6"),
    ("sage-cardstock", "Paper001", "Sage cardstock", "paper", "#bccdb0"),
    ("sky-cardstock", "Paper001", "Sky cardstock", "paper", "#c8ddf0"),
    ("lavender-cardstock", "Paper001", "Lavender cardstock", "paper", "#d9cfee"),
    ("cranberry-cardstock", "Paper001", "Cranberry cardstock", "paper", "#9e3341"),
    ("navy-cardstock", "Paper001", "Navy cardstock", "paper", "#2b3a5e"),
    ("black-cardstock", "Paper001", "Black cardstock", "paper", "#2b2a2c"),
    ("light-oak", "Wood049", "Light oak", "wood", None),
    ("birch", "Wood095", "Birch", "wood", None),
    ("espresso-wood", "Wood051", "Espresso wood", "wood", None),
    ("floor-planks", "Planks037A", "Floor planks", "wood", None),
    ("red-plaid", "Fabric080", "Red plaid", "fabric", None),
    ("gray-gingham", "Fabric083", "Gray check", "fabric", None),
    ("white-knit", "Fabric019", "White knit", "fabric", None),
    ("denim", "Fabric077", "Denim", "fabric", None),
    ("green-knit", "Fabric018", "Green knit", "fabric", None),
    ("tan-leather", "Leather023", "Tan leather", "fabric", None),
    ("brown-leather", "Leather014", "Brown leather", "fabric", None),
]

_color_maps: dict[str, Image.Image] = {}


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=180) as response:
        return response.read()


def download_color_map(asset_id: str) -> Image.Image:
    if asset_id in _color_maps:
        return _color_maps[asset_id]
    archive = zipfile.ZipFile(io.BytesIO(fetch(f"https://ambientcg.com/get?file={asset_id}_2K-JPG.zip")))
    color_names = [name for name in archive.namelist() if name.lower().endswith("_color.jpg")]
    if not color_names:
        raise RuntimeError(f"{asset_id} has no colour map: {archive.namelist()}")
    _color_maps[asset_id] = Image.open(io.BytesIO(archive.read(color_names[0]))).convert("RGB")
    return _color_maps[asset_id]


def tint(image: Image.Image, color: str) -> Image.Image:
    """Recolour a light paper to `color`, keeping its grain as relative brightness."""
    luminance = image.convert("L")
    mean = ImageStat.Stat(luminance).mean[0]
    target = [int(color[index : index + 2], 16) for index in (1, 3, 5)]
    channels = [
        luminance.point(
            lambda value, channel=channel: max(0, min(255, round(channel * (1 + (value / mean - 1) * TINT_GRAIN))))
        )
        for channel in target
    ]
    return Image.merge("RGB", channels)


def average_color(image: Image.Image) -> str:
    red, green, blue = (round(channel) for channel in ImageStat.Stat(image).mean)
    return f"#{red:02x}{green:02x}{blue:02x}"


def vendor_texture(slug: str, asset_id: str, tint_color: str | None, force: bool) -> str:
    tile_path = TEXTURE_ROOT / f"{slug}.jpg"
    thumbnail_path = TEXTURE_ROOT / f"{slug}.thumb.jpg"

    if force or not tile_path.exists() or not thumbnail_path.exists():
        print(f"Downloading {asset_id} -> {slug}", flush=True)
        image = download_color_map(asset_id)
        if tint_color:
            image = tint(image, tint_color)
        image.resize((TILE_SIZE, TILE_SIZE), Image.Resampling.LANCZOS).save(
            tile_path, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True
        )
        image.resize((THUMBNAIL_SIZE, THUMBNAIL_SIZE), Image.Resampling.LANCZOS).save(
            thumbnail_path, "JPEG", quality=JPEG_QUALITY, optimize=True
        )

    with Image.open(thumbnail_path) as thumbnail:
        return average_color(thumbnail.convert("RGB"))


def write_catalog(entries: list[dict]) -> None:
    lines = [
        "// Generated by scripts/vendor-background-textures.py. Do not edit by hand.",
        "",
        "export type BackgroundTextureSource = {",
        "  assetId: string;",
        "  author: string;",
        "  license: \"CC0-1.0\";",
        "  url: string;",
        "};",
        "",
        "export type BackgroundTextureEntry = {",
        "  slug: string;",
        "  name: string;",
        "  category: \"paper\" | \"wood\" | \"fabric\";",
        "  /** File name under the package's `backgrounds/` export. */",
        "  file: string;",
        "  thumbnailFile: string;",
        "  /** Pixel size of the seamless tile. */",
        "  tileSize: number;",
        "  averageColor: string;",
        "  source: BackgroundTextureSource;",
        "};",
        "",
        "export const backgroundTextures: readonly BackgroundTextureEntry[] = [",
    ]
    for entry in entries:
        lines.append(f"  {json.dumps(entry, separators=(', ', ': '))},")
    lines.append("];")
    lines.append("")
    CATALOG_PATH.write_text("\n".join(lines), encoding="utf-8", newline="\n")


def write_license(entries: list[dict]) -> None:
    sources = "\n".join(
        f"- {entry['file']}: {entry['source']['assetId']} ({entry['source']['url']})" for entry in entries
    )
    (VENDOR_ROOT / "LICENSE.md").write_text(
        "# Background textures\n\n"
        "These seamless textures are colour maps from ambientCG (https://ambientcg.com),\n"
        "released under the Creative Commons CC0 1.0 Universal Public Domain Dedication\n"
        "(https://creativecommons.org/publicdomain/zero/1.0/). They were resized, and the\n"
        "cardstock colours tinted from Paper001, by scripts/vendor-background-textures.py.\n\n"
        f"{sources}\n",
        encoding="utf-8",
        newline="\n",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--force", action="store_true", help="re-download every texture")
    args = parser.parse_args()

    TEXTURE_ROOT.mkdir(parents=True, exist_ok=True)
    entries = []
    for slug, asset_id, name, category, tint_color in TEXTURES:
        entries.append(
            {
                "slug": slug,
                "name": name,
                "category": category,
                "file": f"textures/{slug}.jpg",
                "thumbnailFile": f"textures/{slug}.thumb.jpg",
                "tileSize": TILE_SIZE,
                "averageColor": vendor_texture(slug, asset_id, tint_color, args.force),
                "source": {
                    "assetId": asset_id,
                    "author": "ambientCG",
                    "license": "CC0-1.0",
                    "url": f"https://ambientcg.com/view?id={asset_id}",
                },
            }
        )

    known_files = {f"{slug}.jpg" for slug, *_ in TEXTURES} | {f"{slug}.thumb.jpg" for slug, *_ in TEXTURES}
    for stale in TEXTURE_ROOT.glob("*.jpg"):
        if stale.name not in known_files:
            stale.unlink()

    write_catalog(entries)
    write_license(entries)
    print(f"Vendored {len(entries)} background textures.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

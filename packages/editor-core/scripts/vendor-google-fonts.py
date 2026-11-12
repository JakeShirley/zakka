"""Download, Latin-subset, and WOFF-compress the fonts referenced by src/google-fonts.ts.

Each entry's googleFamily, googleWeight, and googleStyle select a static TTF from the
Google Fonts CSS2 API. Files are subset to the Google Fonts "latin" range and saved as
WOFF (which opentype.js and browsers both read) so the inlined base64 bundle stays
small. Existing files are skipped unless --force is set.

Usage (requires fonttools):
    python3 -m pip install fonttools
    python3 packages/editor-core/scripts/vendor-google-fonts.py [--force]
"""

import argparse
import re
import sys
import urllib.parse
import urllib.request
from io import BytesIO
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
GOOGLE_FONTS_SOURCE = PACKAGE_ROOT / "src" / "google-fonts.ts"
# Old user agents receive TrueType sources from the CSS2 API instead of WOFF2.
TTF_USER_AGENT = "Mozilla/4.0"
# Google Fonts "latin" subset unicode-range.
LATIN_UNICODES = (
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,"
    "U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
)
OPENTYPE_JS_APPLIED_FEATURES = {"ccmp", "liga", "rlig"}
# GSUB lookups supported by opentype.js FeatureQuery.getLookupMethod: every single (1),
# multiple (2), and ligature (4) subtable, plus context (5) formats 1 and 3 and chained
# context (6) format 3.
OPENTYPE_JS_SIMPLE_GSUB_LOOKUP_TYPES = {1, 2, 4}
OPENTYPE_JS_CONTEXT_GSUB_LOOKUPS = {(5, 1), (5, 3), (6, 3)}


def parse_font_files():
    source = GOOGLE_FONTS_SOURCE.read_text(encoding="utf8")
    files = {}

    for block in re.findall(r" {2}\{[\s\S]*?\n {2}\},", source):
        fields = dict(re.findall(r'(\w+):\s*"([^"]+)"', block))
        weight = re.search(r"googleWeight:\s*(\d+)", block)

        if not weight or not {"googleFamily", "googleStyle", "vendorPath"} <= fields.keys():
            raise ValueError(f"Could not parse Google font block: {block}")

        source_font = (fields["googleFamily"], int(weight.group(1)), fields["googleStyle"])
        existing = files.setdefault(fields["vendorPath"], source_font)

        if existing != source_font:
            raise ValueError(f"{fields['vendorPath']} maps to both {existing} and {source_font}")

    return files


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": TTF_USER_AGENT})

    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def download_ttf(family, weight, style):
    italic = 1 if style == "italic" else 0
    query = f"family={urllib.parse.quote_plus(family)}:ital,wght@{italic},{weight}"
    css = fetch(f"https://fonts.googleapis.com/css2?{query}").decode("utf8")
    urls = re.findall(r"url\((https://[^)]+\.ttf)\)", css)

    if len(urls) != 1:
        raise ValueError(f"Expected one TTF source for {family} {weight} {style}, found {urls}")

    return fetch(urls[0])


def subset_font(font_bytes, excluded_features):
    options = subset.Options()
    options.layout_features = [
        feature for feature in options.layout_features if feature not in excluded_features
    ]
    options.legacy_kern = True
    options.hinting = False
    options.notdef_outline = True
    options.name_IDs = ["*"]
    options.name_languages = ["*"]

    font = TTFont(BytesIO(font_bytes))
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=subset.parse_unicodes(LATIN_UNICODES))
    subsetter.subset(font)

    return font


def unsupported_opentype_js_features(font):
    """Return GSUB features opentype.js always applies but would throw on.

    opentype.js 2 runs ccmp, liga, and rlig while laying out Latin text and throws on
    any other lookup (for example chained-context formats 1 and 2), which would break text rendering for the whole page.
    """
    if "GSUB" not in font or not font["GSUB"].table.FeatureList:
        return set()

    gsub = font["GSUB"].table
    unsupported = set()

    for feature_record in gsub.FeatureList.FeatureRecord:
        if feature_record.FeatureTag not in OPENTYPE_JS_APPLIED_FEATURES:
            continue

        for lookup_index in feature_record.Feature.LookupListIndex:
            lookup = gsub.LookupList.Lookup[lookup_index]

            for subtable in lookup.SubTable:
                lookup_type = lookup.LookupType

                if lookup_type == 7:
                    lookup_type = subtable.ExtensionLookupType
                    subtable = subtable.ExtSubTable

                if lookup_type in OPENTYPE_JS_SIMPLE_GSUB_LOOKUP_TYPES:
                    continue

                if (lookup_type, getattr(subtable, "Format", None)) not in (
                    OPENTYPE_JS_CONTEXT_GSUB_LOOKUPS
                ):
                    unsupported.add(feature_record.FeatureTag)

    return unsupported


def subset_latin_woff(font_bytes):
    font = subset_font(font_bytes, set())
    unsupported_features = unsupported_opentype_js_features(font)

    if unsupported_features:
        font = subset_font(font_bytes, unsupported_features)

    font.flavor = "woff"
    output = BytesIO()
    font.save(output)

    return output.getvalue(), unsupported_features


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--force", action="store_true", help="re-download existing files")
    args = parser.parse_args()

    font_files = parse_font_files()
    vendored = 0

    for vendor_path, (family, weight, style) in sorted(font_files.items()):
        target = PACKAGE_ROOT / vendor_path

        if target.exists() and not args.force:
            continue

        target.parent.mkdir(parents=True, exist_ok=True)
        font_bytes, dropped_features = subset_latin_woff(download_ttf(family, weight, style))
        target.write_bytes(font_bytes)
        vendored += 1
        dropped = f" (dropped {', '.join(sorted(dropped_features))})" if dropped_features else ""
        print(f"Vendored {vendor_path}{dropped}")

    referenced = {(PACKAGE_ROOT / path).resolve() for path in font_files}
    vendor_dirs = {(PACKAGE_ROOT / path).parent for path in font_files}
    unreferenced = sorted(
        path for folder in vendor_dirs for path in folder.iterdir()
        if path.suffix in {".ttf", ".woff"} if path.resolve() not in referenced
    )

    for path in unreferenced:
        print(f"Unreferenced font file: {path.relative_to(PACKAGE_ROOT)}", file=sys.stderr)

    print(f"Vendored {vendored} of {len(font_files)} Google Fonts files.")


if __name__ == "__main__":
    main()

#!/usr/bin/env bash
# render-app-icon.sh — regenerate every Tauri icon variant from icon-source.svg.
#
# Output:
#   src-tauri/icons/icon.png            (1024×1024 source)
#   src-tauri/icons/32x32.png           (32×32)
#   src-tauri/icons/128x128.png         (128×128)
#   src-tauri/icons/128x128@2x.png      (256×256, "retina" 128)
#   src-tauri/icons/icon.ico            (Windows multi-resolution)
#   src-tauri/icons/icon.icns           (macOS multi-resolution)
#
# Run from repo root: bash scripts/render-app-icon.sh

set -euo pipefail

ICON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/src-tauri/icons"
SVG="${ICON_DIR}/icon-source.svg"

if [[ ! -f "$SVG" ]]; then
  echo "error: $SVG not found" >&2
  exit 1
fi

# 1024 source → used by iconutil for .icns (16, 32, 64, 128, 256, 512, 1024)
rsvg-convert -w 1024 -h 1024 "$SVG" -o "$ICON_DIR/icon.png"

# The 32×32 / 128×128 / 128×128@2x are referenced explicitly by
# tauri.conf.json bundle.icon (in addition to icon.icns / icon.ico).
rsvg-convert -w 32   -h 32   "$SVG" -o "$ICON_DIR/32x32.png"
rsvg-convert -w 128  -h 128  "$SVG" -o "$ICON_DIR/128x128.png"
rsvg-convert -w 256  -h 256  "$SVG" -o "$ICON_DIR/128x128@2x.png"

# macOS .icns — need a folder ending in .iconset with the standard
# filename pattern. iconutil rejects folders without the .iconset suffix.
ICONSET="$(mktemp -d)/app.iconset"
mkdir -p "$ICONSET"
for SIZE in 16 32 64 128 256 512 1024; do
  rsvg-convert -w "$SIZE" -h "$SIZE" "$SVG" -o "$ICONSET/icon_${SIZE}x${SIZE}.png"
done
# 512@2x is the retina variant (1024)
cp "$ICONSET/icon_512x512.png" "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o "$ICON_DIR/icon.icns"
rm -rf "$(dirname "$ICONSET")"

# Windows .ico — multi-resolution via ImageMagick
magick "$ICON_DIR/icon.png" -define icon:auto-resize=256,128,64,48,32,16 "$ICON_DIR/icon.ico"

echo "✓ rendered:"
ls -la "$ICON_DIR"/{icon.png,icon.icns,icon.ico,32x32.png,128x128.png,128x128@2x.png}
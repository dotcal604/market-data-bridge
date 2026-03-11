#!/usr/bin/env bash
# market-data-bridge brand asset export script
# Converts SVG source files to PNG/ICO raster formats
#
# Requirements: Inkscape or rsvg-convert (librsvg2)
# Usage: bash brand/export.sh
#
# This script is optional — SVGs are the source of truth.
# Only run this if you need raster exports for specific platforms.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ASSETS="$SCRIPT_DIR/assets"
EXPORTS="$SCRIPT_DIR/exports"

mkdir -p "$EXPORTS"/{mark,icon,favicon,banner,social}

# Detect SVG renderer
if command -v rsvg-convert &>/dev/null; then
  RENDERER="rsvg"
elif command -v inkscape &>/dev/null; then
  RENDERER="inkscape"
else
  echo "Error: Need rsvg-convert (librsvg2) or inkscape for PNG export."
  echo "  Ubuntu/Debian: sudo apt install librsvg2-bin"
  echo "  macOS: brew install librsvg"
  echo "  Or: brew install inkscape"
  exit 1
fi

render_png() {
  local input="$1" output="$2" width="$3"
  if [ "$RENDERER" = "rsvg" ]; then
    rsvg-convert -w "$width" "$input" -o "$output"
  else
    inkscape "$input" -w "$width" -o "$output" 2>/dev/null
  fi
}

echo "Exporting mark..."
render_png "$ASSETS/mark/mark.svg"      "$EXPORTS/mark/mark-64.png"   64
render_png "$ASSETS/mark/mark.svg"      "$EXPORTS/mark/mark-128.png"  128
render_png "$ASSETS/mark/mark.svg"      "$EXPORTS/mark/mark-256.png"  256
render_png "$ASSETS/mark/mark-mono.svg" "$EXPORTS/mark/mark-mono-128.png" 128

echo "Exporting app icon..."
render_png "$ASSETS/icon/app-icon.svg"  "$EXPORTS/icon/app-icon-128.png"  128
render_png "$ASSETS/icon/app-icon.svg"  "$EXPORTS/icon/app-icon-256.png"  256
render_png "$ASSETS/icon/app-icon.svg"  "$EXPORTS/icon/app-icon-512.png"  512

echo "Exporting favicons..."
render_png "$ASSETS/favicon/favicon-16.svg" "$EXPORTS/favicon/favicon-16.png" 16
render_png "$ASSETS/favicon/favicon.svg"    "$EXPORTS/favicon/favicon-32.png" 32
render_png "$ASSETS/favicon/favicon.svg"    "$EXPORTS/favicon/favicon-48.png" 48

echo "Exporting banner..."
render_png "$ASSETS/banner/readme-banner.svg" "$EXPORTS/banner/readme-banner.png" 1280
render_png "$ASSETS/banner/readme-banner.svg" "$EXPORTS/banner/readme-banner@2x.png" 2560

echo "Exporting social card..."
render_png "$ASSETS/social/og-card.svg" "$EXPORTS/social/og-card.png" 1200
render_png "$ASSETS/social/og-card.svg" "$EXPORTS/social/og-card@2x.png" 2400

echo ""
echo "Done. Exports in: $EXPORTS/"
echo ""
echo "For .ico generation (favicon):"
echo "  convert $EXPORTS/favicon/favicon-16.png $EXPORTS/favicon/favicon-32.png $EXPORTS/favicon/favicon-48.png $EXPORTS/favicon/favicon.ico"
echo ""
echo "Or use an online tool: realfavicongenerator.net with $ASSETS/favicon/favicon.svg"

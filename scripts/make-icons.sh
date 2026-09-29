#!/usr/bin/env bash
# Regenerate every app icon asset from the SVG sources in assets/icon-src/.
# Requires rsvg-convert + magick:
#   nix shell nixpkgs#librsvg nixpkgs#imagemagick -c bash scripts/make-icons.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=assets/icon-src
render() { rsvg-convert -w "$2" -h "$2" "$1" -o "$3"; }

render "$SRC/icon.svg"        1024 assets/icon.png
render "$SRC/icon.svg"          64 assets/favicon.png
render "$SRC/foreground.svg"  1024 assets/android-icon-foreground.png
render "$SRC/background.svg"  1024 assets/android-icon-background.png
render "$SRC/monochrome.svg"  1024 assets/android-icon-monochrome.png
render "$SRC/foreground.svg"   512 assets/splash-icon.png

magick identify assets/icon.png assets/favicon.png \
  assets/android-icon-{foreground,background,monochrome}.png assets/splash-icon.png

#!/bin/sh
# Sürümü artırır: scripts/surum.sh [patch|minor|major]   (varsayılan patch)
set -e
cd "$(dirname "$0")/.."
cur=$(grep -oE "[0-9]+\.[0-9]+\.[0-9]+" version.js)
next=$(echo "$cur" | awk -F. -v part="${1:-patch}" '{
  if (part == "major") print $1 + 1 ".0.0";
  else if (part == "minor") print $1 "." $2 + 1 ".0";
  else if (part == "patch") print $1 "." $2 "." $3 + 1;
  else exit 1
}') || { echo "kullanım: scripts/surum.sh [patch|minor|major]" >&2; exit 1; }
sed -i.bak "s/'$cur'/'$next'/" version.js && rm version.js.bak
echo "$cur → $next"

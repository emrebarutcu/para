#!/bin/sh
# Sürümü artırır: scripts/surum.sh [patch|minor|major]   (varsayılan patch; hangisi olduğu SETUP.md → Sürüm)
# iPhone'un mağaza sürümü ayrı: scripts/surum.sh ios [patch|minor|major]   (MARKETING_VERSION, ör. 1.0 → 1.1)
set -e
cd "$(dirname "$0")/.."
pbx=ios/CashFollow.xcodeproj/project.pbxproj
if [ "$1" = "ios" ]; then
  cur=$(sed -n "s/.*MARKETING_VERSION = \([0-9.]*\);.*/\1/p" "$pbx" | head -1)
  next=$(echo "$cur" | awk -F. -v part="${2:-patch}" '{
    if (part == "major") print $1 + 1 ".0";
    else if (part == "minor") print $1 "." $2 + 1;
    else if (part == "patch") print $1 "." $2 "." $3 + 1;
    else exit 1
  }') || { echo "kullanım: scripts/surum.sh ios [patch|minor|major]" >&2; exit 1; }
  sed -i.bak "s/MARKETING_VERSION = $cur;/MARKETING_VERSION = $next;/" "$pbx" && rm "$pbx.bak"
  grep -q "MARKETING_VERSION = $next;" "$pbx" || { echo "$pbx'teki MARKETING_VERSION güncellenemedi" >&2; exit 1; }
  echo "iPhone $cur → $next"
  exit 0
fi
cur=$(sed -n "s/^self.APP_VERSION = '\([0-9.]*\)';.*/\1/p" version.js)
next=$(echo "$cur" | awk -F. -v part="${1:-patch}" '{
  if (part == "major") print $1 + 1 ".0.0";
  else if (part == "minor") print $1 "." $2 + 1 ".0";
  else if (part == "patch") print $1 "." $2 "." $3 + 1;
  else exit 1
}') || { echo "kullanım: scripts/surum.sh [patch|minor|major]" >&2; exit 1; }
sed -i.bak "s/'$cur'/'$next'/" version.js && rm version.js.bak
# sw.js de her sürümde değişsin (tarayıcılar yeni service worker'ı dosyanın kendisinden fark eder)
sed -i.bak "s|^// Sürüm $cur |// Sürüm $next |" sw.js && rm sw.js.bak
grep -q "^// Sürüm $next " sw.js || { echo "sw.js'teki sürüm satırı güncellenemedi" >&2; exit 1; }
echo "$cur → $next"

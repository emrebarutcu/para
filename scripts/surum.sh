#!/bin/sh
# Sürümü artırır: YIL.AYGÜN.SIRA (İstanbul saatiyle bugün; ör. 2026.1019.1, aynı gün 2026.1019.2, 5 Ocak'ta 2027.105.1).
# App Store en fazla üç tam sayı kabul eder, başta sıfır olmaz: ay ve gün tek parçadadır (ay × 100 + gün).
set -e
cd "$(dirname "$0")/.."
cur=$(sed -n "s/^self.APP_VERSION = '\([0-9.]*\)';.*/\1/p" version.js)
today=$(TZ=Europe/Istanbul date +%Y.%m%d | sed 's/\.0/./')
if [ "${cur%.*}" = "$today" ]; then next="$today.$((${cur##*.} + 1))"; else next="$today.1"; fi
sed -i.bak "s/'$cur'/'$next'/" version.js && rm version.js.bak
echo "$cur → $next"

#!/bin/sh
# Her PR'da:   scripts/surum.sh [patch|minor|major]   (varsayılan patch; hangisi olduğu SETUP.md → Sürüm)
#   Yapı numarası (APP_BUILD) 1 artar. Sürüm (APP_VERSION) yayındaki sürümden (en yüksek yayin-* etiketi) bu düzeyde
#   artırılmış değilse artar: yayından sonra kaç PR gelirse gelsin mağazaya çıkan numara bir sonrakidir (1.3.4 → 1.3.5,
#   minor geldiyse 1.4.0), arada sayı atlanmaz.
# Yayında:     scripts/surum.sh yayin [X.Y.Z]          (varsayılan version.js'teki sürüm)
#   X.Y.Z App Store incelemesine gönderildi: yayin-X.Y.Z etiketi. magaza.yml "incele" kendisi koyar; App Store
#   Connect'ten elle gönderilen sürüm için bu komut.
set -e
cd "$(dirname "$0")/.."
cur=$(sed -n "s/^self.APP_VERSION = '\([0-9.]*\)';.*/\1/p" version.js)
build=$(sed -n "s/^self.APP_BUILD = \([0-9]*\);.*/\1/p" version.js)
[ -n "$cur" ] && [ -n "$build" ] || { echo "version.js'te APP_VERSION ya da APP_BUILD okunamadı" >&2; exit 1; }

git fetch -q --tags origin 2>/dev/null || echo "uyarı: etiketler alınamadı, yereldekilerle devam" >&2

if [ "$1" = yayin ]; then
  v="${2:-$cur}"
  echo "$v" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "sürüm X.Y.Z olmalı: $v" >&2; exit 1; }
  git tag "yayin-$v" 2>/dev/null || echo "yayin-$v zaten var"
  git push -q origin "yayin-$v" && echo "yayin-$v → origin"
  exit 0
fi

rel=$(git tag -l 'yayin-*' | sed 's/^yayin-//' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)
hedef=$(echo "${rel:-0.0.0}" | awk -F. -v part="${1:-patch}" '{
  if (part == "major") print $1 + 1 ".0.0";
  else if (part == "minor") print $1 "." $2 + 1 ".0";
  else if (part == "patch") print $1 "." $2 "." $3 + 1;
  else exit 1
}') || { echo "kullanım: scripts/surum.sh [patch|minor|major] | yayin [X.Y.Z]" >&2; exit 1; }
# Sürüm geri gitmez: bu düzeyde zaten artırılmışsa olduğu gibi kalır
next=$(printf '%s\n%s\n' "$cur" "$hedef" | sort -V | tail -1)
nb=$((build + 1))

sed -i.bak -e "s/^self.APP_VERSION = '$cur';/self.APP_VERSION = '$next';/" \
  -e "s/^self.APP_BUILD = $build;/self.APP_BUILD = $nb;/" version.js && rm version.js.bak
# sw.js de her PR'da değişsin (tarayıcılar yeni service worker'ı dosyanın kendisinden fark eder)
sed -i.bak "1s|^// Sürüm [0-9.]* (yapı [0-9]*) |// Sürüm $next (yapı $nb) |" sw.js && rm sw.js.bak
grep -q "^// Sürüm $next (yapı $nb) " sw.js || { echo "sw.js'teki sürüm satırı güncellenemedi" >&2; exit 1; }
# iOS uygulamasının mağaza sürümü (CFBundleShortVersionString) bu sürümdür; build numarası TestFlight'ın çalışma sayısı
pbx=ios/CashFollow.xcodeproj/project.pbxproj
sed -i.bak "s/MARKETING_VERSION = [0-9.]*;/MARKETING_VERSION = $next;/" "$pbx" && rm "$pbx.bak"
grep -q "MARKETING_VERSION = $next;" "$pbx" || { echo "$pbx'teki MARKETING_VERSION güncellenemedi" >&2; exit 1; }

echo "sürüm $cur → $next (yayında: ${rel:-yok}), yapı $build → $nb"

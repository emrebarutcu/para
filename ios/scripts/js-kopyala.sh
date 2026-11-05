#!/bin/sh
# Xcode "Web modülleri" adımı: web'in hesap modülleri, asistan araçları (mcp/tools.js) ve köprü (ios/js/kopru.js) uygulama
# paketine (js/) kopyalanır. Kopya değil kaynak tektir: web'de bir kural değişince iOS bir sonraki derlemede onu kullanır.
set -e
ROOT="$SRCROOT/.."
DEST="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/js"
mkdir -p "$DEST"
for f in dil para tekrar taksit varlik borc kategori eposta icgoru nakit tablo; do
  cp "$ROOT/$f.js" "$DEST/$f.js"
done
cp "$ROOT/mcp/tools.js" "$DEST/tools.js"
for l in en de fr es it nl ja ko pt; do   # sözlükler (dil.js, Dil.swift); dil.js → LANGS ile aynı
  cp "$ROOT/dil/$l.json" "$DEST/$l.json"
done
cp "$SRCROOT/js/kopru.js" "$DEST/kopru.js"

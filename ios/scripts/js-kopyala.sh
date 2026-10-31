#!/bin/sh
# Xcode "Web modülleri" adımı: web'in hesap modülleri, asistan araçları (mcp/tools.js) ve köprü (ios/js/kopru.js) uygulama
# paketine (js/) kopyalanır. Kopya değil kaynak tektir: web'de bir kural değişince iOS bir sonraki derlemede onu kullanır.
set -e
ROOT="$SRCROOT/.."
DEST="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/js"
mkdir -p "$DEST"
for f in tekrar taksit varlik borc kategori eposta icgoru tablo; do
  cp "$ROOT/$f.js" "$DEST/$f.js"
done
cp "$ROOT/mcp/tools.js" "$DEST/tools.js"
cp "$SRCROOT/js/kopru.js" "$DEST/kopru.js"

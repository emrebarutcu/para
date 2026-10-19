#!/bin/sh
# Supabase projesinde SQL çalıştırır (Management API): sh supabase/sql.sh supabase/tablolar.sql
# ya da: echo "select 1" | sh supabase/sql.sh -
# Erişim anahtarı ortamdan okunur (SUPABASE_ACCESS_TOKEN; GitHub'da Actions secret'ı). Repoya yazılmaz.
set -eu
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN tanımlı değil}"
ref=${SUPABASE_PROJECT_REF:-bffqfhgctlgexjdyvaup}
file=${1:?"SQL dosyası ya da - (stdin)"}
[ "$file" = "-" ] && file=/dev/stdin
node -e 'process.stdout.write(JSON.stringify({ query: require("fs").readFileSync(process.argv[1], "utf8") }))' "$file" |
  curl -sS --fail-with-body -X POST "https://api.supabase.com/v1/projects/$ref/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data-binary @-
echo

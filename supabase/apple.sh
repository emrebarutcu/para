#!/bin/sh
# Supabase Auth'ta Apple ile girişi açar: iPhone'un yerel "Apple ile devam et"i (Sign in with Apple) Apple'ın kimlik
# belirtecini Supabase'e verir (grant_type=id_token); Supabase belirtecin alıcısını (aud) istemci kimlikleriyle denetler.
# Yerel giriş için gizli anahtar gerekmez, istemci kimliği uygulamanın paket kimliğidir. Var olan istemci kimlikleri
# (ör. web'in Services ID'si) korunur. Yeniden çalıştırılabilir. Yalnızca iki alan yazdırılır (auth ayarlarının geri
# kalanında SMTP şifresi gibi gizli değerler var).
#   SUPABASE_ACCESS_TOKEN=… sh supabase/apple.sh   (GitHub'da: Actions → Supabase SQL → dosya: supabase/apple.sh)
set -eu
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN tanımlı değil}"
ref=${SUPABASE_PROJECT_REF:-bffqfhgctlgexjdyvaup}
paket=${APPLE_BUNDLE_ID:-app.cashfollow.ios}
api="https://api.supabase.com/v1/projects/$ref/config/auth"
govde=$(curl -sS --fail-with-body "$api" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" | PAKET="$paket" node -e '
let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
  const c = JSON.parse(s);
  const ids = String(c.external_apple_client_id || "").split(",").map(x => x.trim()).filter(Boolean);
  if (!ids.includes(process.env.PAKET)) ids.push(process.env.PAKET);
  process.stdout.write(JSON.stringify({ external_apple_enabled: true, external_apple_client_id: ids.join(",") }));
});')
curl -sS --fail-with-body -X PATCH "$api" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  --data "$govde" | node -e '
let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
  const c = JSON.parse(s);
  console.log(`Apple ile giriş: ${c.external_apple_enabled ? "açık" : "KAPALI"}, istemci kimlikleri: ${c.external_apple_client_id}`);
  if (!c.external_apple_enabled) process.exit(1);
});'

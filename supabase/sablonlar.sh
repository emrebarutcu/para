#!/bin/sh
# E-posta şablonlarını (supabase/eposta-sablonlari) ve konularını Supabase Auth'a yükler (Management API).
# Önce şablonlardaki ?token_hash= bağlantılarını karşılayan sürüm (sync.js → handleEmailLink) yayında olmalı.
# Gövde kullanıcının diline (.Data.lang), dil yoksa ülkesine (.Data.country) göre İngilizce ya da Türkçedir; konu iki dillidir.
# Erişim anahtarı ortamdan okunur (SUPABASE_ACCESS_TOKEN), repoya yazılmaz: sh supabase/sablonlar.sh
set -eu
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN tanımlı değil}"
ref=${SUPABASE_PROJECT_REF:-bffqfhgctlgexjdyvaup}
cd "$(dirname "$0")/eposta-sablonlari"
node -e '
const fs = require("fs");
const t = (f) => fs.readFileSync(f, "utf8");
process.stdout.write(JSON.stringify({
  mailer_subjects_confirmation: "Confirm your CashFollow account · CashFollow hesabını doğrula",
  mailer_templates_confirmation_content: t("hesap-dogrulama.html"),
  mailer_subjects_recovery: "Reset your CashFollow password · CashFollow şifreni sıfırla",
  mailer_templates_recovery_content: t("sifre-sifirlama.html"),
  mailer_subjects_email_change: "Change your CashFollow email · CashFollow e-posta adresini değiştir",
  mailer_templates_email_change_content: t("eposta-degisikligi.html"),
}));
' | curl -sS --fail-with-body -o /dev/null -w "Supabase: HTTP %{http_code}\n" -X PATCH \
  "https://api.supabase.com/v1/projects/$ref/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data-binary @-

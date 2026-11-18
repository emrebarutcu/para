-- 1.3.0 geçişi: uygulama ayarları (app_config). Sürüm çıkarmadan değiştirilebilen, herkese açık değerler: anahtar →
-- değer. Herkes okur (girişsiz de: publishable anahtar), yalnızca Supabase panelinden / service role ile yazılır.
-- İlk anahtar sms_shortcut_url: iPhone'da Ayarlar → Banka mesajları → "Kısayolu ekle"nin açtığı hazır kısayolun iCloud
-- bağlantısı (https://www.icloud.com/shortcuts/…; boşken düğme görünmez). Uygulama her açılışta okur.
-- tablolar.sql'in "Uygulama ayarları" bölümüyle aynı; yeniden çalıştırmak zararsızdır, değere dokunmaz.
create table if not exists app_config (
  key        text primary key,
  value      text,
  note       text,
  updated_at timestamptz not null default now()
);
alter table app_config enable row level security;
drop policy if exists "app config read" on app_config;
create policy "app config read" on app_config for select to anon, authenticated using (true);
grant select on app_config to anon, authenticated;

insert into app_config (key, value, note) values
  ('sms_shortcut_url', null, 'iPhone → Ayarlar → Banka mesajları → "Kısayolu ekle": hazır kısayolun iCloud bağlantısı (https://www.icloud.com/shortcuts/…). Boşken düğme görünmez; uygulama her açılışta okur.')
on conflict (key) do nothing;

notify pgrst, 'reload schema';

select key as anahtar, coalesce(value, '(boş)') as deger from app_config order by key;

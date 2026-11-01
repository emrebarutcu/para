-- 7.0.0 geçişi: ülke ve ana para birimi (para.js). Varlık kodu her üç harfli para birimi kodu olabilir (tablolar.sql'in
-- "Ülke ve ana para birimi" bölümüyle aynı; sıfırdan kurulumda tablolar.sql yeter). Kısıtlar yalnızca gevşer, veriye
-- dokunmaz. Yeniden çalıştırmak zararsızdır. Son sorgu sonucu gösterir.
alter table entries drop constraint if exists entries_asset_check;
alter table entries add constraint entries_asset_check
  check (asset ~ '^[A-Z]{3}$' or asset ~ '^(FON:[A-Z0-9]{3}|BIST:[A-Z][A-Z0-9]{2,5})$');
alter table purchases drop constraint if exists purchases_asset_check;
alter table purchases add constraint purchases_asset_check check (asset ~ '^[A-Z]{3}$');
alter table debts drop constraint if exists debts_asset_check;
alter table debts add constraint debts_asset_check check (asset ~ '^[A-Z]{3}$');

select conrelid::regclass as tablo, conname as kisit, pg_get_constraintdef(oid) as tanim
from pg_constraint
where conname in ('entries_asset_check', 'purchases_asset_check', 'debts_asset_check')
order by 1;

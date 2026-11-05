-- 8.7.0 geçişi: Japonya'da bonus ödemesi (ボーナス払い; tablolar.sql'in "Bonus ödemesi" bölümüyle aynı; sıfırdan kurulumda
-- tablolar.sql yeter). Yalnızca boş olabilen sütunlar eklenir, veriye dokunmaz; yeni istemci bu sütunları yazdığı için
-- sürümden önce çalışmalıdır. Yeniden çalıştırmak zararsızdır. Son sorgu sonucu gösterir.
alter table cards add column if not exists bonus_months smallint[]
  check (bonus_months is null or (cardinality(bonus_months) = 2 and bonus_months <@ '{1,2,3,4,5,6,7,8,9,10,11,12}'::smallint[]
    and bonus_months[1] <> bonus_months[2]));
alter table purchases add column if not exists bonus boolean check (bonus is null or bonus);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'purchases_bonus_date_check') then
    alter table purchases add constraint purchases_bonus_date_check check (bonus is null or date is not null);
  end if;
end $$;
notify pgrst, 'reload schema';

select table_name as tablo, column_name as sutun, data_type as tur
from information_schema.columns
where table_schema = 'public' and ((table_name = 'cards' and column_name = 'bonus_months') or (table_name = 'purchases' and column_name = 'bonus'))
order by 1;

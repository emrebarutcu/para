-- 8.1.0 geçişi: kartın yıllık faizi ve "şimdi al sonra öde" (tablolar.sql'in "Döner kredi ve Pay in 4" bölümüyle aynı;
-- sıfırdan kurulumda tablolar.sql yeter). Yalnızca boş olabilen sütun eklenir, veriye dokunmaz; yeni istemci bu
-- sütunları yazdığı için sürümden önce çalışmalıdır. Yeniden çalıştırmak zararsızdır. Son sorgu sonucu gösterir.
alter table cards add column if not exists apr numeric check (apr between 0 and 100);
alter table purchases add column if not exists bnpl text check (bnpl ~ '^[a-z]{1,20}$');
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'purchases_bnpl_date_check') then
    alter table purchases add constraint purchases_bnpl_date_check check (bnpl is null or date is not null);
  end if;
end $$;
notify pgrst, 'reload schema';

select table_name as tablo, column_name as sutun, data_type as tur
from information_schema.columns
where table_schema = 'public' and ((table_name = 'cards' and column_name = 'apr') or (table_name = 'purchases' and column_name = 'bnpl'))
order by 1;

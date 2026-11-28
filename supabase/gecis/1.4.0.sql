-- 1.4.0 geçişi: harcama etiketleri (tablolar.sql'in "Etiketler" bölümüyle aynı; sıfırdan kurulumda tablolar.sql yeter).
-- Yalnızca boş olabilen bir sütun eklenir, veriye dokunmaz; yeni istemci bu sütunu yazdığı için sürümden önce
-- çalışmalıdır. Eski istemciler sütunu bilmez ama silmez (yazma yalnızca gönderilen sütunları değiştirir).
-- Yeniden çalıştırmak zararsızdır. Son sorgu sonucu gösterir.
create or replace function etiketler_gecerli(t text[]) returns boolean language sql immutable as $$
  select t is null or (cardinality(t) between 1 and 10
    and not exists (select 1 from unnest(t) x where x is null or length(x) not between 1 and 40 or x ~ '[,\n\r\t]'))
$$;
alter table purchases add column if not exists tags text[] check (etiketler_gecerli(tags));
notify pgrst, 'reload schema';

select table_name as tablo, column_name as sutun, data_type as tur
from information_schema.columns
where table_schema = 'public' and table_name = 'purchases' and column_name = 'tags';

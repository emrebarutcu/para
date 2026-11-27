-- 1.4.0 geçişi: harcama etiketleri (tablolar.sql'in "Etiketler" bölümüyle aynı; sıfırdan kurulumda tablolar.sql yeter).
-- Boş olabilen bir sütun (purchases.tags) ve yeni bir tablo (tags: etiketin bütçesi ve gezi modu) eklenir, veriye
-- dokunmaz; yeni istemci ikisini de yazdığı ve okuduğu için sürümden önce çalışmalıdır. Eski istemciler sütunu ve
-- tabloyu bilmez ama silmez (yazma yalnızca gönderilen sütunları değiştirir).
-- Yeniden çalıştırmak zararsızdır. Son sorgu sonucu gösterir.
create or replace function etiketler_gecerli(t text[]) returns boolean language sql immutable as $$
  select t is null or (cardinality(t) between 1 and 10
    and not exists (select 1 from unnest(t) x where x is null or length(x) not between 1 and 40 or x ~ '[,\n\r\t]'))
$$;
alter table purchases add column if not exists tags text[] check (etiketler_gecerli(tags));
-- Etiketin ayarları (1.4): bütçe ve gezi modu. id etiketin kimliği (tablo.js tagKey), name görünen adı. budget ana para
-- biriminde (boşsa yok). Gezi modu: active_from–active_until arasındaki tarihli yeni harcamalara (formdan, banka e-postası
-- ve SMS'ten, asistandan) etiket kendiliğinden eklenir; boşsa kapalı. Harcamalar etikete adıyla bağlanır (purchases.tags).
create table if not exists tags (
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  id           text not null check (length(id) between 1 and 100),
  name         text not null check (length(name) between 1 and 40),
  budget       numeric check (budget > 0),
  active_from  date,
  active_until date,
  created_at   timestamptz not null default clock_timestamp(),
  updated_at   timestamptz not null default clock_timestamp(),
  deleted_at   timestamptz,
  primary key (user_id, id),
  check (active_from is null or (active_until is not null and active_from <= active_until))
);
create index if not exists tags_sync on tags (user_id, updated_at);

-- Eşitlenen öbür tablolar gibi: updated_at sunucu saatiyle (touch_row), yalnızca kendi satırları, Realtime yayını
do $$
begin
  drop trigger if exists touch on tags;
  create trigger touch before insert or update on tags for each row execute function touch_row();
  alter table tags enable row level security;
  drop policy if exists "own rows read" on tags;
  drop policy if exists "own rows create" on tags;
  drop policy if exists "own rows update" on tags;
  create policy "own rows read" on tags for select using (auth.uid() = user_id);
  create policy "own rows create" on tags for insert with check (auth.uid() = user_id);
  create policy "own rows update" on tags for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tags') then
    alter publication supabase_realtime add table tags;
  end if;
end $$;
notify pgrst, 'reload schema';

select table_name as tablo, column_name as sutun, data_type as tur
from information_schema.columns
where table_schema = 'public' and ((table_name = 'purchases' and column_name = 'tags') or table_name = 'tags')
order by 1, 2;

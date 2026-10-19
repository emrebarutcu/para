-- Kişiler, kartlar ve harcamalar ayrı tablolarda
-- Eskiden kullanıcının bütün verisi cashflow_data'da tek bir JSON'du; her yazma bütün belgeyi değiştirdiği için
-- iki cihaz (ya da uygulama ve asistan) aynı anda yazınca biri diğerinin değişikliğini siliyordu. Artık her kişi,
-- kart ve harcama ayrı bir satırdır: uygulama (sync.js) ve asistan (mcp/supabase.js) yalnızca değişen satırları
-- yazar. Satırlar silinmez, deleted_at ile işaretlenir; başka cihaz silindiğini updated_at'ten öğrenir.
-- Uygulamadaki biçime çeviri: tablo.js.
-- Supabase → SQL Editor'de bir kez, yeni sürüm yayınlanmadan önce çalıştırılır. Tekrar çalıştırmak zararsızdır.

-- id'ler uygulamada üretilir (çevrimdışıyken de kayıt eklenebilsin); her kullanıcının kendi id alanı vardır.
-- created_at listedeki sırayı korur (ilk kişi varsayılan kişidir), updated_at senkronizasyonun imlecidir.
create table if not exists people (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  id         text not null check (length(id) between 1 and 100),
  name       text not null,
  color      smallint not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists cards (
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  id           text not null check (length(id) between 1 and 100),
  name         text not null,
  credit_limit numeric not null default 0 check (credit_limit >= 0),
  cutoff_day   smallint not null check (cutoff_day between 1 and 31),   -- hesap kesim günü
  due_day      smallint not null check (due_day between 1 and 31),      -- son ödeme günü
  color        smallint not null default 0,
  last4        text check (last4 ~ '^[0-9]{4}$'),
  created_at   timestamptz not null default clock_timestamp(),
  updated_at   timestamptz not null default clock_timestamp(),
  deleted_at   timestamptz,
  primary key (user_id, id)
);

-- Tarihi bilinen harcamada ödemeler date'ten ve kartın günlerinden hesaplanır. Tarihsiz (Excel'den gelen)
-- kayıtta first_due kalan ilk taksitin ödendiği ay, count / total kalan taksitler, plan_count asıl taksit sayısıdır.
create table if not exists purchases (
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  id          text not null check (length(id) between 1 and 100),
  person_id   text not null,
  card_id     text,                                  -- boşsa nakit / banka kartı
  description text not null,
  total       numeric not null check (total > 0),
  count       integer not null check (count between 1 and 100000),
  date        date,
  first_due   text check (first_due ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  plan_count  integer check (plan_count between 1 and 100000),
  created_at  timestamptz not null default clock_timestamp(),
  updated_at  timestamptz not null default clock_timestamp(),
  deleted_at  timestamptz,
  primary key (user_id, id),
  foreign key (user_id, person_id) references people (user_id, id),
  foreign key (user_id, card_id) references cards (user_id, id),
  check (date is not null or first_due is not null)
);

create index if not exists people_sync    on people    (user_id, updated_at);
create index if not exists cards_sync     on cards     (user_id, updated_at);
create index if not exists purchases_sync on purchases (user_id, updated_at);

-- updated_at her yazmada sunucu saatiyle yenilenir; created_at değiştirilemez
create or replace function touch_row() returns trigger
language plpgsql
as $$
begin
  new.updated_at := clock_timestamp();
  if tg_op = 'UPDATE' then new.created_at := old.created_at; end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['people', 'cards', 'purchases'] loop
    execute format('drop trigger if exists touch on %I', t);
    execute format('create trigger touch before insert or update on %I for each row execute function touch_row()', t);

    -- Kullanıcı yalnızca kendi satırlarını görür ve yazar. Silme yetkisi yoktur: silinen satır deleted_at alır.
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "own rows read" on %I', t);
    execute format('drop policy if exists "own rows create" on %I', t);
    execute format('drop policy if exists "own rows update" on %I', t);
    execute format('create policy "own rows read" on %I for select using (auth.uid() = user_id)', t);
    execute format('create policy "own rows create" on %I for insert with check (auth.uid() = user_id)', t);
    execute format('create policy "own rows update" on %I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);

    -- Asistan ya da başka cihaz yazınca açık uygulama beklemeden güncellensin
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

-- ---------- Eski JSON → tablolar ----------
-- JSON'daki dizi elemanları; id'si olmayanlar atlanır, aynı id iki kez geçiyorsa ilki alınır (uygulamadaki gibi)
create or replace function cashflow_items(data jsonb, field text)
returns table (id text, item jsonb, ord bigint)
language sql immutable
as $$
  select distinct on (e->>'id') e->>'id', e, n
  from jsonb_array_elements(case when jsonb_typeof(data->field) = 'array' then data->field else '[]'::jsonb end)
       with ordinality as t(e, n)
  where jsonb_typeof(e) = 'object' and coalesce(e->>'id', '') <> ''
  order by e->>'id', n
$$;

-- JSON sayısı (ya da sayı yazılmış metin); değilse null
create or replace function cashflow_num(v jsonb)
returns numeric
language sql immutable
as $$
  select case
    when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric
    when jsonb_typeof(v) = 'string' and btrim(v #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then btrim(v #>> '{}')::numeric
  end
$$;

create or replace function cashflow_int(v jsonb, lo int, hi int)
returns int
language sql immutable
as $$
  select case when round(cashflow_num(v)) between lo and hi then round(cashflow_num(v))::int end
$$;

-- "YYYY-MM-DD"; geçersizse null
create or replace function cashflow_date(s text)
returns date
language plpgsql immutable
as $$
begin
  if s !~ '^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}$' then return null; end if;
  return s::date;
exception when others then
  return null;
end;
$$;

-- old_data'dan new_data'ya değişen kişi, kart ve harcamaları tablolara yazar: yeni ya da değişen satırlar eklenir /
-- güncellenir, new_data'da olmayanlar silindi olarak işaretlenir. Tablolarda ihlal edecek kayıtlar (tutarsız harcama,
-- geçersiz günlü kart) atlanır; kartı bulunamayan harcama uygulamada olduğu gibi nakit sayılır.
-- Çağıranın yetkileriyle çalışır: kullanıcı yalnızca kendi satırlarını yazabilir (RLS).
create or replace function cashflow_apply(uid uuid, old_data jsonb, new_data jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  stamp timestamptz := clock_timestamp();
begin
  -- Sıra korunsun diye created_at her elemana bir mikrosaniye ileriden verilir
  insert into people (user_id, id, name, color, created_at)
  select uid, n.id, coalesce(n.item->>'name', ''), coalesce(cashflow_int(n.item->'color', 0, 999), 0),
         stamp + n.ord * interval '1 microsecond'
  from cashflow_items(new_data, 'people') n
  left join cashflow_items(old_data, 'people') o using (id)
  where o.item is distinct from n.item
  on conflict (user_id, id) do update
    set name = excluded.name, color = excluded.color, deleted_at = null;

  insert into cards (user_id, id, name, credit_limit, cutoff_day, due_day, color, last4, created_at)
  select uid, n.id, coalesce(n.item->>'name', ''), greatest(coalesce(cashflow_num(n.item->'limit'), 0), 0),
         cashflow_int(n.item->'cutoffDay', 1, 31), cashflow_int(n.item->'dueDay', 1, 31),
         coalesce(cashflow_int(n.item->'color', 0, 999), 0),
         case when n.item->>'last4' ~ '^[0-9]{4}$' then n.item->>'last4' end,
         stamp + n.ord * interval '1 microsecond'
  from cashflow_items(new_data, 'cards') n
  left join cashflow_items(old_data, 'cards') o using (id)
  where o.item is distinct from n.item
    and cashflow_int(n.item->'cutoffDay', 1, 31) is not null
    and cashflow_int(n.item->'dueDay', 1, 31) is not null
  on conflict (user_id, id) do update
    set name = excluded.name, credit_limit = excluded.credit_limit, cutoff_day = excluded.cutoff_day,
        due_day = excluded.due_day, color = excluded.color, last4 = excluded.last4, deleted_at = null;

  insert into purchases (user_id, id, person_id, card_id, description, total, count, date, first_due, plan_count, created_at)
  select uid, n.id, n.item->>'personId',
         (select c.id from cards c where c.user_id = uid and c.id = n.item->>'cardId'),
         coalesce(n.item->>'desc', ''), cashflow_num(n.item->'total'), cashflow_int(n.item->'count', 1, 100000),
         cashflow_date(n.item->>'date'),
         case when n.item->>'firstDue' ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then n.item->>'firstDue' end,
         cashflow_int(n.item->'planCount', 1, 100000),
         stamp + n.ord * interval '1 microsecond'
  from cashflow_items(new_data, 'installments') n
  left join cashflow_items(old_data, 'installments') o using (id)
  where o.item is distinct from n.item
    and exists (select 1 from people p where p.user_id = uid and p.id = n.item->>'personId')
    and cashflow_num(n.item->'total') > 0
    and cashflow_int(n.item->'count', 1, 100000) is not null
    and (cashflow_date(n.item->>'date') is not null or n.item->>'firstDue' ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
  on conflict (user_id, id) do update
    set person_id = excluded.person_id, card_id = excluded.card_id, description = excluded.description,
        total = excluded.total, count = excluded.count, date = excluded.date, first_due = excluded.first_due,
        plan_count = excluded.plan_count, deleted_at = null;

  update purchases set deleted_at = stamp
  where user_id = uid and deleted_at is null
    and id in (select id from cashflow_items(old_data, 'installments'))
    and id not in (select id from cashflow_items(new_data, 'installments'));
  update cards set deleted_at = stamp
  where user_id = uid and deleted_at is null
    and id in (select id from cashflow_items(old_data, 'cards'))
    and id not in (select id from cashflow_items(new_data, 'cards'));
  update people set deleted_at = stamp
  where user_id = uid and deleted_at is null
    and id in (select id from cashflow_items(old_data, 'people'))
    and id not in (select id from cashflow_items(new_data, 'people'));
end;
$$;

-- Geçiş dönemi: önbellekteki eski sürüm hâlâ cashflow_data'ya bütün JSON'u yazar. Yazdığı değişiklikler (önceki
-- JSON'a göre fark) tablolara aktarılır, böylece yeni sürümü kullanan cihazlar onları da görür.
-- Bütün cihazlar yeni sürüme geçince kaldırılabilir:
--   drop trigger cashflow_data_mirror on cashflow_data;
-- cashflow_data yoksa (sıfırdan kurulum) bu bölüm atlanır.
create or replace function cashflow_data_mirror() returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform cashflow_apply(new.user_id, case when tg_op = 'UPDATE' then old.data else '{}'::jsonb end, new.data);
  return new;
end;
$$;

-- Bir kerelik taşıma: tablolarda henüz satırı olmayan her kullanıcının JSON'u aktarılır.
-- cashflow_data silinmez; eski sürümlerden kalan alanlar (entriesByDate, recurring…) orada durur.
do $$
begin
  if to_regclass('public.cashflow_data') is null then return; end if;
  drop trigger if exists cashflow_data_mirror on cashflow_data;
  create trigger cashflow_data_mirror after insert or update of data on cashflow_data
    for each row execute function cashflow_data_mirror();
  perform cashflow_apply(d.user_id, '{}'::jsonb, d.data)
  from cashflow_data d
  where not exists (select 1 from people p where p.user_id = d.user_id);
end $$;

-- Kontrol (ayrıca çalıştırılır): JSON'daki ve tablolardaki kayıt sayıları; atlanan kayıt varsa farklı çıkar.
-- Atlananlar: kişisi olmayan, tutarı / taksit sayısı / tarihi geçersiz harcamalar ve günleri geçersiz kartlar.
/*
select d.user_id,
       jsonb_array_length(coalesce(d.data->'people', '[]')) as json_people,
       (select count(*) from people p where p.user_id = d.user_id and p.deleted_at is null) as people,
       jsonb_array_length(coalesce(d.data->'cards', '[]')) as json_cards,
       (select count(*) from cards c where c.user_id = d.user_id and c.deleted_at is null) as cards,
       jsonb_array_length(coalesce(d.data->'installments', '[]')) as json_purchases,
       (select count(*) from purchases x where x.user_id = d.user_id and x.deleted_at is null) as purchases
from cashflow_data d;
*/

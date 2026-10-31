-- Kişiler, kartlar, harcamalar, varlık hareketleri ve borçlar ayrı tablolarda
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

-- Kesim / son ödeme günü değişmeden önceki günler: [{ "until": "YYYY-MM-DD", "cutoff_day": 10, "due_day": 20 }], until'e
-- göre sıralı. Kesimi until'e kadar olan ekstreler o günlerle kesilmiştir, sonrakiler sıradaki (en son cutoff_day / due_day)
-- günlerle. Boşsa null: bütün ekstreler kartın bugünkü günleriyle.
alter table cards add column if not exists history jsonb check (history is null or jsonb_typeof(history) = 'array');

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

-- Varlık hareketleri: TL, dolar, euro, gram altın, fon ve hisse giriş / çıkışları. amount varlığın kendi biriminde
-- (GAU: gram; fon ve hissede adet), girişte artı, çıkışta eksidir; bakiye toplamdır. TL karşılığı uygulamada güncel
-- kurla (/api/kur), fon ve hissede güncel fiyatla (/api/fiyat) hesaplanır.
create table if not exists entries (
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  id          text not null check (length(id) between 1 and 100),
  person_id   text not null,
  asset       text not null check (asset in ('TRY', 'USD', 'EUR', 'GAU') or asset ~ '^(FON:[A-Z0-9]{3}|BIST:[A-Z][A-Z0-9]{2,5})$'),
  amount      numeric not null check (amount <> 0),
  description text not null,
  date        date not null,
  created_at  timestamptz not null default clock_timestamp(),
  updated_at  timestamptz not null default clock_timestamp(),
  deleted_at  timestamptz,
  primary key (user_id, id),
  foreign key (user_id, person_id) references people (user_id, id)
);

-- Tekrarlayan hareket (1.x'te yoktu; var olan tabloya eklenir): date'ten başlayıp her ay aynı gün yinelenir.
-- N: N kez, 0: süresiz, boş: tek seferlik. Bakiyeye yalnızca tarihi gelmiş tekrarlar girer (varlik.js).
alter table entries add column if not exists repeat_count integer
  check (repeat_count = 0 or repeat_count between 2 and 600);

-- Harcama kategorisi (2.x'te yoktu; var olan tabloya eklenir): kategori.js'teki kimlik (market, yeme, …). category_by:
-- 'user' kullanıcı seçti ya da onayladı (uygulama bundan öğrenir), 'ai' cihazdaki dil modeli önerdi. Boşsa kategorisiz.
alter table purchases add column if not exists category text check (category ~ '^[a-z]{1,20}$');
alter table purchases add column if not exists category_by text check (category_by in ('user', 'ai'));

-- Her N gün / hafta / ayda bir tekrar ve harcamanın varlığı (3.x'te yoktu; var olan tablolara eklenir, tekrar.js).
-- repeat_every boşsa 1, repeat_unit boşsa 'month'. Harcamada asset boşsa TL; döviz ve altın harcaması kartsızdır ve
-- o varlığın bakiyesinden düşer. Tekrarlayan harcamanın her tekrarı kendi tarihiyle ayrı bir alışveriştir.
alter table entries add column if not exists repeat_every smallint check (repeat_every between 1 and 99);
alter table entries add column if not exists repeat_unit text check (repeat_unit in ('day', 'week', 'month'));
alter table purchases add column if not exists asset text check (asset in ('TRY', 'USD', 'EUR', 'GAU'));
alter table purchases add column if not exists repeat_count integer
  check (repeat_count = 0 or repeat_count between 2 and 600);
alter table purchases add column if not exists repeat_every smallint check (repeat_every between 1 and 99);
alter table purchases add column if not exists repeat_unit text check (repeat_unit in ('day', 'week', 'month'));

-- Fon ve hisse (5.x'te yoktu; var olan tabloya eklenir, varlik.js): asset 'FON:AFT' (TEFAS fon kodu) ya da
-- 'BIST:THYAO' (Borsa İstanbul işlem kodu), amount adet; tekrarlamaz. price alış / satış günündeki birim fiyat (TL;
-- boşsa bilinmiyor), settle true ise adet × price sahibinin TL bakiyesinden düşer (alış) ya da ona eklenir (satış).
alter table entries drop constraint if exists entries_asset_check;
alter table entries add constraint entries_asset_check
  check (asset in ('TRY', 'USD', 'EUR', 'GAU') or asset ~ '^(FON:[A-Z0-9]{3}|BIST:[A-Z][A-Z0-9]{2,5})$');
alter table entries add column if not exists price numeric check (price > 0);
alter table entries add column if not exists settle boolean;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'entries_settle_check') then
    alter table entries add constraint entries_settle_check check (settle is null or price is not null);
  end if;
end $$;

-- Kartın ekstre takibi (4.x'te yoktu; var olan tabloya eklenir, borc.js): track_since'tan sonra son ödeme günü geçen
-- ekstreler ilk kişinin TL varlığından düşer, kartta diğer kişilerin o günden sonraki taksitleri onlardan alacaktır.
-- Boşsa uygulama kartı ilk gördüğü günle doldurur; track_off kart takip dışı (ör. eşin kartı).
alter table cards add column if not exists track_since date;
alter table cards add column if not exists track_off boolean not null default false;
-- Ekstre ödeme modu: boşsa otomatik (son ödeme gününün ertesi günü ödenmiş sayılır); doluysa o günden sonraki ekstreler
-- Ödendi ile kaydedilen kart ödemeleriyle (debts.card_id) kapanır
alter table cards add column if not exists manual_since date;

-- Borçlar ve alacaklar (borc.js). Tek tablo, kind'a göre:
--   person: biriyle borç (side 'debt') ya da alacak ('receivable'); party karşı taraf (serbest metin), amount ödenecek
--           toplam, principal date günü varlığa giren / çıkan (boşsa para hareketi yok), due vade ya da ilk taksit,
--           count taksit sayısı, auto_pay true: taksitler tarihinde ödenmiş sayılır (boşsa yalnızca kaydedilen ödemeler)
--   loan:   banka kredisi; amount taksit × count, taksitler due'dan başlayıp ayda bir; auto_pay boşsa tarihinde ödenmiş
--           sayılır, false ise yalnızca kaydedilen ödemelerle (elle)
--   payment: debt_id'li ödeme / tahsilat / erken ödeme (borcun varlığında); card_id'li kart ekstresi ödemesi (TL, ilk
--           kişiden); ikisi de boşsa person_id'nin kart payı ödemesi (TL, ilk kişiye girer)
-- debt_id'de bilerek yabancı anahtar yok: ödemenin borçtan önce yazılması eşitlemeyi durdurmasın.
create table if not exists debts (
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  id          text not null check (length(id) between 1 and 100),
  kind        text not null check (kind in ('person', 'loan', 'payment')),
  person_id   text not null,
  debt_id     text check (length(debt_id) between 1 and 100),
  card_id     text,
  side        text check (side in ('debt', 'receivable')),
  party       text,
  description text not null default '',
  asset       text check (asset in ('TRY', 'USD', 'EUR', 'GAU')),
  amount      numeric not null check (amount > 0),
  principal   numeric check (principal > 0),
  date        date not null,
  due         date,
  count       integer check (count between 1 and 600),
  auto_pay    boolean,
  closed      date,
  created_at  timestamptz not null default clock_timestamp(),
  updated_at  timestamptz not null default clock_timestamp(),
  deleted_at  timestamptz,
  primary key (user_id, id),
  foreign key (user_id, person_id) references people (user_id, id),
  constraint debts_card_fk foreign key (user_id, card_id) references cards (user_id, id),
  constraint debts_card_check check (card_id is null or (kind = 'payment' and debt_id is null)),
  check (kind = 'payment' or asset is not null),
  check (kind <> 'person' or side is not null),
  check (kind <> 'loan' or (due is not null and count is not null)),
  check (count is null or due is not null)
);

-- Kart ekstresi ödemesi (5.0 önizlemesinde yoktu; var olan tabloya eklenir)
alter table debts add column if not exists card_id text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'debts_card_fk') then
    alter table debts add constraint debts_card_fk foreign key (user_id, card_id) references cards (user_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'debts_card_check') then
    alter table debts add constraint debts_card_check check (card_id is null or (kind = 'payment' and debt_id is null));
  end if;
end $$;

create index if not exists people_sync    on people    (user_id, updated_at);
create index if not exists cards_sync     on cards     (user_id, updated_at);
create index if not exists purchases_sync on purchases (user_id, updated_at);
create index if not exists entries_sync   on entries   (user_id, updated_at);
create index if not exists debts_sync     on debts     (user_id, updated_at);

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
  foreach t in array array['people', 'cards', 'purchases', 'entries', 'debts'] loop
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
       (select count(*) from purchases x where x.user_id = d.user_id and x.deleted_at is null) as purchases,
       (select count(*) from debts b where b.user_id = d.user_id and b.deleted_at is null) as debts
from cashflow_data d;
*/

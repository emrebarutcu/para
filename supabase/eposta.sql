-- E-postadan harcama
-- Her kullanıcıya özel bir e-posta adresi (<address>@INBOX_DOMAIN) verilir; kullanıcı bunu bankaya bildirim adresi
-- olarak girer. Alan adına gelen e-postaları Cloudflare Email Worker (workers/eposta) karşılar ve ingest_email ile
-- buraya yazar. Uygulama okunmamış e-postaları ayrıştırır, kartına ekler ve işlendi olarak işaretler.
-- Supabase → SQL Editor'de bir kez çalıştırılır.

-- Kullanıcının e-posta adresi (yerel kısım). 12 onaltılık hane: tahmin edilemez, bankaların alan sınırına sığar.
create table if not exists inbox_addresses (
  user_id    uuid primary key references auth.users on delete cascade,
  address    text unique not null default substr(md5(gen_random_uuid()::text), 1, 12),
  created_at timestamptz not null default now()
);

alter table inbox_addresses enable row level security;

create policy "own address read" on inbox_addresses
  for select using (auth.uid() = user_id);
create policy "own address create" on inbox_addresses
  for insert with check (auth.uid() = user_id);
create policy "own address delete" on inbox_addresses
  for delete using (auth.uid() = user_id);

-- Gelen e-postalar; processed_at dolunca uygulama tarafından işlenmiş (eklenmiş ya da yok sayılmış) demektir
create table if not exists inbox_messages (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users on delete cascade,
  message_key  text not null,
  sender       text,
  subject      text,
  body         text not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  unique (user_id, message_key)
);

create index if not exists inbox_messages_pending on inbox_messages (user_id) where processed_at is null;

alter table inbox_messages enable row level security;

create policy "own messages read" on inbox_messages
  for select using (auth.uid() = user_id);
create policy "own messages update" on inbox_messages
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Uygulama açıkken yeni e-posta anında işlensin (Realtime)
alter publication supabase_realtime add table inbox_messages;

-- Yalnızca e-posta worker'ı çağırır (service role). Aynı e-posta iki kez gelirse ikincisi yok sayılır.
create or replace function ingest_email(
  address    text,
  body       text,
  subject    text default null,
  sender     text default null,
  message_id text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  owner    uuid;
  inserted bigint;
begin
  select a.user_id into owner from inbox_addresses a where a.address = lower(btrim(address));
  if owner is null then
    return json_build_object('ok', false, 'error', 'unknown address');
  end if;
  if coalesce(btrim(body), '') = '' then
    return json_build_object('ok', false, 'error', 'empty body');
  end if;

  insert into inbox_messages (user_id, message_key, sender, subject, body)
  values (
    owner,
    coalesce(nullif(btrim(message_id), ''), md5(coalesce(subject, '') || body)),
    left(sender, 300),
    left(subject, 500),
    left(body, 50000)
  )
  on conflict (user_id, message_key) do nothing
  returning id into inserted;

  return json_build_object('ok', true, 'duplicate', inserted is null);
end;
$$;

revoke all on function ingest_email(text, text, text, text, text) from public, anon, authenticated;
grant execute on function ingest_email(text, text, text, text, text) to service_role;

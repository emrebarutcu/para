-- E-postadan harcama
-- Kestirme (ya da başka bir e-posta dinleyicisi) bankanın bildirim e-postasını ingest_email'e gönderir;
-- uygulama açılınca okunmamış e-postaları ayrıştırır, kartına ekler ve işlendi olarak işaretler.
-- Supabase → SQL Editor'de bir kez çalıştırılır.

-- Kullanıcı başına gizli anahtar: kestirme bununla kimin adına yazdığını bildirir
create table if not exists inbox_tokens (
  user_id    uuid primary key references auth.users on delete cascade,
  token      text unique not null default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);

alter table inbox_tokens enable row level security;

create policy "own token read" on inbox_tokens
  for select using (auth.uid() = user_id);
create policy "own token create" on inbox_tokens
  for insert with check (auth.uid() = user_id);
create policy "own token delete" on inbox_tokens
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

-- Anahtarla çağrılır (anon key yeterli). Aynı e-posta iki kez gelirse ikincisi yok sayılır.
create or replace function ingest_email(
  token      text,
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
  select t.user_id into owner from inbox_tokens t where t.token = token;
  if owner is null then
    raise exception 'invalid token' using errcode = '28000';
  end if;
  if coalesce(btrim(body), '') = '' then
    raise exception 'empty body' using errcode = '22023';
  end if;

  insert into inbox_messages (user_id, message_key, sender, subject, body)
  values (
    owner,
    coalesce(nullif(btrim(message_id), ''), md5(coalesce(subject, '') || body)),
    left(sender, 300),
    left(subject, 500),
    left(body, 20000)
  )
  on conflict (user_id, message_key) do nothing
  returning id into inserted;

  return json_build_object('ok', true, 'duplicate', inserted is null);
end;
$$;

revoke all on function ingest_email(text, text, text, text, text) from public;
grant execute on function ingest_email(text, text, text, text, text) to anon, authenticated;

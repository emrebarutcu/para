-- 8.0.0 geçişi: hesap silme (App Store kuralı: hesap açılabilen uygulamada hesap uygulamanın içinden silinebilmeli).
-- Kullanıcı yalnızca kendi hesabını siler; bütün tablolar auth.users'a "on delete cascade" bağlı olduğundan verisi de
-- silinir (people, cards, purchases, entries, debts, inbox_*). tablolar.sql'in "Hesap silme" bölümüyle aynı. Yeniden
-- çalıştırmak zararsızdır. Son sorgu sonucu gösterir.
create or replace function public.delete_my_account() returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

select p.proname as fonksiyon, p.prosecdef as security_definer,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('anon', p.oid, 'execute') as anon
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'delete_my_account';

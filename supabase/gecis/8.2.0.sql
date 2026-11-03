-- 8.2.0 geçişi: CashFollow Premium aboneliği (tablolar.sql'in "Abonelik" bölümüyle aynı; sıfırdan kurulumda tablolar.sql
-- yeter). Kullanıcı kendi satırını yalnızca okur; satırı Worker yazar (service role, mcp/abonelik.js). Var olan bütün
-- hesaplar ömür boyu Premium sayılır (source grandfathered). Asistan Premium'a baktığı için sürümden önce çalışmalıdır;
-- yeniden çalıştırmak zararsızdır (o ana kadar açılmış hesaplar da eklenir). Son sorgu sonucu gösterir.
create table if not exists subscriptions (
  user_id                 uuid primary key references auth.users on delete cascade,
  source                  text not null check (source in ('appstore', 'grandfathered', 'stripe')),
  product_id              text,
  original_transaction_id text unique,
  environment             text check (environment in ('Production', 'Sandbox')),
  status                  text not null check (status in ('active', 'grace', 'billing_retry', 'expired', 'revoked')),
  expires_at              timestamptz,
  auto_renew              boolean,
  updated_at              timestamptz not null default now()
);
alter table subscriptions enable row level security;
drop policy if exists "own subscription read" on subscriptions;
create policy "own subscription read" on subscriptions for select using (auth.uid() = user_id);

insert into subscriptions (user_id, source, status)
select id, 'grandfathered', 'active' from auth.users
on conflict (user_id) do nothing;
notify pgrst, 'reload schema';

select source as kaynak, status as durum, count(*) as hesap from subscriptions group by 1, 2 order by 1, 2;

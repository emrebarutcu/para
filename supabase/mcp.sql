-- Yapay zekâ asistanları (MCP)
-- Asistan /mcp üzerinden veriyi değiştirince açık olan CashFollow beklemeden güncellensin (sync.js → watchData).
-- Asistanlar kullanıcının kendi token'ıyla bağlanır; mevcut RLS ("own data") yeterlidir, ek tablo gerekmez.
-- Supabase → SQL Editor'de bir kez çalıştırılır.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cashflow_data'
  ) then
    alter publication supabase_realtime add table cashflow_data;
  end if;
end $$;

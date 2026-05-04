# Cashflow — Kurulum

## 1. Supabase (cloud sync)

1. [supabase.com](https://supabase.com) → New project oluştur
2. **SQL Editor** → şu sorguyu çalıştır:

```sql
create table cashflow_data (
  user_id uuid references auth.users primary key,
  data    jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table cashflow_data enable row level security;

create policy "own data" on cashflow_data
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

3. **Settings → API** sayfasından al:
   - Project URL
   - anon/public key

4. `config.js` dosyasını aç, değerleri yapıştır:

```js
window.SUPABASE_URL      = 'https://xyzxyz.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGci...';
```

## 2. Netlify (hosting)

1. [netlify.com](https://netlify.com) → ücretsiz hesap aç
2. Dashboard → **"Add new site" → "Deploy manually"**
3. `cashflow` klasörünü drag & drop et
4. Bitti — sana bir `*.netlify.app` URL verir

> **Özel domain** bağlamak istersen Netlify → Domain settings'ten ücretsiz ekleyebilirsin.

## 3. Mobil (iPhone / Android)

**iPhone (Safari):**  
Paylaş butonu → "Ana Ekrana Ekle"

**Android (Chrome):**  
Menü → "Uygulamayı yükle" ya da adres çubuğundaki install simgesi

---

Sync çalışma mantığı: Her kayıtta Supabase'e 1.5s gecikmeli yazar.  
Giriş yapınca uzak veri daha yeniyse otomatik çeker. Çevrimdışıyken localStorage'dan çalışır.

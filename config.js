// ─── Supabase Credentials ────────────────────────────────────────────────────
// 1. supabase.com → New project → Settings → API
// 2. Aşağıya Project URL ve anon/public key'i yapıştır
// 3. Boş bırakırsan uygulama sadece local storage ile çalışır (sync yok)
// ─────────────────────────────────────────────────────────────────────────────
window.SUPABASE_URL      = 'https://bffqfhgctlgexjdyvaup.supabase.co';
window.SUPABASE_ANON_KEY = 'sb_publishable_KoF5Tfi74v8RSWvszPeuxQ_LWwKZGDo';

// ─── E-postadan harcama ───────────────────────────────────────────────────────
// Kullanıcılara verilen adreslerin alan adı (Cloudflare Email Routing → workers/eposta).
// Boşsa Ayarlar → Banka e-postaları'nda adres yerine kurulum uyarısı gösterilir.
window.INBOX_DOMAIN = 'cashfollow.app';

// ─── Ürün analitiği ve A/B (PostHog, ABD bölgesi) ─────────────────────────────
// Proje anahtarı herkese açıktır (phc_…). Boşsa analitik kapalı (hiçbir şey gönderilmez). iPhone: Yapilandirma.swift.
window.POSTHOG_KEY  = 'phc_sEWqvuL259ZcLYGHQXWpnusXvLPMRPF8L4SvAsWHWfPY';
window.POSTHOG_HOST = 'https://us.i.posthog.com';

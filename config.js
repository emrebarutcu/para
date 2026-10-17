// ─── Supabase Credentials ────────────────────────────────────────────────────
// 1. supabase.com → New project → Settings → API
// 2. Aşağıya Project URL ve anon/public key'i yapıştır
// 3. Boş bırakırsan uygulama sadece local storage ile çalışır (sync yok)
// ─────────────────────────────────────────────────────────────────────────────
window.SUPABASE_URL      = 'https://bffqfhgctlgexjdyvaup.supabase.co';
window.SUPABASE_ANON_KEY = 'sb_publishable_KoF5Tfi74v8RSWvszPeuxQ_LWwKZGDo';

// ─── iCloud (CloudKit) ───────────────────────────────────────────────────────
// Veriler kullanıcının kendi iCloud hesabında (özel veritabanı) saklanır.
// Kurulum: SETUP.md → "iCloud". Boş bırakırsan iCloud seçeneği görünmez.
// ─────────────────────────────────────────────────────────────────────────────
window.ICLOUD_CONTAINER = '';            // örn. 'iCloud.com.ornek.para'
window.ICLOUD_API_TOKEN = '';            // CloudKit Console → API Tokens
window.ICLOUD_ENV       = 'production';  // şema yayınlanmadan denerken 'development'

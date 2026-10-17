// ─── iCloud (CloudKit) ───────────────────────────────────────────────────────
// Veriler kullanıcının kendi iCloud hesabında (özel veritabanı) saklanır.
// Kurulum: SETUP.md → "iCloud". Boş bırakırsan iCloud seçeneği görünmez.
// ─────────────────────────────────────────────────────────────────────────────
window.ICLOUD_CONTAINER = '';            // örn. 'iCloud.com.ornek.para'
window.ICLOUD_API_TOKEN = '';            // CloudKit Console → API Tokens
window.ICLOUD_ENV       = 'production';  // şema yayınlanmadan denerken 'development'

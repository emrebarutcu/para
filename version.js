// Uygulama sürümü (SemVer: MAJOR.MINOR.PATCH) = App Store'daki sürüm (MARKETING_VERSION). Yalnızca son yayından sonra
// gerektiği kadar artar: yayından sonraki ilk PR'lar artırır, aynı düzeydeki sonrakiler aynı numarada kalır; böylece
// mağazada sayı atlanmaz. APP_BUILD her PR'da 1 artar (web önbelleği, Ayarlar'da parantez içinde).
// İkisini de scripts/surum.sh yazar, .github/workflows/surum.yml denetler; kurallar SETUP.md → Sürüm.
self.APP_VERSION = '1.4.0';
self.APP_BUILD = 1;

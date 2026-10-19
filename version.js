// Uygulama sürümü (SemVer: MAJOR.MINOR.PATCH). main'e her birleştirmede scripts/surum.sh ile artırılır,
// .github/workflows/surum.yml denetler; hangi parçanın artacağı SETUP.md → Sürüm'de.
// Service worker önbelleğinin adı da buradan gelir; sürüm değişince eski önbellek silinir.
self.APP_VERSION = '1.2.0';

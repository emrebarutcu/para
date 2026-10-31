import Foundation
import Security

// Cihazdaki dosyalar (Application Support/CashFollow). Web'deki localStorage anahtarlarının karşılığı:
//   veri.json               girişsiz kullanımın verisi (cashflow.v1)
//   veri.<kullanıcı>.json   hesabın verisi (cashflow.v1.<kullanıcı id>)
//   esitleme.<kullanıcı>.json  eşitleme tabanı ve imleç (cashflow.v1.<kullanıcı id>.sync)
//   kur.json, fiyat.json    son alınan kurlar ve fon / hisse fiyatları (çevrimdışı da gösterilsin)
enum Depo {
    static let folder: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let url = base.appendingPathComponent("CashFollow", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }()

    static func url(_ name: String) -> URL { folder.appendingPathComponent(name) }
    static func stateFile(_ userId: String?) -> URL { url(userId.map { "veri.\($0).json" } ?? "veri.json") }
    static func metaFile(_ userId: String) -> URL { url("esitleme.\(userId).json") }

    static func read(_ url: URL) -> String? { try? String(contentsOf: url, encoding: .utf8) }
    static func write(_ url: URL, _ text: String) {
        try? Data(text.utf8).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    static func remove(_ url: URL) { try? FileManager.default.removeItem(at: url) }

    // Girişsiz devam etmeyi seçti: ilk açılış penceresi bir daha çıkmaz (web: para.offline)
    static var offlineChosen: Bool {
        get { UserDefaults.standard.bool(forKey: "para.offline") }
        set { UserDefaults.standard.set(newValue, forKey: "para.offline") }
    }
}

// Eşitleme tabanı (tablo → id → son eşitlenen satırın JSON'u) ve imleç (tablo → okunan son updated_at); sync.js loadMeta
struct EsitlemeMeta: Codable {
    var base: [String: [String: String]]
    var cursor: [String: String]
    var schema: Int
}

// Oturum Anahtar Zinciri'nde (yalnızca bu cihazda, ilk kilit açılıştan sonra)
enum AnahtarZinciri {
    private static let service = "app.cashfollow.oturum"

    static func load() -> Data? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        return SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess ? out as? Data : nil
    }

    static func save(_ data: Data) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
        let attrs: [String: Any] = [kSecValueData as String: data,
                                    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        if SecItemUpdate(q as CFDictionary, attrs as CFDictionary) == errSecItemNotFound {
            SecItemAdd(q.merging(attrs) { $1 } as CFDictionary, nil)
        }
    }

    static func delete() {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service] as CFDictionary)
    }
}

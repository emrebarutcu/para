import Foundation
import StoreKit

// CashFollow Premium (StoreKit 2): haftalık, aylık, yıllık abonelik — App Store Connect'te "CashFollow Premium" grubu; fiyat
// ve ücretsiz deneme oradan gelir, kodda fiyat yok (örnek modu hariç). Premium = cihazdaki geçerli abonelik (girişsiz de
// çalışır) ya da hesabın sunucudaki satırı (Supabase subscriptions: ilk kullanıcılar, başka cihazda alınmış abonelik;
// kural tablo.js premium, köprüden). Girişliyken alınan abonelik hesaba bağlanır (appAccountToken = kullanıcı kimliği;
// /api/abonelik, mcp/abonelik.js) ve asistan da açılır. Ücretsiz sürümün sınırları: SETUP.md → Abonelik.
@MainActor
final class Abonelik: ObservableObject {
    static let kimlikler = ["yearly", "monthly", "weekly"].map { "app.cashfollow.ios.premium.\($0)" }
    static let ucretsizKart = 2
    static let ucretsizKisi = 1

    // Hesabın sunucudaki satırı (yalnızca okunur; RLS)
    struct HesapSatiri: Decodable, Equatable {
        let source: String
        let product_id: String?
        let original_transaction_id: String?
        let status: String
        let expires_at: String?
        var premium = false
        private enum CodingKeys: String, CodingKey { case source, product_id, original_transaction_id, status, expires_at }
    }

    @Published private(set) var urunler: [Product] = []
    @Published private(set) var cihaz: Transaction?        // cihazdaki geçerli abonelik
    @Published private(set) var yenilenecek: Bool?         // cihazdaki abonelik dönem sonunda yenilenecek mi
    @Published private(set) var sunucu: HesapSatiri?
    @Published private(set) var calisiyor = false
    @Published var hata: String?

    // Hesabın kimliği ve geçerli oturum anahtarı (Model; girişsizse nil)
    var hesap: () async -> (id: String, token: String)? = { nil }
    private let kural: (String?) -> Bool
    private var dinleyici: Task<Void, Never>?
    private var baglanan: UInt64?      // bu açılışta hesaba bağlanan abonelik (originalID)

    var premium: Bool { Ornek.premium ?? (cihaz != nil || sunucu?.premium == true) }

    init(kural: @escaping (String?) -> Bool) {
        self.kural = kural
        guard Ornek.premium == nil else { return }
        // Başka cihazda yenileme, iade, Aile Paylaşımı, onay bekleyen alım: uygulama açıkken gelir
        dinleyici = Task { [weak self] in
            for await sonuc in Transaction.updates {
                guard case .verified(let t) = sonuc else { continue }
                await t.finish()
                await self?.cihaziYenile()
                await self?.hesabaBagla()
            }
        }
        Task { await cihaziYenile() }
    }

    // ── Ürünler ve satın alma ─────────────────────────────────────────────────

    func urunleriYukle() async {
        guard urunler.isEmpty, Ornek.premium == nil else { return }
        if let list = try? await Product.products(for: Self.kimlikler) {
            urunler = Self.kimlikler.compactMap { id in list.first { $0.id == id } }
        }
    }

    func satinAl(_ urun: Product) async {
        calisiyor = true
        defer { calisiyor = false }
        hata = nil
        Analitik.olay("purchase_started", ["product": urun.id])
        var secenekler: Set<Product.PurchaseOption> = []
        if let id = await hesap()?.id, let uuid = UUID(uuidString: id) { secenekler.insert(.appAccountToken(uuid)) }
        do {
            switch try await urun.purchase(options: secenekler) {
            case .success(let sonuc):
                guard case .verified(let t) = sonuc else { hata = L("App Store satın alımı doğrulanamadı."); return }
                await t.finish()
                await cihaziYenile()
                Analitik.olay("purchase_completed", ["product": urun.id])
                await hesabaBagla()
            case .pending:
                hata = L("Satın alma onay bekliyor (ör. Aile Paylaşımı'nda ebeveyn onayı). Onaylanınca Premium kendiliğinden açılır.")
            case .userCancelled:
                break
            @unknown default:
                break
            }
        } catch {
            hata = error.localizedDescription
        }
    }

    func geriYukle() async {
        calisiyor = true
        defer { calisiyor = false }
        hata = nil
        Analitik.olay("restore")
        do { try await AppStore.sync() } catch StoreKitError.userCancelled { return } catch {
            hata = error.localizedDescription
            return
        }
        await yenile()
        if !premium { hata = L("Bu Apple hesabında CashFollow Premium aboneliği bulunamadı.") }
    }

    // ── Durum ─────────────────────────────────────────────────────────────────

    // Cihazdaki geçerli abonelik: süresi bitmemiş, iade edilmemiş (Transaction.currentEntitlements); en geç biteni
    func cihaziYenile() async {
        var bulunan: Transaction?
        for await sonuc in Transaction.currentEntitlements {
            guard case .verified(let t) = sonuc, Self.kimlikler.contains(t.productID), t.revocationDate == nil else { continue }
            if let e = t.expirationDate, e < Date() { continue }
            if (t.expirationDate ?? .distantFuture) > (bulunan?.expirationDate ?? .distantPast) { bulunan = t }
        }
        cihaz = bulunan
        yenilenecek = nil
        if let t = bulunan, let durumlar = try? await Product.products(for: [t.productID]).first?.subscription?.status {
            for d in durumlar {
                if case .verified(let r) = d.renewalInfo, r.originalTransactionID == t.originalID { yenilenecek = r.willAutoRenew }
            }
        }
    }

    // Uygulama açılınca ve öne gelince (Model.refresh): cihaz, hesabın satırı; cihazdaki abonelik hesaba bağlı değilse bağlanır
    func yenile() async {
        guard Ornek.premium == nil else { return }
        await cihaziYenile()
        guard let h = await hesap() else { sunucu = nil; return }
        if sunucu == nil { sunucu = kayitli(h.id) }
        await oku(h)
        await hesabaBagla()
    }

    // Çıkış ya da hesap silme: hesabın satırı unutulur (cihazdaki abonelik Apple hesabına aittir, kalır)
    func cikis(_ userId: String? = nil) {
        sunucu = nil
        baglanan = nil
        if let userId { UserDefaults.standard.removeObject(forKey: anahtar(userId)) }
    }

    private func anahtar(_ id: String) -> String { "para.premium.\(id)" }

    // Son okunan satır (çevrimdışı açılışta Premium kaybolmasın)
    private func kayitli(_ id: String) -> HesapSatiri? {
        guard let json = UserDefaults.standard.string(forKey: anahtar(id)) else { return nil }
        return cozumle(json)
    }

    private func cozumle(_ json: String?) -> HesapSatiri? {
        guard let json, var s = try? JSONDecoder().decode(HesapSatiri.self, from: Data(json.utf8)) else { return nil }
        s.premium = kural(json)
        return s
    }

    private func oku(_ h: (id: String, token: String)) async {
        var req = URLRequest(url: URL(string: Yapilandirma.supabaseURL.absoluteString
            + "/rest/v1/subscriptions?select=source,product_id,original_transaction_id,status,expires_at")!)
        req.setValue(Yapilandirma.supabaseKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(h.token)", forHTTPHeaderField: "Authorization")
        guard let (data, res) = try? await URLSession.shared.data(for: req), (res as? HTTPURLResponse)?.statusCode == 200,
              let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
        guard let row = rows.first, let json = try? JSONSerialization.data(withJSONObject: row),
              let text = String(data: json, encoding: .utf8) else {
            sunucu = nil
            UserDefaults.standard.removeObject(forKey: anahtar(h.id))
            return
        }
        sunucu = cozumle(text)
        UserDefaults.standard.set(text, forKey: anahtar(h.id))
    }

    // Cihazdaki abonelik girişli hesaba bağlanır (asistan Premium'u sunucudan okur). İlk kullanıcının satırı ve aynı
    // abonelik zaten bağlıysa gerek yok; başka hesaba bağlıysa (409) bu açılışta yeniden denenmez.
    private func hesabaBagla() async {
        guard let t = cihaz, baglanan != t.originalID, sunucu?.source != "grandfathered" else { return }
        if sunucu?.premium == true, sunucu?.original_transaction_id == String(t.originalID) { baglanan = t.originalID; return }
        guard let h = await hesap() else { return }
        var req = URLRequest(url: Yapilandirma.site.appendingPathComponent("api/abonelik"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(h.token)", forHTTPHeaderField: "Authorization")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["transactionId": String(t.id)])
        guard let (_, res) = try? await URLSession.shared.data(for: req) else { return }
        let kod = (res as? HTTPURLResponse)?.statusCode ?? 0
        if kod == 200 || kod == 403 || kod == 409 { baglanan = t.originalID }
        if kod == 200 { await oku(h) }
    }
}

import CryptoKit
import Foundation
import UIKit

// Banka mesajları (SMS): iPhone'da Kısayollar otomasyonu gelen mesajın metnini "Banka mesajından harcama ekle" eylemine
// verir (Kisayollar.swift). Metin telefonda okunur (eposta.js sms; cihazda varsa Apple Intelligence: MesajZekasi) ve
// banka e-postalarıyla aynı yoldan işlenir (Model.checkInbox): okunan ve kartı bulunan harcama eklenir, emin olunamayan
// Harcamalar'da onaya düşer. Şifre, ekstre gibi harcama olmayan mesajlar hiçbir yere yazılmaz. Kuyruk yalnızca bu
// telefonda durur (mesajlar.json), sunucuya gitmez; hesap gerekmez. Satırların kimliği eksidir: sunucudaki
// e-postalarınkiyle karışmaz. Yalnızca Türkiye'deki hesaplarda (banka e-postaları gibi: Model.bankEmailsAllowed).
enum Mesajlar {
    // Telefondaki modelin okuduğu (eposta.js sms → hint): harcama mı, işyeri ve tutar mesajda yazdığı gibi
    struct Ipucu: Codable, Equatable {
        let purchase: Bool
        let merchant: String?
        let amount: String?
    }

    struct Satir: Codable {
        let id: Int
        let body: String
        let received_at: String
        let source: String
        var hint: Ipucu?
    }

    // Eylemin sonucu (Kısayollar'a metin olarak döner; Ayarlar → Banka mesajları'nda son mesajın durumu)
    enum Sonuc {
        case eklendi(Harcama)   // harcama eklendi
        case bekliyor           // Harcamalar'da onay bekliyor
        case sirada             // sıraya alındı (uygulama açılınca ya da eşitlenince işlenir)
        case atlandi            // harcama mesajı değil (şifre, ekstre…) ya da aynı mesaj ikinci kez
        case kapali             // bu hesapta kullanılamıyor (Türkiye dışı)

        var kod: String {
            switch self {
            case .eklendi: return "added"
            case .bekliyor: return "pending"
            case .sirada: return "queued"
            case .atlandi: return "skipped"
            case .kapali: return "off"
            }
        }
        var metin: String {
            switch self {
            case .eklendi(let h): return L("Eklendi: {0}", "\(h.description) · \(Bicim.tl(h.total))")
            case .bekliyor: return L("Onay bekliyor: Harcamalar'a bak")
            case .sirada: return L("Sıraya alındı")
            case .atlandi: return L("Harcama mesajı değil")
            case .kapali: return L("Banka mesajları bu hesapta kullanılamıyor")
            }
        }
    }

    private static let dosya = Depo.url("mesajlar.json")
    private static let d = UserDefaults.standard

    static func hepsi() -> [Satir] {
        guard let t = Depo.read(dosya), let s = try? JSONDecoder().decode([Satir].self, from: Data(t.utf8)) else { return [] }
        return s
    }

    private static func yaz(_ s: [Satir]) {
        guard !s.isEmpty else { Depo.remove(dosya); return }
        if let data = try? JSONEncoder().encode(s) { Depo.write(dosya, String(decoding: data, as: UTF8.self)) }
    }

    @discardableResult
    static func ekle(_ metin: String, ipucu: Ipucu?) -> Int {
        var s = hepsi()
        let id = min(-Int(Date().timeIntervalSince1970 * 1000), (s.map(\.id).min() ?? 0) - 1)
        s.append(Satir(id: id, body: metin, received_at: ISO8601DateFormatter().string(from: Date()), source: "sms", hint: ipucu))
        yaz(Array(s.suffix(100)))
        return id
    }

    // Örnek veri (Ornek.swift "-mesaj"): kuyruk bu mesajlarla değiştirilir; boşsa temizlenir
    static func ornek(_ metinler: [String]) {
        let simdi = ISO8601DateFormatter().string(from: Date())
        yaz(metinler.enumerated().map { Satir(id: -($0.offset + 1), body: $0.element, received_at: simdi, source: "sms", hint: nil) })
    }

    static func sil(_ ids: [Int]) {
        guard !ids.isEmpty else { return }
        yaz(hepsi().filter { !ids.contains($0.id) })
    }

    // Sunucudan gelen e-postaların (JSON dizi) sonuna telefondaki mesajlar eklenir (kopru.js setInbox'a verilen liste)
    static func birlestir(_ sunucu: String) -> String {
        let yerel = hepsi()
        guard !yerel.isEmpty, let data = try? JSONEncoder().encode(yerel),
              let ek = try? JSONSerialization.jsonObject(with: data) as? [Any] else { return sunucu }
        let bas = (try? JSONSerialization.jsonObject(with: Data(sunucu.utf8)) as? [Any]) ?? []
        guard let out = try? JSONSerialization.data(withJSONObject: bas + ek) else { return sunucu }
        return String(decoding: out, as: UTF8.self)
    }

    // Aynı mesaj ikinci kez gelirse (iki otomasyon aynı mesaja uyabilir) işlenmez. Metnin kendisi değil özeti saklanır.
    static func ilkKez(_ metin: String) -> Bool {
        let ozet = SHA256.hash(data: Data(metin.utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
        var once = d.stringArray(forKey: "mesaj.ozetler") ?? []
        if once.contains(ozet) { return false }
        once.append(ozet)
        d.set(Array(once.suffix(60)), forKey: "mesaj.ozetler")
        return true
    }

    // Son gelen mesajın zamanı ve sonucu (kurulum çalışıyor mu); metin saklanmaz
    static var son: (zaman: Date, kod: String)? {
        guard let k = d.string(forKey: "mesaj.son.kod") else { return nil }
        return (Date(timeIntervalSince1970: d.double(forKey: "mesaj.son.zaman")), k)
    }

    private static func kaydet(_ s: Sonuc, zeka: Bool = false) -> Sonuc {
        d.set(s.kod, forKey: "mesaj.son.kod")
        d.set(Date().timeIntervalSince1970, forKey: "mesaj.son.zaman")
        Analitik.olay("sms_received", ["result": s.kod, "ai": zeka])
        return s
    }

    // Kısayollar eyleminin girişi. Uygulama eylem için arka planda yeni açıldıysa model birazdan kurulur; kurulmadıysa
    // mesaj sıraya alınır ve uygulama açılınca işlenir (şifre mesajı sıraya da alınmaz).
    @MainActor
    static func geldi(_ ham: String) async -> Sonuc {
        let metin = ham.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !metin.isEmpty, metin.count <= 1600, ilkKez(metin) else { return kaydet(.atlandi) }
        var model = Model.ortak
        for _ in 0..<30 where model == nil {
            try? await Task.sleep(nanoseconds: 100_000_000)
            model = Model.ortak
        }
        guard let model else {
            let kucuk = metin.lowercased(with: Locale(identifier: "tr_TR"))
            if kucuk.contains("şifre") || kucuk.contains("sifre") || kucuk.contains("kodu") { return kaydet(.atlandi) }
            ekle(metin, ipucu: nil)
            return kaydet(.sirada)
        }
        let (sonuc, zeka) = await model.mesajGeldi(metin)
        return kaydet(sonuc, zeka: zeka)
    }
}

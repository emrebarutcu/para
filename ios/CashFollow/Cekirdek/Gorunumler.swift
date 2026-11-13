import Foundation

// Araçların cevapları (mcp/tools.js'teki görünümler). Yalnızca ekranların kullandığı alanlar; eksik alan boş sayılır.

struct Odeme: Decodable, Hashable { let date: String; let amount: Double }

struct Ozet: Decodable {
    struct Ay: Decodable { let month: String; let total: Double }
    struct Yaklasan: Decodable, Hashable {
        let date: String
        let card: String
        let total: Double
        let byPerson: [String: Double]?
        let covered: Double?
        let late: Bool?
    }
    struct Kisi: Decodable, Hashable { let name: String; let dueThisMonth: Double; let remaining: Double }
    struct Kart: Decodable, Hashable {
        let name: String
        let used: Double
        let available: Double?
        let nextPayment: Odeme?
        let autoPay: Bool?
        let unpaid: Double?
        let overdue: Double?
    }
    struct BorcOdemesi: Decodable, Hashable { let date: String; let description: String; let amount: Double; let asset: String; let late: Bool? }
    struct Borclar: Decodable { let dueThisMonth: Double?; let nextMonth: Double?; let upcoming: [BorcOdemesi]? }
    // Ayın ilerlemesi (icgoru.js progress): ödenen, kalan ve kalanların ilk günü; yalnızca içinde bulunulan ayda
    struct Ilerleme: Decodable, Hashable { let paid: Double; let left: Double; let next: String? }

    let today: String
    let month: String
    let dueThisMonth: Double
    let nextMonth: Ay
    let remainingTotal: Double
    let lastPaymentMonth: String?
    let endless: Bool?
    let lastInstallmentMonth: String?   // taksitlerin bittiği ay; süresiz tekrarlar (kira, abonelik) sayılmaz
    let progress: Ilerleme?
    let upcomingPayments: [Yaklasan]
    let people: [Kisi]
    let cards: [Kart]
    let debts: Borclar?
}

// Harcama formunun işyeri önerisi (icgoru.js merchants): önceki harcamanın adı, kartı (nil: nakit), taksit sayısı,
// kategorisi ve son tutarı
struct Isyeri: Decodable, Hashable, Identifiable {
    let desc: String
    let cardId: String?
    let count: Int
    let category: String?
    let personId: String
    let total: Double
    let uses: Int
    var id: String { desc }
}

// Son taksidi ödenen harcama (icgoru.js finishing): date son ödeme günü, monthly boşalan aylık tutar, freeFrom boşalan ilk ay
struct BitenTaksit: Decodable, Hashable, Identifiable {
    let id: String
    let desc: String
    let date: String
    let monthly: Double
    let count: Int
    let freeFrom: String
}

// Ay kapanışı (icgoru.js monthSummary): ayın ödemeleri, önceki ve sonraki ay, biten taksitler, o ayın harcaması ve kategorileri
struct AyOzeti: Decodable, Hashable, Identifiable {
    var id: String { month }
    struct Sonraki: Decodable, Hashable { let month: String; let total: Double }
    struct Kategori: Decodable, Hashable { let id: String; let name: String; let value: Double; let average: Double? }
    let month: String
    let paid: Double
    let previous: Double
    let next: Sonraki
    let finished: [BitenTaksit]
    let freed: Double
    let spent: Double
    let added: Int
    let top: Kategori?
    let rising: Kategori?
}

// Kartın sıradaki hesap kesimi (kopru.js cutoffs): o güne kadar alınan dueBefore'da, sonrası dueAfter'da ödenir
struct KesimGunu: Decodable, Hashable { let card: String; let cut: String; let dueBefore: String; let dueAfter: String }

struct KartListesi: Decodable { let cards: [KartGorunumu] }

// Döner kredi (elle ödenen, APR'li kart; borc.js revolve): devreden bakiye, işlemiş faiz, sıradaki ekstrenin ödenmemiş
// asgarisi ve yalnızca asgari ödenirse geri ödeme (monthsAtMinimum nil: 50 yılda bitmez)
struct DonerKredi: Decodable, Hashable {
    struct GeriOdeme: Decodable, Hashable { let monthsAtMinimum: Int?; let interestAtMinimum: Double; let monthlyToClearIn12: Double }
    let apr: Double
    let carried: Double
    let interestCharged: Double
    let minimumDue: Double
    let payoff: GeriOdeme?
}

// Kartın sıradaki ekstresi: amount ödenecek (ödenmemiş) kısım; döner kredide bakiye (devreden ve faiz dahil), asgari, faiz
struct KartEkstresi: Decodable, Hashable {
    let date: String
    let amount: Double
    let alreadyCut: Bool?
    let balance: Double?
    let minimum: Double?
    let interest: Double?
    let carriedIn: Double?
}

struct KartGorunumu: Decodable, Identifiable, Hashable {
    struct Bugun: Decodable, Hashable { let statementCutoff: String; let dueDate: String }
    struct Takip: Decodable, Hashable {
        let since: String; let autoPay: Bool; let unpaid: Double; let overdue: Double
        let manualSince: String?
        let revolving: DonerKredi?
    }
    let id: String
    let name: String
    let last4: String?
    let limit: Double
    let used: Double
    let available: Double?
    let cutoffDay: Int
    let dueDay: Int
    let nextPayment: Odeme?
    let purchaseCount: Int
    let purchaseToday: Bugun
    let tracking: Takip?
    let apr: Double?
    let bonusMonths: [Int]?     // bonus ödemesinin ayları [yaz, kış] (Japonya); yoksa varsayılan [8, 1]
    let statement: KartEkstresi?
}

struct HarcamaListesi: Decodable { let count: Int; let purchases: [Harcama] }

struct Harcama: Decodable, Identifiable, Hashable {
    struct Taksit: Decodable, Hashable { let no: Int; let date: String; let amount: Double; let paid: Bool; let bonus: String? }   // bonus: summer | winter
    struct Tekrar: Decodable, Hashable { let label: String?; let nextDate: String? }
    let id: String
    let description: String
    let person: String
    let personId: String
    let card: String
    let cardId: String?
    let date: String?
    let total: Double
    let installments: Int
    let perInstallment: Double
    let paidInstallments: Int
    let remainingInstallments: Int
    let remainingAmount: Double
    let nextPayment: Odeme?
    let lastPaymentDate: String?
    let status: String
    let category: String?
    let categoryName: String?
    let asset: String
    let statementCutoff: String?
    let `repeat`: Tekrar?
    let payments: [Taksit]?
    let bnpl: SimdiAl?
    let bonus: BonusOdemesi?
}

// Kartın dönem dönem harcamaları (card_statements): yeniden eskiye; ilki bugünün dönemi
struct KartDonemleri: Decodable {
    struct Kalem: Decodable, Identifiable, Hashable {
        let id: String              // harcamanın kimliği (tekrarlayanda her tekrar aynı)
        let description: String
        let person: String
        let personId: String
        let date: String            // dönemdeki tarihi (tekrarda o tekrarın)
        let amount: Double          // tam fiyatı
        let asset: String
        let installments: Int
        let categoryName: String?
        let `repeat`: Harcama.Tekrar?
        let bnpl: SimdiAl?
        let bonus: BonusOdemesi?
    }
    struct Donem: Decodable, Identifiable, Hashable {
        let from: String
        let cut: String
        let due: String
        let current: Bool
        let spent: Double
        let statementAmount: Double
        let count: Int
        let purchases: [Kalem]
        var id: String { cut }
    }
    let periods: [Donem]
}

// Şimdi al sonra öde (Pay in 4; taksit.js bnpl): sağlayıcı, ödeme sayısı, çekilenler, sağlayıcıya kalan, sıradaki çekim
struct SimdiAl: Decodable, Hashable {
    let provider: String
    let name: String
    let payments: Int
    let paid: Int
    let firstPayment: Double
    let perPayment: Double
    let owedToProvider: Double
    let nextCharge: Odeme?
}

// Bonus ödemesi (Japonya, ボーナス払い; taksit.js bonus): 1 ya da 2 bonus, adı ("Yaz bonusu"…), ödemeler
struct BonusOdemesi: Decodable, Hashable {
    struct Odemesi: Decodable, Hashable { let date: String; let amount: Double; let season: String?; let paid: Bool }
    let payments: Int
    let name: String
    let months: [Int]
    let schedule: [Odemesi]
}

struct HarcamaSonucu: Decodable {
    struct Onizleme: Decodable { let perInstallment: Double?; let firstPayment: String?; let lastPayment: String?; let statementCutoff: String? }
    let saved: Bool
    let purchase: Harcama
    let preview: Onizleme?
}

struct Varliklar: Decodable {
    struct Bakiye: Decodable, Hashable { let asset: String; let name: String; let balance: Double; let tryValue: Double? }
    struct Pozisyon: Decodable, Hashable {
        let asset: String
        let type: String
        let ticker: String
        let name: String?
        let units: Double
        let price: Double?
        let tryValue: Double?
        let profitTry: Double?
        let profitPct: Double?
        let dayChangePct: Double?
    }
    // Kurlar: varlık kodu → bir biriminin ana para birimi karşılığı; updatedAt, source
    struct Kurlar: Decodable {
        let values: [String: Double]
        let updatedAt: String?
        private struct Anahtar: CodingKey {
            var stringValue: String
            init?(stringValue: String) { self.stringValue = stringValue }
            var intValue: Int? { nil }
            init?(intValue: Int) { nil }
        }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Anahtar.self)
            var v: [String: Double] = [:]
            var at: String?
            for k in c.allKeys {
                if k.stringValue == "updatedAt" { at = try? c.decode(String.self, forKey: k) }
                else if let d = try? c.decode(Double.self, forKey: k) { v[k.stringValue] = d }
            }
            values = v
            updatedAt = at
        }
    }
    let currency: String?
    let assets: [Bakiye]
    let holdings: [Pozisyon]
    let totalTry: Double
    let receivablesTry: Double
    let debtsTry: Double
    let totalAssetsTry: Double
    let netWorthTry: Double
    let rates: Kurlar?
    let ratesError: String?
    let pricesError: String?
}

struct HareketListesi: Decodable { let count: Int; let entries: [Hareket] }

struct Hareket: Decodable, Identifiable, Hashable {
    struct Tekrar: Decodable, Hashable { let label: String?; let nextDate: String? }
    let id: String
    let date: String
    let description: String
    let asset: String
    let direction: String
    let amount: Double
    let tryValueNow: Double?
    let person: String
    let price: Double?
    let settledInTry: Bool?
    let `repeat`: Tekrar?
}

struct KisiListesi: Decodable { let people: [Kisi] }

struct Kisi: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let purchaseCount: Int
    let dueThisMonth: Double
    let remaining: Double
    let owesUser: Double?
}

// ── Grafikler (nakit.js: web'deki Nakit ve Varlığın seyri) ─────────────────────

struct NakitSerisi: Decodable {
    struct Hareket: Decodable, Hashable { let desc: String; let value: Double }
    struct Gun: Decodable, Identifiable, Hashable {
        let date: String
        let balance: Double
        let net: Double
        let moves: [Hareket]
        var id: String { date }
    }
    let from: String
    let to: String
    let today: String
    let days: [Gun]
    let before: Double
    let inSum: Double
    let outSum: Double
    let any: Bool
    let missing: [String]
}

struct VarlikSerisi: Decodable {
    struct Parca: Decodable, Hashable { let lira: Double; let fx: Double; let market: Double; let receivable: Double }
    struct Nokta: Decodable, Identifiable, Hashable {
        let date: String
        let value: Double
        let parts: Parca
        var id: String { date }
    }
    let span: Int
    let codes: [String]
    let points: [Nokta]
    let approx: [String]
    let missing: [String]
}

// ── Akış (get_cashflow) ──────────────────────────────────────────────────────

struct Akis: Decodable {
    struct Kalem: Decodable, Hashable { let purchaseId: String; let description: String; let person: String; let installment: String; let amount: Double }
    struct Odeme: Decodable, Hashable {
        let date: String
        let card: String
        let total: Double
        let byPerson: [String: Double]?
        let items: [Kalem]?
        let notCounted: Bool?
        let interest: Double?      // döner kredi: ekstreye eklenen faiz, devreden bakiye, sonrakine devreden
        let carriedIn: Double?
        let carriedOut: Double?
    }
    struct Ay: Decodable, Identifiable, Hashable {
        let month: String
        let total: Double
        let byPerson: [String: Double]
        let byCard: [String: Double]
        let payments: [Odeme]
        var id: String { month }
    }
    let months: [Ay]
}

// ── İçgörüler (get_insights) ve kategoriler (spending_by_category) ─────────────

struct Icgoruler: Decodable {
    struct Icgoru: Decodable, Identifiable, Hashable {
        let id: String
        let tone: String?
        let title: String
        let text: String
        let free: Bool?   // Premium istemez (serbest nakit, son taksit, bugünün kartı; icgoru.js FREE)
    }
    // Özet'in tepesindeki tek satır (icgoru.js headline): ay sonunda kalan serbest nakit ya da bugünün kartı
    struct Tepe: Decodable, Hashable {
        let id: String
        let tone: String?
        let title: String
        let text: String
    }
    let insights: [Icgoru]
    let headline: Tepe?
}

struct KategoriHarcamasi: Decodable {
    struct Kategori: Decodable, Hashable {
        let category: String?
        let name: String
        let amount: Double
        let share: Double
        let previous3MonthAverage: Double?
    }
    struct Ay: Decodable, Identifiable, Hashable {
        let month: String
        let total: Double
        let categories: [Kategori]
        var id: String { month }
    }
    let months: [Ay]
}

// ── Borçlar (list_debts) ─────────────────────────────────────────────────────

struct Borclar: Decodable {
    struct Toplamlar: Decodable {
        let receivablesTry: Double
        let debtsTry: Double
        let totalAssetsTry: Double
        let netWorthTry: Double
    }
    struct Ekstre: Decodable, Hashable { let date: String; let amount: Double; let alreadyCut: Bool? }
    struct KartBorcu: Decodable, Identifiable, Hashable {
        let cardId: String
        let card: String
        let tracked: Bool
        let debt: Double
        let statement: Ekstre?
        let byPerson: [String: Double]?
        let autoPay: Bool?
        let unpaid: Double?
        let overdue: Double?
        let revolving: DonerKredi?
        var id: String { cardId }
    }
    struct Pay: Decodable, Identifiable, Hashable {
        let person: String
        let personId: String
        let owed: Double
        var id: String { personId }
    }
    struct Sonraki: Decodable, Hashable { let date: String; let amount: Double; let installment: String? }
    struct Odeme: Decodable, Identifiable, Hashable { let id: String; let date: String; let amount: Double }
    struct Kayit: Decodable, Identifiable, Hashable {
        let id: String
        let type: String           // borrowed, lent, loan
        let side: String           // debt, receivable
        let party: String?
        let description: String?
        let person: String
        let asset: String
        let total: Double
        let principal: Double?
        let date: String
        let started: Bool?
        let dueDate: String?
        let installments: Int?
        let perInstallment: Double?
        let autoPay: Bool?
        let paid: Double
        let remaining: Double
        let remainingTry: Double?
        let overdue: Double?
        let overdueSince: String?
        let nextPayment: Sonraki?
        let closed: String?
        let status: String
        let payments: [Odeme]?
    }
    // Şimdi al sonra öde: sağlayıcıya kalan (henüz çekilmemiş ödemeler)
    struct SimdiAlBorcu: Decodable, Identifiable, Hashable {
        let purchaseId: String
        let description: String
        let name: String
        let card: String
        let remaining: Double
        let paid: Int
        let payments: Int
        let nextCharge: Sonraki     // Borclar.Odeme (kaydedilen ödeme) değil: tarih ve tutar
        var id: String { purchaseId }
    }
    let totals: Toplamlar
    let cards: [KartBorcu]
    let shares: [Pay]?
    let debts: [Kayit]
    let bnpl: [SimdiAlBorcu]?
}

// ── Alabilir miyim? (simulate_purchase) ───────────────────────────────────────

struct Simulasyon: Decodable {
    struct Ay: Decodable, Hashable {
        let month: String
        let paymentsBefore: Double
        let paymentsAfter: Double
        let freeCashBefore: Double
        let freeCashAfter: Double
    }
    struct KartSonucu: Decodable { let name: String; let limit: Double; let usedAfter: Double; let availableAfter: Double? }
    struct Karsilastirma: Decodable, Hashable { let card: String; let firstPayment: String; let daysUntilFirstPayment: Int; let available: Double? }
    let purchase: Harcama
    let months: [Ay]
    let card: KartSonucu?
    let cardsCompared: [Karsilastirma]
}

// Banka e-postaları (list_inbox, check_inbox)
struct EpostaListesi: Decodable {
    let emails: [Eposta]
    let lastEmail: SonEposta?
}
struct EpostaSonucu: Decodable {
    let added: [Harcama]
    let tests: Int?   // gelen deneme e-postası (Banka e-postaları → Deneme e-postası gönder)
}

// Kutuya gelen son e-posta (işlenmiş olsa da): kurulum çalışıyor mu. kind: purchase, verification, test, other
struct SonEposta: Decodable, Hashable {
    let receivedAt: String
    let sender: String?
    let kind: String
    let processed: Bool
}

struct Eposta: Decodable, Identifiable, Hashable {
    struct Okunan: Decodable, Hashable {
        let amount: Double?
        let currency: String?
        let date: String?
        let installments: Int?
        let merchant: String?
        let cardLast4: String?
    }
    let emailId: Int
    let sender: String?
    let subject: String?
    let parsed: Okunan
    // Gmail yönlendirme onayı ya da bankanın adres doğrulaması (kind verification): bağlantıyla onaylanır, harcama değildir
    struct Dogrulama: Decodable, Hashable {
        let gmail: Bool
        let code: String?
        let link: String?
        let from: String?
    }
    let kind: String?          // purchase, verification, test (eposta.js kind)
    let verification: Dogrulama?
    let matchedCard: String?
    let needsReview: String?   // neden kendiliğinden eklenemedi (eposta.js / tools.js emailItem)
    let body: String?
    var id: Int { emailId }
}

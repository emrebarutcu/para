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
    struct Borclar: Decodable { let dueThisMonth: Double?; let nextMonth: Double? }

    let today: String
    let month: String
    let dueThisMonth: Double
    let nextMonth: Ay
    let remainingTotal: Double
    let lastPaymentMonth: String?
    let endless: Bool?
    let upcomingPayments: [Yaklasan]
    let people: [Kisi]
    let cards: [Kart]
    let debts: Borclar?
}

struct KartListesi: Decodable { let cards: [KartGorunumu] }

struct KartGorunumu: Decodable, Identifiable, Hashable {
    struct Bugun: Decodable, Hashable { let statementCutoff: String; let dueDate: String }
    struct Takip: Decodable, Hashable { let since: String; let autoPay: Bool; let unpaid: Double; let overdue: Double }
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
}

struct HarcamaListesi: Decodable { let count: Int; let purchases: [Harcama] }

struct Harcama: Decodable, Identifiable, Hashable {
    struct Taksit: Decodable, Hashable { let no: Int; let date: String; let amount: Double; let paid: Bool }
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
    struct Kurlar: Decodable { let USD: Double?; let EUR: Double?; let GAU: Double?; let updatedAt: String? }
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

import SwiftUI

// Harcamaları sıralama ve süzme: Harcamalar'daki filtre düğmesiyle alttan açılır. Sıralama ve yönü (list_purchases
// sort, order), kart, tür (taksitli, tek çekim, tekrarlayan, Pay in 4) ve kategori. Sıralama hatırlanır, süzgeçler
// uygulama açıkken kalır.
struct HarcamaFiltresi: View {
    @EnvironmentObject private var model: Model
    @Environment(\.dismiss) private var dismiss
    @Binding var sirala: String
    @Binding var yon: String
    @Binding var kart: String?          // kartın kimliği ya da "nakit"
    @Binding var tur: String?
    @Binding var kategori: KategoriSecimi?

    static let siralamalar = [
        ("next_payment", L("Sıradaki ödeme")), ("added", L("Eklenme")), ("date", L("Alışveriş tarihi")), ("amount", L("Tutar")),
    ]
    static func varsayilanYon(_ s: String) -> String { s == "next_payment" ? "asc" : "desc" }

    // Yönün adı sıralamaya göre: sıradaki ödemede yakın / uzak, tutarda büyük / küçük, tarihlerde yeni / eski
    static func yonler(_ s: String) -> [(String, String)] {
        switch s {
        case "next_payment": return [("asc", L("En yakın önce")), ("desc", L("En uzak önce"))]
        case "amount": return [("desc", L("Büyükten küçüğe")), ("asc", L("Küçükten büyüğe"))]
        default: return [("desc", L("Yeniden eskiye")), ("asc", L("Eskiden yeniye"))]
        }
    }

    // Seçili süzgeçlerin kısa adı (listenin üstünde): "Bonus · Taksitli · Market"
    static func turAdi(_ t: String) -> String {
        switch t {
        case "installment": return L("Taksitli")
        case "single": return L("Tek çekim")
        case "repeat": return L("Tekrarlayan")
        default: return "Pay in 4"
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    bolum(L("Sırala")) {
                        Akan(aralik: 8, satirAraligi: 8) {
                            ForEach(Self.siralamalar, id: \.0) { id, ad in
                                Cip(ad: ad, secili: sirala == id) { sirala = id; yon = Self.varsayilanYon(id) }
                            }
                        }
                        Secici(secim: $yon, ogeler: Self.yonler(sirala))
                    }
                    bolum(L("Kart")) {
                        Okunan(tool: "list_cards") { (l: KartListesi) in
                            Akan(aralik: 8, satirAraligi: 8) {
                                Cip(ad: L("Tümü"), secili: kart == nil) { kart = nil }
                                ForEach(l.cards) { c in
                                    Cip(ad: c.name, renk: model.kartRengi(c.id), secili: kart == c.id) { kart = c.id }
                                }
                                Cip(ad: L("Nakit"), renk: Tema.nakit, secili: kart == "nakit") { kart = "nakit" }
                            }
                        }
                    }
                    bolum(L("Tür")) {
                        Akan(aralik: 8, satirAraligi: 8) {
                            Cip(ad: L("Tümü"), secili: tur == nil) { tur = nil }
                            ForEach(["installment", "single", "repeat"] + (model.constants?.bnpl == true ? ["bnpl"] : []), id: \.self) { t in
                                Cip(ad: Self.turAdi(t), secili: tur == t) { tur = t }
                            }
                        }
                    }
                    bolum(L("Kategori")) {
                        Akan(aralik: 8, satirAraligi: 8) {
                            Cip(ad: L("Tümü"), secili: kategori == nil) { kategori = nil }
                            ForEach(model.constants?.categories ?? []) { k in
                                Cip(ad: k.name, secili: kategori?.id == k.id) { kategori = KategoriSecimi(id: k.id, ad: k.name) }
                            }
                            Cip(ad: L("Kategorisiz"), secili: kategori != nil && kategori?.id == nil) {
                                kategori = KategoriSecimi(id: nil, ad: L("Kategorisiz"))
                            }
                        }
                    }
                }
                .padding(16)
            }
            .background(Tema.zemin)
            .navigationTitle(L("Sırala ve süz"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L("Sıfırla")) {
                        sirala = "next_payment"; yon = "asc"; kart = nil; tur = nil; kategori = nil
                    }
                }
                ToolbarItem(placement: .confirmationAction) { Button(L("Bitti")) { dismiss() } }
            }
        }
        // Neredeyse tam ekran açılır; üstte arkadaki listenin bir şeridi görünür kalır
        .presentationDetents([.fraction(0.88)])
        .presentationDragIndicator(.visible)
    }

    private func bolum<C: View>(_ baslik: String, @ViewBuilder _ icerik: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(baslik).font(.footnote.weight(.semibold)).foregroundStyle(Tema.metin3).textCase(.uppercase)
            icerik()
        }
    }
}

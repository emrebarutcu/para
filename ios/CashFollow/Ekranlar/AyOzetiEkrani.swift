import SwiftUI

// Ay kapanışı: geçen ayın bir ekranlık özeti (icgoru.js monthSummary). Ödenen toplam ve önceki aya göre farkı, biten
// taksitler ve boşalan aylık tutar, gelecek ay, ay içinde yapılan harcama ve öne çıkan kategori. Özet'teki karttan
// (ayın ilk on günü) ve ayın ilk günü gelen bildirimden açılır. "Paylaş" kartın görüntüsünü paylaşır: tutarlar
// görünür, neyi kiminle paylaşacağını kullanıcı seçer; uygulama hiçbir yere göndermez.
struct AyOzetiEkrani: View {
    @Environment(\.dismiss) private var dismiss
    let ozet: AyOzeti
    var kapat: (() -> Void)? = nil
    @State private var goruntu: Image?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    AyOzetiKarti(ozet: ozet)
                    if let g = goruntu {
                        ShareLink(item: g, preview: SharePreview(L("{0} özeti", Self.ayAdi(ozet.month)), image: g)) {
                            Label(L("Paylaş"), systemImage: "square.and.arrow.up")
                                .font(.body.weight(.semibold)).foregroundStyle(Tema.metin)
                                .frame(maxWidth: .infinity).padding(.vertical, 14)
                                .background(Tema.yuzey, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .simultaneousGesture(TapGesture().onEnded { Analitik.olay("month_summary_shared") })
                    }
                }
                .padding(16)
            }
            .background(Tema.zemin)
            .navigationTitle(L("{0} özeti", Self.ayAdi(ozet.month)))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(L("Bitti")) { kapat?(); dismiss() }.fontWeight(.semibold) }
            }
            .task { goruntu = Self.resim(ozet) }
        }
    }

    // "2026-10" → "Ekim" (yalnızca ayın adı, uygulamanın dilinde: "October", "10月", "10월")
    static func ayAdi(_ ym: String) -> String {
        Bicim.date(ym + "-01").map { $0.formatted(Bicim.tarih.month(.wide)) } ?? ""
    }

    // Kart ve bildirim için tek satır: "₺10.200 ödedin · 1 taksit bitti"
    static func tekSatir(_ o: AyOzeti) -> String {
        var p = [L("{0} ödedin", Bicim.tl(o.paid, fraction: false))]
        if !o.finished.isEmpty { p.append(L("{0} taksit bitti", o.finished.count)) }
        return p.joined(separator: " · ")
    }

    // Paylaşılacak görüntü: kartın kendisi, sayfa zemininde (ekrandan bağımsız çizilir)
    @MainActor private static func resim(_ o: AyOzeti) -> Image? {
        let r = ImageRenderer(content: AyOzetiKarti(ozet: o, imza: true).frame(width: 360).padding(16).background(Tema.zemin))
        r.scale = 3
        return r.uiImage.map { Image(uiImage: $0) }
    }
}

// Özetin kartı (sayfada ve paylaşılan görüntüde aynı; ortam nesnesi kullanmaz: ImageRenderer ile de çizilir)
struct AyOzetiKarti: View {
    let ozet: AyOzeti
    var imza = false   // paylaşılan görüntüde altta uygulamanın adı

    var body: some View {
        let fark = ozet.paid - ozet.previous
        Kart {
            HStack {
                Text(L("{0} özeti", AyOzetiEkrani.ayAdi(ozet.month))).font(.subheadline.weight(.semibold)).foregroundStyle(Tema.metin)
                Spacer()
                Text(L("Ödenen")).font(.subheadline).foregroundStyle(Tema.metin2)
            }
            BuyukTutar(deger: ozet.paid, boyut: 40)
            if ozet.previous > 0.004, abs(fark) >= 1 {
                Label(fark < 0 ? L("Önceki aydan {0} az", Bicim.tl(-fark, fraction: false)) : L("Önceki aydan {0} fazla", Bicim.tl(fark, fraction: false)),
                      systemImage: fark < 0 ? "arrow.down" : "arrow.up")
                    .labelStyle(.titleAndIcon)
                    .font(.footnote.weight(.semibold)).monospacedDigit()
                    .foregroundStyle(fark < 0 ? Tema.iyi : Tema.metin3)
            }
            if !ozet.finished.isEmpty {
                Ayirici()
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "checkmark.seal.fill").foregroundStyle(Tema.iyi)
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(ozet.finished.prefix(4)) { b in
                            Text(L("{0} bitti", b.desc)).font(.subheadline.weight(.semibold)).foregroundStyle(Tema.metin).lineLimit(1)
                        }
                        if ozet.finished.count > 4 {
                            Text(L("ve {0} taksit daha", ozet.finished.count - 4)).font(.footnote).foregroundStyle(Tema.metin3)
                        }
                        Text(L("Ayda {0} boşaldı", Bicim.tl(ozet.freed, fraction: false))).font(.footnote).foregroundStyle(Tema.iyi).monospacedDigit()
                    }
                }
            }
            Ayirici()
            VStack(spacing: 8) {
                // Özet geçen ayındır: "gelecek ay" demek içinde bulunulan ayı karıştırır; ayın adıyla yazılır ("Kasım ödemesi")
                Satir(title: L("{0} ödemesi", AyOzetiEkrani.ayAdi(ozet.next.month)), value: Bicim.tl(ozet.next.total, fraction: false))
                if ozet.spent > 0.004 {
                    Satir(title: L("Ay içinde harcanan"), value: Bicim.tl(ozet.spent, fraction: false))
                }
                if let k = ozet.rising, let ort = k.average {
                    Satir(title: L("{0} harcaman arttı", k.name), value: Bicim.isaret("+", Bicim.tl(k.value - ort, fraction: false)), color: Tema.uyari)
                } else if let k = ozet.top {
                    Satir(title: L("En çok: {0}", k.name), value: Bicim.tl(k.value, fraction: false))
                }
            }
            .font(.subheadline)
            if imza {
                Text("CashFollow").font(.caption.weight(.semibold)).foregroundStyle(Tema.metin3).frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
    }
}

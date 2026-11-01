import SwiftUI

// Borçlar: kartlar (limit, ekstre), kart payları, kişilerle borç / alacak ve krediler (list_debts, list_cards; web'deki
// Kartlar ve Borçlar sekmeleri). Ödeme pay_debt ile kaydedilir, borç add_debt ile eklenir.
struct BorclarEkrani: View {
    @EnvironmentObject private var model: Model
    @State private var kartEkle = false
    @State private var kartDuzenle: KartGorunumu?
    @State private var kartDetay: KartGorunumu?
    @State private var kartSil: KartGorunumu?
    @State private var borcEkle = false
    @State private var secili: Borclar.Kayit?
    @State private var odeme: OdemeHedefi?
    @State private var kapananlar = false
    @State private var hata: String?

    @State private var taraf = "debt"

    var body: some View {
        NavigationStack {
            Okunan(tool: "list_debts", args: ["status": kapananlar ? "all" : "open"], key: "\(kapananlar)") { (b: Borclar) in
                Sayfa {
                    Kart {
                        Text("Toplam borç").font(.subheadline).foregroundStyle(Tema.metin2)
                        BuyukTutar(deger: b.totals.debtsTry)
                        Ayirici()
                        IstatistikSatiri(ogeler: [
                            Istatistik(etiket: "Alacak", deger: Bicim.tl(b.totals.receivablesTry), renk: b.totals.receivablesTry > 0 ? Tema.iyi : Tema.metin),
                            Istatistik(etiket: "Net varlık", deger: Bicim.tl(b.totals.netWorthTry)),
                        ])
                    }

                    Okunan(tool: "list_cards") { (l: KartListesi) in
                        Kart(dolgu: 14) {
                            KartBasligi(baslik: "Kartlar") {
                                Button { kartEkle = true } label: { Label("Ekle", systemImage: "plus") }
                                    .font(.subheadline.weight(.medium)).foregroundStyle(Tema.metin2)
                            }
                            if l.cards.isEmpty {
                                Text("Kesim ve son ödeme gününü girince taksitlerin hangi ay ödeneceği hesaplanır.")
                                    .font(.subheadline).foregroundStyle(Tema.metin3)
                            }
                            SatirListesi(veri: l.cards) { c in
                                let borc = b.cards.first { $0.cardId == c.id }
                                KartSatiri(c: c, borc: borc,
                                           ac: { kartDetay = c },
                                           odendi: { odeme = .kart(id: c.id, ad: c.name, tutar: borc?.unpaid ?? 0) })
                            }
                        }
                    }

                    let paylar = (b.shares ?? []).filter { abs($0.owed) > 0.004 }
                    if !paylar.isEmpty {
                        Kart(dolgu: 14) {
                            KartBasligi("Kart payları")
                            SatirListesi(veri: paylar) { p in
                                Button { odeme = .pay(id: p.personId, ad: p.person, tutar: max(p.owed, 0)) } label: {
                                    HStack(spacing: 12) {
                                        Avatar(ad: p.person, renk: model.kisiRengi(p.personId))
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(p.person).font(.body.weight(.semibold))
                                            Text(p.owed > 0 ? "sana borçlu · dokun, ödediğinde kaydet" : "ödendi").font(.footnote).foregroundStyle(Tema.metin3)
                                        }
                                        Spacer()
                                        Text(Bicim.tl(p.owed)).font(.body.weight(.semibold)).monospacedDigit()
                                            .foregroundStyle(p.owed > 0 ? Tema.iyi : Tema.metin3)
                                    }
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                            Text("Diğer kişilerin takipteki kartlardaki harcamaları sana borçtur.").font(.footnote).foregroundStyle(Tema.metin3)
                        }
                    }

                    let borclar = b.debts.filter { $0.side == "debt" }
                    let alacaklar = b.debts.filter { $0.side == "receivable" }
                    Secici(secim: $taraf, ogeler: [("debt", "Borçlarım (\(borclar.count))"), ("receivable", "Alacaklarım (\(alacaklar.count))")])
                    let liste = taraf == "debt" ? borclar : alacaklar
                    Kart(dolgu: 14) {
                        if liste.isEmpty {
                            Text(taraf == "debt" ? "Kayıtlı borç ya da kredi yok" : "Kayıtlı alacak yok").foregroundStyle(Tema.metin3)
                        }
                        SatirListesi(veri: liste) { d in
                            Button { secili = d } label: { BorcSatiri(d: d) }.buttonStyle(.plain)
                        }
                        Ayirici()
                        Toggle("Kapananları da göster", isOn: $kapananlar).font(.subheadline).tint(Tema.metin)
                        HataMetni(text: hata)
                    }
                }
            }
            .navigationTitle("Borçlar")
            .sayfaZemini()
            .yenilenebilir(model)
            .overlay(alignment: .bottomTrailing) {
                Menu {
                    Button { borcEkle = true } label: { Label("Borç, alacak ya da kredi", systemImage: "arrow.left.arrow.right") }
                    Button { kartEkle = true } label: { Label("Kart", systemImage: "creditcard") }
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 24, weight: .medium))
                        .foregroundStyle(Tema.ustMetin)
                        .frame(width: 58, height: 58)
                        .background(Tema.metin, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .shadow(color: .black.opacity(0.22), radius: 12, y: 6)
                }
                .accessibilityLabel("Ekle")
                .padding(.trailing, 18)
                .padding(.bottom, 14)
            }
            .sheet(isPresented: $kartEkle) { KartFormu(card: nil) }
            .sheet(item: $kartDuzenle) { KartFormu(card: $0) }
            .sheet(item: $kartDetay) { c in
                KartDetayi(c: c,
                           duzenle: { kartDetay = nil; DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { kartDuzenle = c } },
                           sil: { kartDetay = nil; DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { kartSil = c } },
                           odendi: { t in kartDetay = nil; DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { odeme = .kart(id: c.id, ad: c.name, tutar: t) } })
            }
            .sheet(isPresented: $borcEkle) { BorcFormu() }
            .sheet(item: $secili) { BorcDetayi(d: $0) }
            .sheet(item: $odeme) { OdemeFormu(hedef: $0) }
            .confirmationDialog(kartSil.map { k in k.purchaseCount > 0 ? "\(k.name) ve \(k.purchaseCount) harcaması silinsin mi?" : "\(k.name) silinsin mi?" } ?? "",
                                isPresented: Binding(get: { kartSil != nil }, set: { if !$0 { kartSil = nil } }), titleVisibility: .visible) {
                Button("Sil", role: .destructive) {
                    if let c = kartSil {
                        do { try model.write("delete_card", ["card": c.id]); hata = nil } catch { hata = error.localizedDescription }
                    }
                    kartSil = nil
                }
            } message: {
                Text("Karttaki bütün harcamalar ve kaydedilen ekstre ödemeleri de silinir.")
            }
        }
    }
}

private func borcTuru(_ type: String) -> String {
    switch type {
    case "loan": return "Kredi"
    case "borrowed": return "Borç aldım"
    default: return "Borç verdim"
    }
}

struct BorcSatiri: View {
    let d: Borclar.Kayit

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: d.type == "loan" ? "building.columns" : "arrow.left.arrow.right")
                .font(.subheadline).foregroundStyle(Tema.metin2)
                .frame(width: 36, height: 36)
                .background(Tema.yuzey2, in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text(d.party?.isEmpty == false ? d.party! : borcTuru(d.type)).font(.body.weight(.semibold)).foregroundStyle(Tema.metin)
                Text(alt).font(.footnote).foregroundStyle((d.overdue ?? 0) > 0.004 ? Tema.tehlike : Tema.metin3)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                Text(Bicim.amount(d.remaining, asset: d.asset)).font(.body.weight(.semibold)).monospacedDigit()
                    .foregroundStyle(d.status == "open" ? (d.side == "debt" ? Tema.tehlike : Tema.iyi) : Tema.metin3)
                if d.status != "open" { Text("kapandı").font(.caption2).foregroundStyle(Tema.metin3) }
            }
        }
        .contentShape(Rectangle())
    }

    private var alt: String {
        var parts = [borcTuru(d.type)]
        if let o = d.overdue, o > 0.004 {
            parts.append("\(Bicim.amount(o, asset: d.asset)) gecikti")
        } else if let n = d.nextPayment {
            parts.append("\(Bicim.day(n.date)): \(Bicim.amount(n.amount, asset: d.asset))" + (n.installment.map { " (\($0))" } ?? ""))
        } else if d.started == false {
            parts.append("\(Bicim.day(d.date)) başlıyor")
        }
        return parts.joined(separator: " · ")
    }
}

// Borcun ayrıntısı: ödemeler, ödeme kaydı, silme (pay_debt, delete_debt)
struct BorcDetayi: View {
    @EnvironmentObject private var model: Model
    @Environment(\.dismiss) private var dismiss
    let d: Borclar.Kayit
    @State private var tutar = ""
    @State private var tarih = Date()
    @State private var kapat = false
    @State private var sil = false
    @State private var hata: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Satir(title: "Tür", value: borcTuru(d.type))
                    if let p = d.party, !p.isEmpty { Satir(title: d.type == "loan" ? "Banka" : "Kim", value: p) }
                    if let a = d.description, !a.isEmpty { Satir(title: "Not", value: a) }
                    Satir(title: "Kişi", value: d.person)
                    Satir(title: "Başlangıç", value: Bicim.day(d.date))
                    Satir(title: "Toplam", value: Bicim.amount(d.total, asset: d.asset))
                    if let p = d.principal, p > 0, d.type == "loan" { Satir(title: "Çekilen", value: Bicim.amount(p, asset: d.asset)) }
                    if let n = d.installments, n > 1, let per = d.perInstallment {
                        Satir(title: "Taksit", value: "\(n) × \(Bicim.amount(per, asset: d.asset))")
                    }
                    if let v = d.dueDate { Satir(title: n1 ? "Vade" : "İlk taksit", value: Bicim.day(v)) }
                    Satir(title: "Ödenen", value: Bicim.amount(d.paid, asset: d.asset))
                    Satir(title: "Kalan", value: Bicim.amount(d.remaining, asset: d.asset), color: d.side == "debt" ? Renk.gider : Renk.gelir)
                    if let o = d.overdue, o > 0.004 {
                        Satir(title: "Geciken", value: Bicim.amount(o, asset: d.asset), color: Renk.gider)
                    }
                    Satir(title: "Ödeme", value: d.autoPay == true ? "Otomatik (tarihinde ödenmiş sayılır)" : "Elle (Ödendi ile)")
                }
                if let list = d.payments, !list.isEmpty {
                    Section("Ödemeler") {
                        ForEach(list) { p in
                            HStack {
                                Text(Bicim.day(p.date))
                                Spacer()
                                Text(Bicim.amount(p.amount, asset: d.asset)).monospacedDigit()
                            }
                        }
                    }
                }
                if d.status == "open" {
                    Section {
                        TextField("Tutar", text: $tutar).keyboardType(.decimalPad)
                        DatePicker("Tarih", selection: $tarih, in: ...Date(), displayedComponents: .date).environment(\.locale, Bicim.locale)
                        Toggle("Kalanı kapat (artık beklenmiyor)", isOn: $kapat)
                        Button(d.side == "debt" ? "Ödemeyi kaydet" : "Tahsilatı kaydet") { kaydet() }
                            .disabled((Bicim.parse(tutar) ?? 0) <= 0)
                    } header: { Text(d.side == "debt" ? "Ödeme yaptım" : "Ödeme aldım") }
                }
                HataMetni(text: hata)
                Section { Button("Kaydı sil", role: .destructive) { sil = true } }
            }
            .navigationTitle(d.party?.isEmpty == false ? d.party! : borcTuru(d.type))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Kapat") { dismiss() } } }
            .onAppear {
                let x = d.overdue.flatMap { $0 > 0.004 ? $0 : nil } ?? d.nextPayment?.amount ?? d.remaining
                tutar = x > 0 ? x.formatted(.number.locale(Bicim.locale).grouping(.never).precision(.fractionLength(0...2))) : ""
            }
            .confirmationDialog("Kayıt ve bütün ödemeleri silinsin mi?", isPresented: $sil, titleVisibility: .visible) {
                Button("Sil", role: .destructive) {
                    do { try model.write("delete_debt", ["id": d.id]); dismiss() } catch { hata = error.localizedDescription }
                }
            }
        }
    }

    private var n1: Bool { (d.installments ?? 1) <= 1 }

    private func kaydet() {
        var a: [String: Any] = ["debt": d.id, "amount": Bicim.parse(tutar) ?? 0, "date": Bicim.key(tarih)]
        if kapat { a["close"] = true }
        do { try model.write("pay_debt", a); dismiss() } catch { hata = error.localizedDescription }
    }
}

// Kart payı ya da elle ödenen kartın ekstresi için ödeme (pay_debt person / card)
enum OdemeHedefi: Identifiable {
    case pay(id: String, ad: String, tutar: Double)
    case kart(id: String, ad: String, tutar: Double)
    var id: String {
        switch self {
        case .pay(let id, _, _): return "p" + id
        case .kart(let id, _, _): return "k" + id
        }
    }
}

struct OdemeFormu: View {
    @EnvironmentObject private var model: Model
    @Environment(\.dismiss) private var dismiss
    let hedef: OdemeHedefi
    @State private var tutar = ""
    @State private var tarih = Date()
    @State private var hata: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Tutar (\(Bicim.homeSymbol))", text: $tutar).keyboardType(.decimalPad)
                    DatePicker("Tarih", selection: $tarih, in: ...Date(), displayedComponents: .date).environment(\.locale, Bicim.locale)
                } footer: {
                    switch hedef {
                    case .pay(_, let ad, _): Text("\(ad) kart payından sana ödedi.")
                    case .kart(_, let ad, _): Text("\(ad) ekstresini ödedin; tutar \(Bicim.homeShort) bakiyenden düşer.")
                    }
                }
                HataMetni(text: hata)
            }
            .navigationTitle("Ödendi")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Kaydet", action: kaydet).disabled((Bicim.parse(tutar) ?? 0) <= 0) }
            }
            .onAppear {
                switch hedef {
                case .pay(_, _, let t), .kart(_, _, let t):
                    tutar = t > 0 ? t.formatted(.number.locale(Bicim.locale).grouping(.never).precision(.fractionLength(0...2))) : ""
                }
            }
        }
    }

    private func kaydet() {
        var a: [String: Any] = ["amount": Bicim.parse(tutar) ?? 0, "date": Bicim.key(tarih)]
        switch hedef {
        case .pay(let id, _, _): a["person"] = id
        case .kart(let id, _, _): a["card"] = id
        }
        do { try model.write("pay_debt", a); dismiss() } catch { hata = error.localizedDescription }
    }
}

// Yeni borç, alacak ya da kredi (add_debt)
struct BorcFormu: View {
    @EnvironmentObject private var model: Model
    @Environment(\.dismiss) private var dismiss
    @State private var tur = "borrowed"
    @State private var kim = ""
    @State private var tutar = ""
    @State private var taksitTutari = true      // kredide tutar aylık taksit
    @State private var taksit = 1
    @State private var vadeli = true
    @State private var vade = Calendar.current.date(byAdding: .month, value: 1, to: Date()) ?? Date()
    @State private var tarih = Date()
    @State private var cekilen = ""
    @State private var varlik = Bicim.home
    @State private var otomatik = false
    @State private var not = ""
    @State private var kisi = ""
    @State private var kisiler: [Kisi] = []
    @State private var hata: String?

    private var kredi: Bool { tur == "loan" }
    private var vadeVar: Bool { kredi || vadeli || taksit > 1 }   // taksitli borçta ilk taksitin günü gerekir

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Tür", selection: $tur) {
                        Text("Borç aldım").tag("borrowed")
                        Text("Borç verdim").tag("lent")
                        Text("Kredi").tag("loan")
                    }
                    .pickerStyle(.segmented)
                    TextField(kredi ? "Banka (isteğe bağlı)" : tur == "borrowed" ? "Kimden" : "Kime", text: $kim)
                    HStack {
                        TextField(kredi && taksitTutari ? "Aylık taksit" : "Toplam tutar", text: $tutar).keyboardType(.decimalPad)
                        Picker("", selection: $varlik) {
                            ForEach(model.constants?.assets ?? []) { a in Text(a.code == "GAU" ? "gr" : a.symbol).tag(a.code) }
                        }
                        .pickerStyle(.menu)
                        .labelsHidden()
                        .disabled(kredi)
                    }
                    if kredi { Toggle("Tutar aylık taksit", isOn: $taksitTutari) }
                    Picker("Taksit", selection: $taksit) {
                        if !kredi { Text("Tek seferde").tag(1) }
                        ForEach(2...120, id: \.self) { Text("\($0) taksit").tag($0) }
                    }
                }
                Section {
                    if !kredi && taksit == 1 { Toggle("Vadesi var", isOn: $vadeli) }
                    if vadeVar {
                        DatePicker(taksit > 1 ? "İlk taksit" : "Vade", selection: $vade, displayedComponents: .date).environment(\.locale, Bicim.locale)
                    }
                    DatePicker(kredi ? "Kredinin çekildiği gün" : "Paranın el değiştirdiği gün", selection: $tarih, displayedComponents: .date)
                        .environment(\.locale, Bicim.locale)
                    if kredi {
                        TextField("Hesaba yatan tutar (isteğe bağlı)", text: $cekilen).keyboardType(.decimalPad)
                    }
                    if vadeVar {
                        Toggle("Tarihinde ödenmiş say (otomatik)", isOn: $otomatik)
                    }
                    if kisiler.count > 1 {
                        Picker("Kişi", selection: $kisi) { ForEach(kisiler) { Text($0.name).tag($0.id) } }
                    }
                    TextField("Not (isteğe bağlı)", text: $not)
                } footer: {
                    Text(kredi
                         ? "Hesaba yatan tutar varlığına eklenir; taksitler tarihinde düşer. Toplam ile çekilen arasındaki fark faiz ve masraftır."
                         : tur == "borrowed" ? "Alınan para varlığına eklenir; geri ödedikçe düşer." : "Verilen para varlığından düşer; geri aldıkça eklenir.")
                }
                HataMetni(text: hata)
            }
            .navigationTitle("Borç ekle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Kaydet", action: kaydet).disabled((Bicim.parse(tutar) ?? 0) <= 0) }
            }
            .onChange(of: tur) { _, yeni in
                if yeni == "loan" { varlik = Bicim.home; otomatik = true; if taksit < 2 { taksit = 12 } } else { otomatik = false }
            }
            .onAppear {
                kisiler = (try? model.read("list_people") as KisiListesi)?.people ?? []
                if kisi.isEmpty { kisi = kisiler.first?.id ?? "ben" }
            }
        }
    }

    private func kaydet() {
        var a: [String: Any] = [
            "type": tur, "amount": Bicim.parse(tutar) ?? 0, "installments": taksit, "date": Bicim.key(tarih),
            "asset": varlik, "person": kisi,
        ]
        if !kim.trimmingCharacters(in: .whitespaces).isEmpty { a["party"] = kim.trimmingCharacters(in: .whitespaces) }
        if !not.trimmingCharacters(in: .whitespaces).isEmpty { a["description"] = not.trimmingCharacters(in: .whitespaces) }
        if kredi {
            a["amount_type"] = taksitTutari ? "per_installment" : "total"
            if let c = Bicim.parse(cekilen), c > 0 { a["principal"] = c }
        }
        if vadeVar {
            a["due_date"] = Bicim.key(vade)
            a["auto_pay"] = otomatik
        }
        do { try model.write("add_debt", a); dismiss() } catch { hata = error.localizedDescription }
    }
}

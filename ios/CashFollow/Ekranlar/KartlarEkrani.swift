import SwiftUI

// Kart satırı, kart ayrıntısı (görsel + işlemler) ve kart formu; kartlar Borçlar sekmesinde listelenir (BorclarEkrani)

// Sıkışık kart satırı: renk, ad, sonraki ödeme, kalan limit, doluluk; ödenmemiş ekstrede "Ödendi"
struct KartSatiri: View {
    @EnvironmentObject private var model: Model
    let c: KartGorunumu
    let borc: Borclar.KartBorcu?
    let ac: () -> Void
    let odendi: () -> Void

    var body: some View {
        let renk = model.kartRengi(c.id)
        let asim = c.limit > 0 && c.used > c.limit
        VStack(alignment: .leading, spacing: 8) {
            Button(action: ac) {
                HStack(spacing: 12) {
                    Image(systemName: "creditcard.fill").font(.system(size: 15)).foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background(renk, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(c.name).font(.body.weight(.semibold)).lineLimit(1)
                        Text(c.nextPayment.map { "\(Bicim.day($0.date)) · \(Bicim.tl($0.amount, fraction: false))" } ?? L("Kesim {0} · son ödeme {1}", c.cutoffDay, c.dueDay))
                            .font(.footnote).foregroundStyle(Tema.metin3).lineLimit(1)
                    }
                    Spacer(minLength: 6)
                    VStack(alignment: .trailing, spacing: 2) {
                        if c.limit > 0 {
                            Text(asim ? "−" + Bicim.tl(c.used - c.limit, fraction: false) : Bicim.tl(c.available ?? 0, fraction: false))
                                .font(.body.weight(.semibold)).monospacedDigit()
                                .foregroundStyle(asim ? Tema.tehlike : Tema.metin)
                            Text(asim ? L("limit aşıldı") : L("kullanılabilir")).font(.caption).foregroundStyle(Tema.metin3)
                        } else {
                            Text(Bicim.tl(c.used, fraction: false)).font(.body.weight(.semibold)).monospacedDigit()
                            Text(L("borç")).font(.caption).foregroundStyle(Tema.metin3)
                        }
                    }
                    .fixedSize()
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if c.limit > 0 { Doluluk(used: c.used, limit: c.limit, renk: renk).padding(.leading, 48) }
            if let r = c.tracking?.revolving, r.carried > 0.004 {
                Text(L("Devreden {0} · APR {1}", Bicim.tl(r.carried, fraction: false), Bicim.oran(r.apr)))
                    .font(.footnote).foregroundStyle(Tema.metin2).padding(.leading, 48)
            }
            if let borc, let unpaid = borc.unpaid, unpaid > 0.004 {
                let gec = (borc.overdue ?? 0) > 0.004
                odemeSatiri(gec ? L("Geciken ekstre {0}", Bicim.tl(unpaid, fraction: false)) : L("Ödenmemiş ekstre {0}", Bicim.tl(unpaid, fraction: false)),
                            renk: gec ? Tema.tehlike : Tema.metin2)
            } else if let r = c.tracking?.revolving, let st = c.statement, st.alreadyCut == true, st.amount > 0.004 {
                // Döner kredide kesilmiş ekstre son ödeme gününden önce ödenir: bakiye, asgari ve son gün
                odemeSatiri(L("Ekstre {0} · asgari {1} · {2}", Bicim.tl(st.amount, fraction: false), Bicim.tl(r.minimumDue, fraction: false), Bicim.day(st.date)),
                            renk: Tema.metin2)
            }
        }
    }

    private func odemeSatiri(_ metin: String, renk: Color) -> some View {
        HStack {
            Text(metin).font(.footnote.weight(.medium)).foregroundStyle(renk).lineLimit(2)
            Spacer()
            Button(L("Ödendi"), action: odendi)
                .font(.footnote.weight(.semibold)).foregroundStyle(Tema.metin)
                .padding(.horizontal, 12).padding(.vertical, 5)
                .background(Tema.yuzey2, in: Capsule())
                .buttonStyle(.plain)
        }
        .padding(.leading, 48)
    }
}

// Kartın ayrıntısı: görsel, günler, bugün alınanın ödeme tarihi, ödendi / düzenle / sil
struct KartDetayi: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var abonelik: Abonelik
    let c: KartGorunumu
    let duzenle: () -> Void
    let sil: () -> Void
    let odendi: (Double, Double?) -> Void   // ödenecek tutar, döner kredide asgari

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    KartGorseli(c: c)
                    Kart {
                        VStack(spacing: 10) {
                            Satir(title: L("Hesap kesim günü"), value: L("Ayın {0}", Bicim.gunEki(c.cutoffDay)))
                            Satir(title: L("Son ödeme günü"), value: L("Ayın {0}", Bicim.gunEki(c.dueDay)))
                            Satir(title: L("Bugün alınan ilk ödeme"), value: Bicim.day(c.purchaseToday.dueDate))
                            Satir(title: L("Harcama sayısı"), value: "\(c.purchaseCount)")
                        }
                        .font(.subheadline)
                    }
                    if let r = c.tracking?.revolving { donerKredi(r) }
                    if let t = c.tracking, t.unpaid > 0.004 {
                        genisDugme(L("Ekstre ödendi ({0})", Bicim.tl(t.unpaid, fraction: false)), simge: "checkmark.circle", renk: Tema.metin) { odendi(t.unpaid, t.revolving?.minimumDue) }
                    } else if let t = c.tracking, !t.autoPay, let st = c.statement, st.amount > 0.004 {
                        // Elle ödenen kartta ekstre son ödeme gününden önce de ödenebilir
                        genisDugme(L("Ödeme kaydet"), simge: "checkmark.circle", renk: Tema.metin) { odendi(st.amount, t.revolving?.minimumDue) }
                    }
                    genisDugme(L("Kartı düzenle"), simge: "pencil", renk: Tema.metin, eylem: duzenle)
                    genisDugme(L("Kartı sil"), simge: "trash", renk: Tema.tehlike, eylem: sil)
                }
                .padding(16)
            }
            .background(Tema.zemin)
            .navigationTitle(c.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Bitti")) { dismiss() } } }
        }
        .presentationDetents([.large])
    }

    // Döner kredi: sıradaki ekstre (bakiye, asgari, son gün), devreden, işlemiş faiz, APR; yalnızca asgari ödenirse geri ödeme
    @ViewBuilder private func donerKredi(_ r: DonerKredi) -> some View {
        Kart {
            VStack(spacing: 10) {
                if let st = c.statement {
                    Satir(title: L("Ekstre bakiyesi"), value: Bicim.tl(st.balance ?? st.amount))
                    Satir(title: L("Asgari ödeme"), value: Bicim.tl(r.minimumDue))
                    Satir(title: L("Son ödeme tarihi"), value: Bicim.day(st.date))
                }
                if r.carried > 0.004 { Satir(title: L("Devreden"), value: Bicim.tl(r.carried)) }
                if r.interestCharged > 0.004 { Satir(title: L("İşlemiş faiz"), value: Bicim.tl(r.interestCharged)) }
                Satir(title: L("Yıllık faiz (APR)"), value: Bicim.oran(r.apr))
            }
            .font(.subheadline)
        }
        if r.payoff != nil, !abonelik.premium {
            PremiumKilidi(baslik: L("Borcu bitirmek"), aciklama: L("Yalnızca asgari ödersen borcun ne zaman biteceği, ne kadar faiz ödeyeceğin ve 12 ayda bitirmek için aylık ödeme."), neden: "payoff")
        } else if let p = r.payoff {
            Kart {
                VStack(alignment: .leading, spacing: 6) {
                    Text(L("Borcu bitirmek")).font(.subheadline.weight(.semibold))
                    Text(p.monthsAtMinimum.map { L("Yalnızca asgari ödersen {0} ayda biter, {1} faiz ödersin.", $0, Bicim.tl(p.interestAtMinimum, fraction: false)) }
                         ?? L("Yalnızca asgari ödersen borç 50 yılda bitmez."))
                    Text(L("12 ayda bitirmek için ayda {0} öde.", Bicim.tl(p.monthlyToClearIn12)))
                    Text(L("Tahminidir: banka faizi günlük bakiyeyle hesaplar, ücretler eklenebilir."))
                        .font(.caption).foregroundStyle(Tema.metin3)
                }
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func genisDugme(_ ad: String, simge: String, renk: Color, eylem: @escaping () -> Void) -> some View {
        Button(action: eylem) {
            Label(ad, systemImage: simge)
                .font(.body.weight(.semibold)).foregroundStyle(renk)
                .frame(maxWidth: .infinity).padding(.vertical, 14)
                .background(Tema.yuzey, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

// Web'deki kart görseli: kartın renginde degrade, ad, kesim / son ödeme, kullanılabilir limit (ya da aşım), doluluk
struct KartGorseli: View {
    @EnvironmentObject private var model: Model
    let c: KartGorunumu

    var body: some View {
        let renk = model.kartRengi(c.id)
        let asim = c.limit > 0 && c.used > c.limit
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                Text(c.name).font(.title3.weight(.bold))
                if let l4 = c.last4 { Text("•• \(l4)").font(.subheadline).opacity(0.75) }
                Spacer()
                VStack(alignment: .trailing, spacing: 1) {
                    Text(L("Kesim {0}", c.cutoffDay))
                    Text(L("Son ödeme {0}", c.dueDay))
                }
                .font(.footnote.weight(.medium)).opacity(0.85)
            }
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 5, style: .continuous).fill(.white.opacity(0.35))
                    .frame(width: 34, height: 24)
                    .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(.white.opacity(0.4), lineWidth: 1))
                if asim {
                    Text(L("Limit aşıldı")).font(.caption.weight(.semibold))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(.white.opacity(0.22), in: Capsule())
                }
                if let t = c.tracking, !t.autoPay, t.overdue > 0 {
                    Text(L("Geciken {0}", Bicim.tl(t.overdue, fraction: false))).font(.caption.weight(.semibold))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(.white.opacity(0.22), in: Capsule())
                }
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(c.limit <= 0 ? L("Kullanılan") : asim ? L("Limit aşımı") : L("Kullanılabilir limit")).font(.footnote).opacity(0.85)
                Text(Bicim.tl(c.limit <= 0 ? c.used : asim ? c.used - c.limit : (c.available ?? 0)))
                    .font(.system(size: 28, weight: .bold)).monospacedDigit()
            }
            if c.limit > 0 {
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(.white.opacity(0.28))
                        Capsule().fill(.white).frame(width: max(4, g.size.width * min(c.used / c.limit, 1)))
                    }
                }
                .frame(height: 5)
            }
            HStack {
                if c.limit > 0 { Text(L("{0} / {1} kullanıldı", kisa(c.used), kisa(c.limit))) }
                Spacer()
                if let n = c.nextPayment { Text(L("Son ödeme {0} · {1}", Bicim.day(n.date), Bicim.tl(n.amount, fraction: false))) }
            }
            .font(.caption.weight(.medium)).opacity(0.9).monospacedDigit()
        }
        .foregroundStyle(.white)
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            let sekil = RoundedRectangle(cornerRadius: Tema.yaricap, style: .continuous)
            sekil.fill(renk)
                .overlay(sekil.fill(LinearGradient(colors: [.white.opacity(0.14), .black.opacity(0.24)], startPoint: .topLeading, endPoint: .bottomTrailing)))
        }
        .shadow(color: renk.opacity(0.3), radius: 12, y: 8)
        .contentShape(RoundedRectangle(cornerRadius: Tema.yaricap, style: .continuous))
    }
}

// Kart ekleme (add_card) ve düzenleme (update_card: ad, limit, son 4 hane, ödeme modu, APR). Kesim / son ödeme günü
// değişince eski ekstrelerin ne olacağı sorulur (transition). Ödeme modu: otomatikte ekstre son ödeme gününün ertesi günü
// tamamen ödenmiş sayılır; elle modda "Ödendi" ile işlenir. APR (ABD): elle ödenen kartta kalan faiziyle devreder.
struct KartFormu: View {
    @EnvironmentObject private var model: Model
    @Environment(\.dismiss) private var dismiss
    let card: KartGorunumu?
    @State private var name = ""
    @State private var limit = ""
    @State private var cutoff = 10
    @State private var due = 20
    @State private var last4 = ""
    @State private var otomatik = true
    @State private var apr = ""
    @State private var error: String?
    @State private var gecis: [Gecis] = []      // günler değişince sorulan seçenekler (update_card transition)
    @State private var soru = false

    // Kesim / son ödeme günü değişince arada kalan harcamalar (web'deki kart formuyla aynı seçenekler)
    struct Gecis: Hashable { let kod: String; let baslik: String; let aciklama: String }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(L("Kartın adı (ör. Bonus, Axess)"), text: $name)
                    TextField(L("Limit ({0})", Bicim.homeSymbol), text: $limit).keyboardType(.decimalPad)
                    TextField(L("Son 4 hane (isteğe bağlı)"), text: $last4).keyboardType(.numberPad)
                }
                Section {
                    Picker(L("Hesap kesim günü"), selection: $cutoff) { ForEach(1...31, id: \.self) { Text("\($0)").tag($0) } }
                    Picker(L("Son ödeme günü"), selection: $due) { ForEach(1...31, id: \.self) { Text("\($0)").tag($0) } }
                } footer: {
                    Text(card == nil
                         ? L("Kesim günü dahil yapılan harcama o ayın ekstresine girer; ekstre son ödeme gününde ödenir.")
                         : L("Günler değişirse arada kalan harcamaların ne olacağını sorarım."))
                }
                Section {
                    Toggle(L("Ekstre her ay tamamen ödeniyor"), isOn: $otomatik)
                    if model.aprAllowed {
                        TextField(L("Yıllık faiz (APR %)"), text: $apr).keyboardType(.decimalPad)
                    }
                } footer: {
                    Text(otomatik
                         ? L("Her ekstre son ödeme gününün ertesi günü ödenmiş sayılır ve nakdinden düşer.")
                         : model.aprAllowed
                            ? L("Ödediğinde \"Ödendi\" ile işlersin. En az asgari ödemeyi ödersen kalan faiziyle sonraki ekstreye devreder; daha azı gecikmedir.")
                            : L("Ödediğinde \"Ödendi\" ile işlersin; son ödeme günü geçen ödenmemiş ekstre gecikmiş sayılır."))
                }
                HataMetni(text: error)
                Section {
                    AltKaydet(eksik: name.trimmingCharacters(in: .whitespaces).isEmpty ? L("Kartın adını yaz") : nil, eylem: save)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
            }
            .tint(Tema.metin)
            .navigationTitle(card == nil ? L("Kart ekle") : L("Kartı düzenle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Vazgeç")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Kaydet"), action: save).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .confirmationDialog(L("Kartın günleri değişiyor"), isPresented: $soru, titleVisibility: .visible) {
                ForEach(gecis, id: \.self) { g in Button(g.baslik) { save(transition: g.kod) } }
                Button(L("Vazgeç"), role: .cancel) {}
            } message: {
                Text(gecis.map { "\($0.baslik): \($0.aciklama)" }.joined(separator: "\n\n"))
            }
            .onAppear {
                guard let c = card else { return }
                name = c.name
                limit = c.limit > 0 ? String(format: "%.0f", c.limit) : ""
                cutoff = c.cutoffDay
                due = c.dueDay
                last4 = c.last4 ?? ""
                otomatik = c.tracking?.autoPay ?? true
                apr = c.apr.map { $0.formatted(.number.locale(Bicim.locale).grouping(.never).precision(.fractionLength(0...2))) } ?? ""
            }
        }
    }

    private func save() { save(transition: nil) }

    private func save(transition: String?) {
        var a: [String: Any] = ["name": name.trimmingCharacters(in: .whitespaces), "limit": Bicim.parse(limit) ?? 0, "last4": last4]
        let oran = model.aprAllowed ? Bicim.parse(apr) : nil
        do {
            if let c = card {
                a["card"] = c.id
                if otomatik != (c.tracking?.autoPay ?? true) { a["auto_pay"] = otomatik }
                if model.aprAllowed, oran != c.apr { a["apr"] = oran.map { $0 as Any } ?? NSNull() }
                if cutoff != c.cutoffDay || due != c.dueDay {
                    a["cutoff_day"] = cutoff
                    a["due_day"] = due
                }
                if let transition { a["transition"] = transition }
                do {
                    try model.write("update_card", a)
                } catch let e as AracHatasi where e.user && e.message.contains("transition") {
                    gecis = Self.secenekler(e.message)
                    if gecis.isEmpty { throw e }
                    soru = true
                    return
                }
            } else {
                a["cutoff_day"] = cutoff
                a["due_day"] = due
                a["auto_pay"] = otomatik
                if let oran { a["apr"] = oran }
                try model.write("add_card", a)
            }
            Analitik.olay(card == nil ? "card_added" : "card_edited")
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }

    // Aracın sorusundan seçenekler ve tarihleri (mcp/tools.js transitionQuestion)
    static func secenekler(_ m: String) -> [Gecis] {
        func tarih(_ pattern: String) -> [String] {
            guard let r = try? NSRegularExpression(pattern: pattern),
                  let x = r.firstMatch(in: m, range: NSRange(m.startIndex..., in: m)) else { return [] }
            return (1..<x.numberOfRanges).compactMap { Range(x.range(at: $0), in: m).map { Bicim.day(String(m[$0])) } }
        }
        var out: [Gecis] = []
        if m.contains("\"old\":") {
            let d = tarih(#"cutoff (\d{4}-\d{2}-\d{2}), paid (\d{4}-\d{2}-\d{2})"#)
            out.append(Gecis(kod: "old", baslik: L("Bu ekstre eski günlerle kesilsin"),
                             aciklama: d.count == 2 ? L("{0} kesilir, {1} tarihinde ödenir; sonraki ekstreler yeni günlerle.", d[0], d[1]) : L("Açık ekstre eski günlerle; sonrakiler yeni günlerle.")))
        }
        if m.contains("\"new\":") {
            let d = tarih(#"cut on (\d{4}-\d{2}-\d{2}), paid (\d{4}-\d{2}-\d{2})"#)
            out.append(Gecis(kod: "new", baslik: L("Yeni günler hemen başlasın"),
                             aciklama: d.count == 2 ? L("Kesilmiş ekstreler değişmez; henüz kesilmemiş harcamalar {0} tarihinde kesilecek ekstreye girer, son ödeme {1}.", d[0], d[1]) : L("Kesilmiş ekstreler olduğu gibi kalır; bundan sonrakiler yeni günlerle.")))
        }
        if m.contains("\"fix\":") {
            out.append(Gecis(kod: "fix", baslik: L("Günleri yanlış girmiştim"),
                             aciklama: L("Geçmiş ekstreler dahil hepsi yeni günlerle yeniden hesaplanır. {0} bakiyen değişebilir.", Bicim.homeShort)))
        }
        return out
    }
}

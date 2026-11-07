import SwiftUI
import UserNotifications

// İlk açılış akışı (Uygulama/Karsilama.swift; ios/UX.md → akış 1). Beş ekran, her biri tek soru:
//   1 giris    ne işe yaradığı + ülke → "Hesap açmadan başla" (ya da "Hesabım var, giriş yap")
//   2 kart     hangi kart (Türkiye'de hızlı seçim çipleri) — "Kredi kartım yok" ile geçilir
//   3 kesim    ekstre ayın kaçında kesiliyor (son ödeme günü tahmin edilir, değiştirilebilir)
//   4 harcama  bir taksitli harcama: tutar, taksit, ne zaman; ödeme planı yazarken görünür
//   5 sonuc    "Planın hazır": bu ay ödenecek (ya da ilk ödeme) + ödeme günü hatırlatması
// Kart ve harcama gerçek kayıttır (add_card, add_purchase): pencere kapanınca Özet dolu açılır, Başlarken'de iki adım
// işaretli. ✕ her adımda Özet'e geçer. Uygulama 1. ekrandan sonra kapanırsa sonraki açılış Özet'le başlar.

// Kapı: yeni kullanıcıya akış; daha önce kullanmış olana ve denemenin control koluna giriş ekranı (GirisEkrani)
struct KarsilamaKapisi: View {
    @EnvironmentObject private var model: Model
    @State private var kol: String?

    var body: some View {
        let kol = self.kol ?? Karsilama.hazirKol
        Group {
            if kol == "eylem" {
                KarsilamaEkrani()
            } else if kol != nil {
                GirisEkrani(welcome: true)
            } else {
                Tema.zemin.ignoresSafeArea()   // bayrak beklenirken (en fazla 1,5 sn)
            }
        }
        .interactiveDismissDisabled()
        .task { if self.kol == nil { self.kol = await Karsilama.kolSec() } }
        // Pencere kapandı: giriş ekranından (control) ya da akıştan giriş yapılarak; akışın kendi sonu önce yazılır
        .onDisappear { Karsilama.bitir(yol: model.session != nil ? "account" : "offline") }
    }
}

struct KarsilamaEkrani: View {
    enum Adim: Int {
        case giris, kart, kesim, harcama, sonuc
        var ad: String { ["intro", "card", "cutoff", "purchase", "aha"][rawValue] }   // analitikte adımın adı
    }

    @EnvironmentObject private var model: Model
    @Environment(\.scenePhase) private var scenePhase
    var baslangic = 0       // ekran görüntüleri: açılacak adım (Ornek.swift TurEkrani, "tanitimN")
    var ornek = false       // ekran görüntüsü: cevaplar dolu; analitik, bildirim izni ve pencerenin kapanması yok

    @State private var adim: Adim = .giris
    @State private var hazir = false
    @State private var ulke = ""
    @State private var ulkeKesin = true          // varsayılan ülke bulundu; bulunmadıysa listede "Ülkeni seç"
    @State private var kartAdi = ""
    @State private var kesim: Int?
    @State private var sonOdeme = 20
    @State private var kartId: String?
    @State private var tutar = ""
    @State private var taksit = 6
    @State private var ayOnce = 0
    @State private var onizleme: HarcamaSonucu?
    @State private var bugun: KartGorunumu.Bugun?   // kartın bugünkü harcamasının kesimi ve son ödemesi
    @State private var ozet: Ozet?
    @State private var izin: UNAuthorizationStatus?
    @State private var eklenen = 0
    @State private var atlanan = 0
    @State private var ahaYazildi = false
    @State private var hata: String?
    @State private var girisAcik = false
    @State private var bekliyor = false
    @State private var akisBasi = Date()
    @State private var adimBasi = Date()
    @FocusState private var tutarOdak: Bool

    private let taksitler = [1, 2, 3, 6, 9, 12]

    var body: some View {
        ScrollView {
            Group {
                switch adim {
                case .giris: giris
                case .kart: kart
                case .kesim: kesimAdimi
                case .harcama: harcama
                case .sonuc: sonuc
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 24)
            .frame(maxWidth: .infinity, alignment: .leading)
            .id(adim)
            .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity))
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollBounceBehavior(.basedOnSize)
        .background(Tema.zemin.ignoresSafeArea())
        .safeAreaInset(edge: .top, spacing: 0) { if adim != .giris { ustCubuk } }
        .safeAreaInset(edge: .bottom, spacing: 0) { dugmeler }
        .tint(Tema.metin)
        .onAppear(perform: hazirla)
        .onChange(of: adim) { _, a in adimGosterildi(a) }
        .onChange(of: scenePhase) { _, faz in
            if faz == .background, !ornek {
                Karsilama.olay("onboarding_backgrounded", ["step": adim.ad])
                Analitik.gonder()   // uygulama arka planda kapatılırsa kaybolmasın
            }
        }
        .sheet(isPresented: $girisAcik) { GirisEkrani(welcome: false, kaynak: "onboarding") }
    }

    // ── Adımlar ─────────────────────────────────────────────────────────────────

    private var giris: some View {
        VStack(alignment: .leading, spacing: 16) {
            KartYigini()
            baslik(L("Kartına bu ay ne ödeyeceğini bil"), L("Kartını ve bir harcamanı gir; ödeme gününü ve tutarını hemen gör."))
            Label(L("Banka şifresi gerekmez"), systemImage: "lock.fill")
                .font(.footnote).foregroundStyle(Tema.metin3)
            Kart(dolgu: 14) {
                HStack {
                    Text(L("Ülke")).lineLimit(1)
                    Spacer(minLength: 8)
                    UlkeSecici(secim: $ulke, secimYok: !ulkeKesin).fixedSize()   // "United States · USD" tek satır
                }
            }
        }
    }

    private var kart: some View {
        VStack(alignment: .leading, spacing: 16) {
            baslik(L("Hangi kartı kullanıyorsun?"), L("En çok kullandığını seç; diğerlerini sonra eklersin."))
            if model.country == "TR" {
                Akan(aralik: 8, satirAraligi: 8) {
                    ForEach(Karsilama.kartlarTR, id: \.self) { ad in
                        Cip(ad: ad, secili: kartAdi == ad) {
                            kartAdi = ad
                            ilerle(.kesim, yontem: "chip")
                        }
                    }
                }
            }
            Kart(dolgu: 14) {
                TextField(L("Kartın adı (ör. Bonus, Axess)"), text: $kartAdi)
                    .font(.title3)
                    .submitLabel(.next)
                    .onSubmit { if !kartAdiBos { ilerle(.kesim, yontem: "typed") } }
            }
        }
    }

    private var kesimAdimi: some View {
        VStack(alignment: .leading, spacing: 16) {
            baslik(L("{0} ekstresi ayın kaçında kesiliyor?", kartAdiTemiz), L("Ekstrende ya da banka uygulamanda yazar."))
            GunIzgarasi(secili: kesim) { g in
                kesim = g
                sonOdeme = Karsilama.sonOdemeGunu(kesim: g, ulke: model.country)
            }
            if kesim != nil {
                Kart(dolgu: 14) {
                    HStack {
                        Text(L("Son ödeme günü"))
                        Spacer()
                        Picker(L("Son ödeme günü"), selection: $sonOdeme) {
                            ForEach(1...31, id: \.self) { Text(L("Ayın {0}", $0)).tag($0) }
                        }
                        .labelsHidden()
                    }
                }
                Text(L("Kesim günü dahil yapılan harcama o ayın ekstresine girer; ekstre son ödeme gününde ödenir."))
                    .font(.footnote).foregroundStyle(Tema.metin3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HataMetni(text: hata)
        }
    }

    private var harcama: some View {
        VStack(alignment: .leading, spacing: 16) {
            baslik(kartId != nil && model.installmentsPrimary ? L("Taksitle aldığın bir şey var mı?") : L("Son harcaman ne kadardı?"), nil)
            Kart {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(Bicim.homeSymbol).font(.system(size: 28, weight: .semibold)).foregroundStyle(Tema.metin3)
                    TextField(L("0"), text: $tutar)
                        .font(.system(size: 40, weight: .bold)).monospacedDigit()
                        .keyboardType(.decimalPad)
                        .focused($tutarOdak)
                }
            }
            if kartId != nil {
                Kart {
                    taksitSecimi
                    if taksit > 1 { neZaman }
                }
            }
            if let p = onizleme { OdemePlani(sonuc: p, taksitli: taksitSayisi > 1) }
            HataMetni(text: hata)
        }
        .task(id: "\(tutar)|\(taksit)|\(ayOnce)|\(kartId ?? "")") { onizle() }
        .onChange(of: taksit) { _, n in if ayOnce >= n { ayOnce = max(n - 1, 0) } }
        .task {
            guard !ornek, tutar.isEmpty else { return }
            try? await Task.sleep(nanoseconds: 350_000_000)   // geçiş bitsin
            tutarOdak = true
        }
    }

    private var sonuc: some View {
        VStack(alignment: .leading, spacing: 16) {
            baslik(L("Planın hazır"), nil)
            if let o = ozet {
                if o.dueThisMonth > 0.004 {
                    BuAyKarti(o: o)
                } else if let ilk = o.upcomingPayments.first {
                    ilkOdemeKarti(ilk, o)
                } else {
                    Kart { Text(L("Ödenecek taksit yok")).font(.subheadline).foregroundStyle(Tema.metin2) }
                }
                if let aciklama {
                    Label(aciklama, systemImage: "info.circle")
                        .font(.footnote).foregroundStyle(Tema.metin2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                KucukDugme(ad: L("Bir harcama daha ekle"), simge: "plus") { dahaEkle() }
                if let p = hatirlatilacak { hatirlatmaKarti(p) }
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .sensoryFeedback(.success, trigger: ozet != nil)
    }

    // ── Parçalar ────────────────────────────────────────────────────────────────

    private func baslik(_ b: String, _ alt: String?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(b).font(.title.bold()).foregroundStyle(Tema.metin)
                .fixedSize(horizontal: false, vertical: true)
            if let alt {
                Text(alt).font(.body).foregroundStyle(Tema.metin2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.bottom, 2)
    }

    private func etiket(_ s: String) -> some View {
        Text(s).font(.footnote.weight(.semibold)).foregroundStyle(Tema.metin3)
    }

    // Menülü çip ("Diğer"; seçiliyse değeri yazar)
    private func menuEtiketi(_ s: String, secili: Bool) -> some View {
        Text(s).font(.subheadline.weight(.semibold))
            .foregroundStyle(secili ? Tema.ustMetin : Tema.metin)
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(secili ? Tema.metin : Tema.yuzey, in: Capsule())
            .overlay(Capsule().strokeBorder(Tema.cizgi2, lineWidth: secili ? 0 : 1))
    }

    // Taksit: taksidin öne çıktığı ülkede çipler (harcama formundaki gibi), başka ülkede "Taksitli" anahtarı
    @ViewBuilder private var taksitSecimi: some View {
        if model.installmentsPrimary {
            etiket(L("Taksit"))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(taksitler, id: \.self) { n in
                        Cip(ad: n == 1 ? L("Peşin") : "\(n)", secili: taksit == n) { taksit = n }
                    }
                    Menu {
                        Picker(L("Taksit"), selection: $taksit) {
                            ForEach(2...60, id: \.self) { Text(L("{0} taksit", $0)).tag($0) }
                        }
                    } label: {
                        menuEtiketi(taksitler.contains(taksit) ? L("Diğer") : L("{0} taksit", taksit), secili: !taksitler.contains(taksit))
                    }
                }
            }
        } else {
            Toggle(L("Taksitli"), isOn: Binding(get: { taksit > 1 }, set: { acik in withAnimation { taksit = acik ? 3 : 1 } }))
                .font(.subheadline)
        }
    }

    // Taksitli harcama ne zaman alındı: geçmiş aylarda alınanın ödenen taksitleri düşer. Seçenekler taksit sayısından
    // az ay önce (n taksitli harcama n ay önce alındıysa bütün taksitleri ödenmiştir; "Planın hazır" boş kalırdı)
    @ViewBuilder private var neZaman: some View {
        let enFazla = min(taksit - 1, 12)
        etiket(L("Ne zaman aldın?"))
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Cip(ad: L("Bu ay"), secili: ayOnce == 0) { ayOnce = 0 }
                Cip(ad: L("Geçen ay"), secili: ayOnce == 1) { ayOnce = 1 }
                ForEach([2, 3].filter { $0 <= enFazla }, id: \.self) { n in
                    Cip(ad: L("{0} ay önce", n), secili: ayOnce == n) { ayOnce = n }
                }
                if enFazla >= 4 {
                    Menu {
                        Picker(L("Ne zaman aldın?"), selection: $ayOnce) {
                            ForEach(4...enFazla, id: \.self) { Text(L("{0} ay önce", $0)).tag($0) }
                        }
                    } label: {
                        menuEtiketi(ayOnce > 3 ? L("{0} ay önce", ayOnce) : L("Diğer"), secili: ayOnce > 3)
                    }
                }
            }
        }
    }

    private func ilkOdemeKarti(_ ilk: Ozet.Yaklasan, _ o: Ozet) -> some View {
        Kart {
            HStack {
                Text(L("İlk ödemen")).font(.subheadline).foregroundStyle(Tema.metin2)
                Spacer()
                Text(Bicim.relative(ilk.date)).font(.subheadline.weight(.semibold))
            }
            BuyukTutar(deger: ilk.total)
            Text("\(Bicim.kartAdi(ilk.card)) · \(Bicim.day(ilk.date))").font(.subheadline).foregroundStyle(Tema.metin2)
            Ayirici()
            IstatistikSatiri(ogeler: [Istatistik(etiket: L("Kalan bütün taksitler"), deger: Bicim.tl(o.remainingTotal))])
        }
    }

    private func hatirlatmaKarti(_ p: Ozet.Yaklasan) -> some View {
        Kart {
            HStack(spacing: 10) {
                Image(systemName: "bell.badge").font(.title3).foregroundStyle(Tema.metin2)
                Text(L("Ödeme günlerini hatırlatayım mı?")).font(.body.weight(.semibold))
            }
            BildirimOnizlemesi(odeme: p)
            Text(L("Son ödeme gününden bir gün önce bildirim gelir. Ayarlar'dan değiştirebilirsin."))
                .font(.footnote).foregroundStyle(Tema.metin2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // Üstte: geri, ilerleme (4 adım), kapat
    private var ustCubuk: some View {
        HStack(spacing: 8) {
            Button { if let g = geriHedef { git(g) } } label: {
                Image(systemName: "chevron.backward").font(.body.weight(.semibold))
                    .frame(width: 40, height: 40).contentShape(Rectangle())
            }
            .accessibilityLabel(L("Geri"))
            .opacity(geriHedef == nil ? 0 : 1)
            .disabled(geriHedef == nil)
            AdimCubugu(adim: adim.rawValue, toplam: 4)
            Button(action: kapat) {
                Image(systemName: "xmark").font(.body.weight(.semibold))
                    .frame(width: 40, height: 40).contentShape(Rectangle())
            }
            .accessibilityLabel(L("Kapat"))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Tema.metin)
        .padding(.horizontal, 10)
        .padding(.bottom, 4)
        .background(Tema.zemin)
    }

    // Altta (klavyenin üstünde kalır): büyük düğme eksik olanı yazar; altında ikinci seçenek
    private var dugmeler: some View {
        VStack(spacing: 4) {
            switch adim {
            case .giris:
                AltKaydet(eksik: ulke.isEmpty ? L("Ülkeni seç") : nil, baslik: L("Hesap açmadan başla")) { girissizBasla() }
                ikincil(L("Hesabım var, giriş yap")) { girisAc() }
            case .kart:
                AltKaydet(eksik: kartAdiBos ? L("Kartın adını yaz") : nil, baslik: L("Devam")) { ilerle(.kesim, yontem: "typed") }
                if kartId == nil { ikincil(L("Kredi kartım yok")) { atla(.harcama, neden: "no_card") } }
            case .kesim:
                AltKaydet(eksik: kesim == nil ? L("Kesim gününe dokun") : nil, baslik: L("Devam")) {
                    if kartiKaydet() { ilerle(.harcama, yontem: "entered") }
                }
                if kartId == nil { ikincil(L("Bilmiyorum, kartı sonra eklerim")) { atla(.harcama, neden: "unknown") } }
            case .harcama:
                AltKaydet(eksik: (Bicim.parse(tutar) ?? 0) <= 0 ? L("Tutarı yaz") : nil, baslik: L("Hesapla")) {
                    if harcamayiKaydet() { ilerle(.sonuc, yontem: "button") }
                }
                ikincil(L("Şimdilik atla")) { if eklenen > 0 { git(.sonuc) } else { atla(nil, neden: "skipped") } }
            case .sonuc:
                if hatirlatilacak != nil {
                    AltKaydet(eksik: nil, baslik: L("Hatırlat")) { hatirlat() }
                    ikincil(L("Şimdi değil")) {
                        if !ornek { Hatirlatma.ertele(kaynak: "onboarding") }
                        bitir()
                    }
                } else {
                    AltKaydet(eksik: nil, baslik: L("Devam")) { bitir() }
                }
            }
        }
        .disabled(bekliyor)
        .padding(.horizontal, 20)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(Tema.zemin)
    }

    private func ikincil(_ ad: String, _ eylem: @escaping () -> Void) -> some View {
        Button(action: eylem) {
            Text(ad).font(.subheadline.weight(.medium)).foregroundStyle(Tema.metin2)
                .frame(maxWidth: .infinity).padding(.vertical, 10).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // ── Durum ───────────────────────────────────────────────────────────────────

    private var kartAdiTemiz: String { kartAdi.trimmingCharacters(in: .whitespaces) }
    private var kartAdiBos: Bool { kartAdiTemiz.isEmpty }
    private var taksitSayisi: Int { kartId == nil ? 1 : taksit }

    // Geri: kart kaydedildikten sonra kesime dönülebilir (günler düzeltilir); harcama kaydedildikten sonra dönülmez
    private var geriHedef: Adim? {
        switch adim {
        case .kesim: return .kart
        case .harcama: return eklenen > 0 ? nil : (kartId != nil ? .kesim : .kart)
        default: return nil
        }
    }

    // "Bugünkü harcamalar ne zaman ödenir" (kartın bugünkü kesimi ve son ödemesi)
    private var aciklama: String? {
        guard let b = bugun else { return nil }
        return L("{0} dahil yapılan harcamalar {1} günü ödenir.", Bicim.day(b.statementCutoff), Bicim.day(b.dueDate))
    }

    // Hatırlatma sorulacak ödeme: kartın sıradaki ödemesi; bildirim izni daha önce sorulmadıysa
    private var hatirlatilacak: Ozet.Yaklasan? {
        guard let o = ozet, let p = o.upcomingPayments.first(where: { $0.card != "Nakit" && $0.late != true }) else { return nil }
        if ornek { return p }
        return !Hatirlatma.acik && izin == .notDetermined ? p : nil
    }

    private var kisi: String { ((try? model.read("list_people") as KisiListesi)?.people.first?.id) ?? "ben" }

    private func hazirla() {
        guard !hazir else { return }
        hazir = true
        if ornek {
            let tr = Ornek.ulke == "TR"
            ulke = Ornek.ulke
            kartAdi = tr ? "Bonus" : "Chase Sapphire"
            kesim = tr ? 10 : 3
            sonOdeme = tr ? 20 : 24
            taksit = tr ? 6 : 1
            if baslangic >= 3 {
                kartId = ornekKart()
                tutar = tr ? "36000" : "1800"
            }
            if baslangic >= 4, ((try? model.read("list_purchases", ["status": "all", "limit": 1]) as HarcamaListesi)?.count ?? 0) == 0 {
                harcamayiKaydet()
            }
        } else {
            ulke = Karsilama.varsayilanUlke(kayitli: Depo.offlineCountry, bolge: Locale.current.region?.identifier,
                                            paraBirimi: Locale.current.currency?.identifier, ulkeler: model.constants?.countries ?? [])
            ulkeKesin = !ulke.isEmpty
        }
        adim = Adim(rawValue: min(max(baslangic, 0), 4)) ?? .giris
        if adim == .sonuc { sonucuHazirla() }
        adimGosterildi(adim)
    }

    private func adimGosterildi(_ a: Adim) {
        adimBasi = Date()
        guard !ornek else { return }
        Karsilama.olay("onboarding_step_viewed", ["step": a.ad, "step_index": a.rawValue])
    }

    private func saniye(_ d: Date, _ ust: Int) -> Int { min(max(Int(Date().timeIntervalSince(d)), 0), ust) }

    // Adım tamam: olayı yazar, sonrakine geçer
    private func ilerle(_ hedef: Adim, yontem: String) {
        if !ornek {
            Karsilama.olay("onboarding_step_completed", ["step": adim.ad, "step_index": adim.rawValue,
                                                         "seconds": saniye(adimBasi, 600), "method": yontem])
        }
        git(hedef)
    }

    private func atla(_ hedef: Adim?, neden: String) {
        atlanan += 1
        if !ornek { Karsilama.olay("onboarding_step_skipped", ["step": adim.ad, "reason": neden]) }
        if let hedef { git(hedef) } else { bitir() }
    }

    private func git(_ hedef: Adim) {
        hata = nil
        // Harcamaya ilk gelişte taksit: kartla ve taksidin öne çıktığı ülkede 6, değilse peşin
        if hedef == .harcama, tutar.isEmpty { taksit = kartId != nil && model.installmentsPrimary ? 6 : 1 }
        withAnimation(.snappy(duration: 0.3)) { adim = hedef }
        if hedef == .sonuc { sonucuHazirla() }
    }

    private func girissizBasla() {
        guard !ornek else { return git(.kart) }
        model.continueOffline(country: ulke, kaynak: "onboarding", kapat: false)
        ilerle(.kart, yontem: "button")
    }

    private func girisAc() {
        guard !ornek else { return }
        Karsilama.olay("onboarding_account_choice", ["choice": "login"])
        girisAcik = true
    }

    // Kart: ilk kayıtta add_card (limit yok, otomatik ödenir; ayrıntısı sonra Kartlar'da), geri dönülünce update_card
    @discardableResult
    private func kartiKaydet() -> Bool {
        guard let k = kesim, !kartAdiBos else { return false }
        do {
            if let id = kartId {
                try model.write("update_card", ["card": id, "name": kartAdiTemiz, "cutoff_day": k, "due_day": sonOdeme])
            } else {
                kartId = try model.write("add_card", ["name": kartAdiTemiz, "cutoff_day": k, "due_day": sonOdeme, "auto_pay": true,
                                                      "limit": 0, "last4": ""], as: KartEklendi.self).card.id
                if !ornek { Analitik.olay("card_added", ["source": "onboarding", "is_first": true]) }
            }
            return true
        } catch {
            hata = error.localizedDescription
            return false
        }
    }

    private func harcamaArgumanlari() -> [String: Any]? {
        guard let t = Bicim.parse(tutar), t > 0 else { return nil }
        let n = taksitSayisi
        return ["description": n > 1 ? L("Taksitli alışveriş") : L("Harcama"), "amount": t, "installments": n,
                "date": Bicim.key(Karsilama.tarih(ayOnce: n > 1 ? ayOnce : 0)), "card": kartId ?? "nakit", "person": kisi]
    }

    // Ödeme planı önizlemesi (kaydetmeden; harcama düzenlemedeki gibi add_purchase dry_run)
    private func onizle() {
        guard var a = harcamaArgumanlari() else { onizleme = nil; return }
        a["dry_run"] = true
        onizleme = try? model.read("add_purchase", a) as HarcamaSonucu
    }

    @discardableResult
    private func harcamayiKaydet() -> Bool {
        guard let a = harcamaArgumanlari() else { return false }
        do {
            _ = try model.write("add_purchase", a, as: HarcamaSonucu.self)
            eklenen += 1
            guard !ornek else { return true }
            Puanlama.olumluAn()
            let n = taksitSayisi
            Analitik.olay("purchase_added", ["installments": n, "repeat": false, "bnpl": false, "bonus": 0, "cash": kartId == nil,
                                             "afford_shown": false, "source": "onboarding", "is_first": eklenen == 1,
                                             "months_ago": n > 1 ? ayOnce : 0])
            return true
        } catch {
            hata = error.localizedDescription
            return false
        }
    }

    // "Planın hazır": Özet'in hesabı, kartın bugünkü kesimi, bildirim izni
    private func sonucuHazirla() {
        Task {
            if !ornek { izin = await Hatirlatma.izinDurumu() }
            if let id = kartId {
                bugun = (try? model.read("list_cards") as KartBugunu)?.cards.first { $0.id == id }?.purchaseToday
            }
            let o = try? model.read("get_overview") as Ozet
            withAnimation(.snappy) { ozet = o }
            guard !ornek, let o else { return }
            Karsilama.etkinlesmeyiDenetle(model, akista: true)
            guard !ahaYazildi else { return }
            ahaYazildi = true
            Karsilama.olay("onboarding_aha_viewed", ["has_due_this_month": o.dueThisMonth > 0.004,
                                                     "upcoming_count": min(o.upcomingPayments.count, 10),
                                                     "installments": taksitSayisi, "seconds_since_start": saniye(akisBasi, 1800)])
        }
    }

    private func dahaEkle() {
        if !ornek { Karsilama.olay("onboarding_add_another", ["count": eklenen]) }
        tutar = ""
        ayOnce = 0
        onizleme = nil
        git(.harcama)
    }

    private func hatirlat() {
        guard !ornek, !bekliyor else { return }
        bekliyor = true
        Task {
            let acildi = await Hatirlatma.ac(model, kaynak: "onboarding")
            bekliyor = false
            bitir(hatirlatma: acildi)
        }
    }

    private func kapat() {
        guard !ornek else { return }
        Karsilama.olay("onboarding_closed", ["step": adim.ad])
        bitir(yol: "closed")
    }

    private func bitir(yol: String = "offline", hatirlatma: Bool = false) {
        guard !ornek else { return }
        Karsilama.bitir(yol: yol, ["seconds_total": saniye(akisBasi, 1800), "card": kartId != nil, "purchase": eklenen > 0,
                                   "reminders": hatirlatma, "steps_skipped": atlanan])
        model.showWelcome = false
    }

    // Ekran görüntüleri: örnek kart (yoksa eklenir)
    private func ornekKart() -> String? {
        if let c = (try? model.read("list_cards") as KartListesi)?.cards.first { return c.id }
        return try? model.write("add_card", ["name": kartAdi, "cutoff_day": kesim ?? 10, "due_day": sonOdeme, "auto_pay": true,
                                             "limit": 0, "last4": ""], as: KartEklendi.self).card.id
    }
}

// add_card'ın cevabından yalnızca kartın kimliği
private struct KartEklendi: Decodable {
    struct Kimlik: Decodable { let id: String }
    let card: Kimlik
}

// list_cards'tan kartın bugünkü harcamasının kesimi ve son ödemesi
private struct KartBugunu: Decodable {
    struct Gun: Decodable { let id: String; let purchaseToday: KartGorunumu.Bugun? }
    let cards: [Gun]
}

// Harcamanın ödeme planı: ekstre kesimi, ilk ödeme; taksitliyse son ödeme ve taksit tutarı
private struct OdemePlani: View {
    let sonuc: HarcamaSonucu
    let taksitli: Bool

    var body: some View {
        let p = sonuc.preview
        Kart {
            KartBasligi(L("Ödeme planı"))
            VStack(spacing: 8) {
                if let cut = p?.statementCutoff { Satir(title: L("Ekstre kesimi"), value: Bicim.day(cut)) }
                Satir(title: L("İlk ödeme"), value: Bicim.day(p?.firstPayment ?? sonuc.purchase.nextPayment?.date))
                if taksitli {
                    Satir(title: L("Son ödeme"), value: Bicim.day(p?.lastPayment ?? sonuc.purchase.lastPaymentDate))
                    Satir(title: L("Taksit tutarı"), value: Bicim.tl(p?.perInstallment ?? sonuc.purchase.perInstallment))
                }
            }
            .font(.subheadline)
        }
    }
}

// İlerleme: dört çizgi, geçilenler koyu
private struct AdimCubugu: View {
    let adim: Int
    let toplam: Int

    var body: some View {
        HStack(spacing: 4) {
            ForEach(1...toplam, id: \.self) { i in
                Capsule().fill(i <= adim ? Tema.metin : Tema.yuzey3).frame(height: 4)
            }
        }
        .animation(.snappy, value: adim)
        .accessibilityElement()
        .accessibilityLabel(L("Adım {0} / {1}", adim, toplam))
    }
}

// Ayın günleri (1…31), 7 sütun; dokunulan seçilir
private struct GunIzgarasi: View {
    let secili: Int?
    let sec: (Int) -> Void

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 7), spacing: 8) {
            ForEach(1...31, id: \.self) { g in
                Button { sec(g) } label: {
                    Text("\(g)")
                        .font(.body.weight(secili == g ? .bold : .medium)).monospacedDigit()
                        .lineLimit(1).minimumScaleFactor(0.6)
                        .foregroundStyle(secili == g ? Tema.ustMetin : Tema.metin)
                        .frame(maxWidth: .infinity)
                        .frame(height: 42)
                        .background(secili == g ? Tema.metin : Tema.yuzey, in: Circle())
                        .overlay(Circle().strokeBorder(secili == g ? Color.clear : Tema.cizgi2, lineWidth: 1))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L("Ayın {0}", g))
                .accessibilityAddTraits(secili == g ? .isSelected : [])
            }
        }
        .sensoryFeedback(.selection, trigger: secili)
    }
}

// Bildirimin önizlemesi: Hatirlatma.kur'un gönderdiği metinle (bir gün önce)
private struct BildirimOnizlemesi: View {
    let odeme: Ozet.Yaklasan

    var body: some View {
        let gun = Bicim.date(odeme.date).flatMap { Calendar.current.date(byAdding: .day, value: -1, to: $0) }
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "creditcard.fill").font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(Tema.marka, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(verbatim: "CashFollow").font(.footnote.weight(.semibold))
                    Spacer()
                    if let gun { Text(Bicim.day(Bicim.key(gun))).font(.caption).foregroundStyle(Tema.metin3) }
                }
                Text(L("Yarın ödeme var")).font(.subheadline.weight(.semibold))
                Text("\(Bicim.kartAdi(odeme.card)) · \(Bicim.tl(odeme.total))").font(.subheadline).foregroundStyle(Tema.metin2)
            }
        }
        .padding(12)
        .background(Tema.yuzey2, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// 1. ekranın görseli: arkada iki kart, önde "Bu ay ödenecek" kartının taslağı (tutar yok; para birimi fark etmez)
private struct KartYigini: View {
    var body: some View {
        ZStack(alignment: .bottom) {
            kart(Tema.seri(2)).rotationEffect(.degrees(9)).offset(x: 58)
                .frame(maxHeight: .infinity, alignment: .top)
            kart(Tema.seri(0)).rotationEffect(.degrees(-6)).offset(x: -50, y: 16)
                .frame(maxHeight: .infinity, alignment: .top)
            on
        }
        .frame(maxWidth: .infinity)
        .frame(height: 260)
        .dynamicTypeSize(...DynamicTypeSize.large)
        .accessibilityHidden(true)
    }

    private func kart(_ renk: Color) -> some View {
        let sekil = RoundedRectangle(cornerRadius: 20, style: .continuous)
        return sekil.fill(renk)
            .overlay(sekil.fill(LinearGradient(colors: [.white.opacity(0.14), .black.opacity(0.24)], startPoint: .topLeading, endPoint: .bottomTrailing)))
            .overlay(alignment: .topLeading) {
                Image(systemName: "wave.3.right").font(.footnote.weight(.semibold)).foregroundStyle(.white.opacity(0.8)).padding(14)
            }
            .frame(width: 200, height: 124)
            .shadow(color: renk.opacity(0.3), radius: 12, y: 8)
    }

    private var on: some View {
        let simdi = Date()
        let gun = { (n: Int) in Bicim.key(Calendar.current.date(byAdding: .day, value: n, to: simdi) ?? simdi) }
        return VStack(alignment: .leading, spacing: 8) {
            Text(L("Bu ay ödenecek")).font(.footnote).foregroundStyle(Tema.metin2)
            Capsule().fill(Tema.yuzey3).frame(width: 128, height: 24)
            Ayirici()
            ForEach([6, 33], id: \.self) { n in   // 27 gün arayla: iki rozet aynı gün numarasını göstermez
                HStack(spacing: 10) {
                    TarihRozeti(tarih: gun(n))
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 6) {
                            Circle().fill(Tema.seri(0)).frame(width: 7, height: 7)
                            Capsule().fill(Tema.yuzey3).frame(width: 70, height: 9)
                        }
                        Capsule().fill(Tema.yuzey2).frame(width: 96, height: 8)
                    }
                    Spacer()
                    Capsule().fill(Tema.yuzey3).frame(width: 54, height: 10)
                }
            }
        }
        .padding(14)
        .frame(width: 270)
        .background { KartZemini(cizgi: true, golge: 0.1) }
    }
}

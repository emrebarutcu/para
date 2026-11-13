import SwiftUI
import UserNotifications

// Ayarlar: hesap ve eşitleme, ülke, nakit (dönem başı, nakit sayılanlar), kişiler, sürüm
struct AyarlarEkrani: View {
    @EnvironmentObject private var model: Model
    @EnvironmentObject private var abonelik: Abonelik
    @Environment(\.dismiss) private var dismiss
    // Ayarlar'dan açılan pencereler tek .sheet'ten: listedeki bir bölüme bağlanan pencere o bölümün her satırına ayrı
    // bağlanır, açılır açılmaz kapanır
    enum Sayfa: String, Identifiable {
        case giris, premium, kisiSiniri, asistan
        var id: String { rawValue }
    }
    @State private var sayfa: Sayfa?
    @State private var aboneligiYonet = false
    @State private var confirmLogout = false
    @State private var hesapSil = false
    @State private var siliniyor = false
    @State private var silmeHatasi: String?
    @State private var newPerson = ""
    @State private var addingPerson = false
    @State private var renaming: Kisi?
    @State private var renameText = ""
    @State private var deleting: Kisi?
    @State private var error: String?
    @State private var ulke = ""
    @State private var ulkeHatasi: String?
    @AppStorage("nakit.baslangic") private var nakitBaslangic = "today"

    var body: some View {
        NavigationStack {
            List {
                PremiumBolumu(sayfa: $sayfa, yonet: $aboneligiYonet)

                Section {
                    if let s = model.session {
                        Satir(title: L("Hesap"), value: s.email)
                        if let e = model.syncError {
                            Text(e).font(.footnote).foregroundStyle(Renk.gider)
                        } else if let at = model.lastSync {
                            Satir(title: L("Son eşitleme"), value: at.formatted(.dateTime.hour().minute().locale(Bicim.locale)))
                        }
                        Button(model.syncing ? L("Eşitleniyor…") : L("Şimdi eşitle")) { Task { await model.refresh() } }
                            .disabled(model.syncing)
                        Button(L("Çıkış yap")) { confirmLogout = true }
                        Button(L("Hesabı sil"), role: .destructive) { hesapSil = true }
                    } else {
                        Text(L("Veriler yalnızca bu telefonda. Giriş yapınca yedeklenir; web'de (cashfollow.app) ve diğer cihazlarında da görürsün."))
                            .font(.footnote).foregroundStyle(.secondary)
                        Button(L("Giriş yap / Kayıt ol")) { sayfa = .giris }
                    }
                } header: { Text(L("Hesap")) }

                Section {
                    UlkeSecici(secim: $ulke)
                    Satir(title: L("Para birimi"), value: "\(Bicim.homeShort) (\(Bicim.home))")
                    HataMetni(text: ulkeHatasi)
                } header: { Text(L("Ülke")) } footer: {
                    Text(L("Tutarlar ve kurlar ülkenin para biriminde gösterilir; web ve asistan da aynısını kullanır. Ülke değişince kayıtlı tutarlar çevrilmez. Fon ve hisse şimdilik yalnızca Türkiye'de."))
                }
                .onAppear { if ulke.isEmpty { ulke = model.country } }
                .onChange(of: ulke) { _, yeni in
                    guard !yeni.isEmpty, yeni != model.country else { return }
                    Task {
                        do { try await model.setCountry(yeni); ulkeHatasi = nil }
                        catch { ulkeHatasi = (error as? AuthHatasi)?.turkish ?? error.localizedDescription; ulke = model.country }
                    }
                }

                Section {
                    Picker(L("Dönem başı"), selection: $nakitBaslangic) {
                        Text(L("Bugün")).tag("today")
                        ForEach(1...31, id: \.self) { Text(L("Ayın {0}", Bicim.gunEki($0))).tag(String($0)) }
                    }
                    NavigationLink { NakitTanimi() } label: {
                        Satir(title: L("Nakit sayılanlar"), value: nakitMetni)
                    }
                } header: { Text(L("Nakit")) } footer: {
                    Text(L("Özet'teki Nakit grafiği bu günden başlayan bir ayı gösterir (ör. maaş günün) ve yalnızca nakit sayılanları toplar."))
                }

                HatirlatmaBolumu()
                KilitBolumu()

                Section {
                    Okunan(tool: "list_people") { (l: KisiListesi) in
                        ForEach(Array(l.people.enumerated()), id: \.element.id) { i, p in
                            HStack {
                                Avatar(ad: p.name, renk: model.kisiRengi(p.id), boyut: 28)
                                Text(p.name)
                                Spacer()
                                if let owes = p.owesUser, abs(owes) >= 0.01 {
                                    Text(Bicim.tl(owes)).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .contentShape(Rectangle())
                            .onTapGesture { renameText = p.name; renaming = p }
                            .swipeActions {
                                if l.people.count > 1 { Button(L("Sil"), role: .destructive) { deleting = p } }
                            }
                        }
                        Button(L("Kişi ekle")) {
                            // Ücretsiz sürümde en fazla Abonelik.ucretsizKisi kişi (kullanıcı ve bir kişi daha)
                            if abonelik.premium || l.people.count < Abonelik.ucretsizKisi { newPerson = ""; addingPerson = true }
                            else { sayfa = .kisiSiniri }
                        }
                    }
                    HataMetni(text: error)
                } header: { Text(L("Kişiler")) } footer: {
                    Text(L("Adını değiştirmek için dokun, silmek için sola kaydır. İlk kişi sensin; diğerlerinin senin kartlarındaki harcamaları sana borç sayılır."))
                }

                // Banka e-postaları yalnızca Türkiye'de
                if model.bankEmailsAllowed {
                    Section {
                        NavigationLink { EpostaAyarlari() } label: { Text(L("Banka e-postaları")) }
                    } footer: {
                        Text(L("Bankanın harcama bildirimleri kendiliğinden harcama olarak eklenir."))
                    }
                }

                Section {
                    Toggle(L("Kullanım verisi gönder"), isOn: Binding(get: { Analitik.acik }, set: { Analitik.acik = $0 }))
                } footer: {
                    Text(L("Hangi özelliklerin kullanıldığını gönderir; tutarlar, adlar ve açıklamalar gönderilmez. Uygulamayı geliştirmek için kullanılır."))
                }

                Section {
                    // İçe aktarma (Excel) yalnızca Türkiye'de
                    Link(model.excelImportAllowed ? L("Web'de aç (içe aktarma)") : L("Web'de aç"), destination: Yapilandirma.site)
                    Link(L("Gizlilik politikası"), destination: Yapilandirma.gizlilik)
                    Link(L("Kullanım koşulları"), destination: Yapilandirma.kosullar)
                    Link(L("Destek"), destination: Yapilandirma.destek)
                    Satir(title: L("Sürüm"), value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
                }
            }
            .navigationTitle(L("Ayarlar"))
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Bitti")) { dismiss() } } }
            .sheet(item: $sayfa) { s in
                switch s {
                case .giris: GirisEkrani(welcome: false)
                case .premium: PremiumEkrani(neden: "settings")
                case .kisiSiniri: PremiumEkrani(neden: "person_limit")
                case .asistan: AsistanEkrani()
                }
            }
            .manageSubscriptionsSheet(isPresented: $aboneligiYonet)
            .confirmationDialog(L("Hesabın ve bütün verilerin silinsin mi?"), isPresented: $hesapSil, titleVisibility: .visible) {
                Button(L("Hesabı kalıcı olarak sil"), role: .destructive) {
                    siliniyor = true
                    Task {
                        do { try await model.deleteAccount(); dismiss() }
                        catch { silmeHatasi = (error as? AuthHatasi)?.turkish ?? error.localizedDescription }
                        siliniyor = false
                    }
                }
            } message: {
                Text(L("Kartlar, harcamalar, varlıklar, borçlar ve hesabın buluttan ve bu cihazdan silinir. Geri alınamaz."))
            }
            .alert(L("Hesap silinemedi"), isPresented: Binding(get: { silmeHatasi != nil }, set: { if !$0 { silmeHatasi = nil } })) {
                Button(L("Tamam"), role: .cancel) {}
            } message: { Text(silmeHatasi ?? "") }
            .overlay { if siliniyor { ProgressView().controlSize(.large) } }
            .confirmationDialog(L("Çıkış yapılsın mı?"), isPresented: $confirmLogout, titleVisibility: .visible) {
                Button(L("Çıkış yap"), role: .destructive) { Task { await model.signOut() } }
            } message: {
                Text(L("Hesabının verisi bu cihazdan silinir, bulutta kalır."))
            }
            .alert(L("Kişi ekle"), isPresented: $addingPerson) {
                TextField(L("Ad"), text: $newPerson)
                Button(L("Ekle")) { act("add_person", ["name": newPerson]) }
                Button(L("Vazgeç"), role: .cancel) {}
            }
            .alert(L("Adını değiştir"), isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
                TextField(L("Ad"), text: $renameText)
                Button(L("Kaydet")) { if let p = renaming { act("rename_person", ["person": p.id, "name": renameText]) } }
                Button(L("Vazgeç"), role: .cancel) {}
            }
            .confirmationDialog(deleting.map { L("{0} silinsin mi?", $0.name) } ?? "", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                Button(L("Sil"), role: .destructive) { if let p = deleting { act("delete_person", ["person": p.id]) } }
            } message: {
                Text(L("Kişinin bütün harcamaları, varlık hareketleri ve borçları da silinir."))
            }
        }
    }

    private var nakitMetni: String {
        let ad: (String) -> String = { c in
            c == "MMF" ? L("para piyasası fonları") : c == "GAU" ? L("altın") : Dil.turkceDegil ? c : model.constants?.currencies.first { $0.code == c }?.short ?? c
        }
        let list = model.cashDef.map(ad)
        return list.isEmpty ? L("hiçbiri") : list.joined(separator: ", ")
    }

    private func act(_ tool: String, _ args: [String: Any]) {
        do { try model.write(tool, args); error = nil } catch { self.error = error.localizedDescription }
    }
}

// Nakit tanımı: hangi varlıklar nakit sayılır (web: Ayarlar → Nakit sayılanlar)
struct NakitTanimi: View {
    @EnvironmentObject private var model: Model

    private var secenekler: [(kod: String, ad: String, alt: String?)] {
        var out = (model.constants?.assets ?? []).map { (kod: $0.code, ad: Bicim.paraAdi($0.code, $0.name), alt: $0.code == model.home ? L("Ana para birimi") : nil as String?) }
        if model.marketsAllowed { out.append((kod: "MMF", ad: L("Para piyasası fonları"), alt: L("Aynı gün nakde dönen (T+0) TL fonları"))) }
        return out
    }

    var body: some View {
        List {
            Section {
                ForEach(secenekler, id: \.kod) { x in
                    Toggle(isOn: Binding(get: { model.cashDef.contains(x.kod) }, set: { on in
                        var list = model.cashDef.filter { $0 != x.kod }
                        if on { list.append(x.kod) }
                        model.setCashDef(list)
                    })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(x.ad)
                            if let alt = x.alt { Text(alt).font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                }
            } footer: {
                Text(L("Nakit grafiği bu varlıkların toplamını gösterir; döviz, altın ve fonlar bugünkü kur ve fiyatla {0} karşılığıyla.", Bicim.homeShort))
            }
            Section { Button(L("Varsayılana dön")) { model.setCashDef(nil) } }
        }
        .navigationTitle(L("Nakit sayılanlar"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

// Ayarlar → Banka e-postaları (web'deki Banka e-postaları penceresi): kullanıcıya özel adres, desteklenen bankalar,
// kurulum adımları, şimdi kontrol et, adresi yenile ve bir e-postayı dene (try_bank_email)
struct EpostaAyarlari: View {
    @EnvironmentObject private var model: Model
    @State private var adres: String?
    @State private var hata: String?
    @State private var kopyalandi = false
    @State private var yenileSor = false
    @State private var kontrol: String?
    @State private var kontrolEdiliyor = false
    @State private var deneme = ""
    @State private var sonuc: Deneme?
    @State private var iletAcik = true

    struct Deneme: Decodable {
        let parsed: Eposta.Okunan
        let matchedCard: String?
        let needsReview: String?
        let wouldAutoAdd: Bool
    }

    var body: some View {
        List {
            Section {
                Text(L("Bankanın harcama e-postaları sana özel adrese gelince harcama olarak eklenir. E-postalar telefonun kapalıyken de alınır; CashFollow'u açtığında harcamalar, kartın son 4 hanesine göre ilgili karta eklenmiş olur."))
                    .font(.footnote).foregroundStyle(Tema.metin2)
                if let b = model.constants?.inboxBanks, !b.isEmpty {
                    Text(L("Şimdilik desteklenen bankalar: {0}. Diğer bankaların e-postaları da okunmaya çalışılır; okunamayan Harcamalar'da onaya düşer.", b.joined(separator: ", ")))
                        .font(.footnote).foregroundStyle(Tema.metin2)
                }
            }

            if model.session == nil {
                Section {
                    Text(L("Bu özellik bulut senkronizasyonuyla çalışır. Önce Ayarlar → Hesap'tan giriş yap.")).font(.footnote).foregroundStyle(Tema.uyari)
                }
            } else {
                Section {
                    if let adres {
                        Text(adres).font(.body.monospaced()).textSelection(.enabled)
                        Button(kopyalandi ? L("Kopyalandı") : L("Kopyala")) {
                            UIPasteboard.general.string = adres
                            kopyalandi = true
                        }
                        if let u = Self.denemeAdresi(adres) { Link(L("Deneme e-postası gönder"), destination: u) }
                    } else if hata == nil {
                        ProgressView()
                    }
                    HataMetni(text: hata)
                    durum
                } header: { Text(L("Adresin")) } footer: {
                    Text(L("Bu adresi bilen herkes sana harcama gönderebilir; yalnızca bankana ya da kendi e-posta kutuna ver. Ele geçtiğini düşünürsen yenile ve bankadaki adresi değiştir."))
                }

                Section {
                    Text(L("Bankanın harcama e-postalarını bu adrese getirmenin iki yolu var:"))
                    DisclosureGroup(L("Kendi e-postandan ilet (önerilen)"), isExpanded: $iletAcik) {
                        Text(L("Bankanın e-postaları kendi kutuna da gelmeye devam eder. Bankanın gönderdiği adres, kutundaki harcama e-postalarında görünür."))
                            .foregroundStyle(Tema.metin2)
                        rehber(L("Gmail (bilgisayardan; telefondaki Gmail uygulamasında bu ayar yok)"), [
                            L("Ayarlar → Tüm ayarları görün → Yönlendirme ve POP/IMAP → Yönlendirme adresi ekle: bu adres."),
                            L("Gmail bu adrese bir onay gönderir; birkaç saniye içinde Harcamalar'da \"Gmail yönlendirme onayı\" olarak görünür. Onayla'ya dokun."),
                            L("Filtreler → Yeni filtre oluştur → Kimden: bankanın adresi → Filtre oluştur → Şu adrese yönlendir: bu adres."),
                        ])
                        rehber(L("Outlook / Hotmail"), [
                            L("Ayarlar → Posta → Kurallar → Yeni kural ekle."),
                            L("Koşul: Kimden bankanın adresi. Eylem: Şuraya ilet → bu adres."),
                        ])
                        rehber(L("iCloud Mail (icloud.com)"), [
                            L("Ayarlar → Kurallar → Kural ekle."),
                            L("Kimden: bankanın adresi → Bir adrese ilet → bu adres."),
                        ])
                    }
                    DisclosureGroup(L("Bankada bildirim adresini değiştir")) {
                        Text(L("Bankanın internet ya da mobil şubesinde harcama bildirimlerinin gideceği e-posta adresini bu adres yap. Bildirimler artık kendi kutuna gelmez. Banka adresi doğrulamak için e-posta gönderirse Harcamalar'da \"Adres doğrulama\" olarak görünür; Onayla'ya dokun."))
                            .foregroundStyle(Tema.metin2)
                    }
                    Text(L("Kartların son 4 hanesini önceden girmen gerekmez: tanımadığımız bir kartla ilk harcama gelince Harcamalar'da hangi kart olduğunu sorarız."))
                        .foregroundStyle(Tema.metin2)
                } header: { Text(L("Kurulum")) }
                .font(.footnote)

                EpostaBildirimBolumu()

                Section {
                    Button(kontrolEdiliyor ? L("Kontrol ediliyor…") : L("Şimdi kontrol et")) {
                        kontrolEdiliyor = true
                        Task {
                            let k = await model.epostaKontrol()
                            kontrolEdiliyor = false
                            kontrol = k.map { k in
                                !k.eklenen.isEmpty ? L("E-postadan {0} harcama eklendi", k.eklenen.count)
                                    : k.deneme > 0 ? L("Deneme e-postası ulaştı: adresin çalışıyor")
                                    : model.epostalar.isEmpty ? L("Yeni e-posta yok") : L("{0} e-posta onay bekliyor · Harcamalar", model.epostalar.count)
                            } ?? L("E-postalar okunamadı")
                        }
                    }
                    .disabled(kontrolEdiliyor)
                    if let kontrol { Text(kontrol).font(.footnote).foregroundStyle(Tema.metin2) }
                    Button(L("Adresi yenile"), role: .destructive) { yenileSor = true }
                }
            }

            Section {
                TextEditor(text: $deneme).frame(minHeight: 110).font(.footnote)
                Button(L("Dene")) { dene() }.disabled(deneme.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                if let s = sonuc { denemeSonucu(s) }
            } header: { Text(L("Bir e-postayı dene")) } footer: {
                Text(L("Bankadan gelen harcama e-postasının metnini yapıştır; hiçbir şey kaydedilmez."))
            }
        }
        .navigationTitle(L("Banka e-postaları"))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard model.session != nil else { return }
            if adres == nil { await adresAl(yenile: false) }
            _ = await model.epostaKontrol()   // durum (son e-posta) güncel olsun
        }
        .confirmationDialog(L("Adres yenilensin mi? Eski adrese gelen e-postalar artık alınmaz; bankadaki adresi de değiştirmen gerekir."),
                            isPresented: $yenileSor, titleVisibility: .visible) {
            Button(L("Adresi yenile"), role: .destructive) { Task { await adresAl(yenile: true) } }
        }
    }

    // Kurulum çalışıyor mu: gelen son e-posta (işlenmiş olsa da)
    @ViewBuilder private var durum: some View {
        if let s = model.sonEposta {
            let tur = ["test": L("deneme e-postası"), "verification": L("doğrulama e-postası"), "purchase": L("harcama bildirimi")][s.kind] ?? L("e-posta")
            let ne = [tur, s.sender.map(Self.gonderen)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
            Label {
                Text(L("Son e-posta {0}: {1}", Senkron.time(s.receivedAt).map(Self.once) ?? "", ne)).font(.footnote)
            } icon: {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Tema.iyi)
            }
        } else if adres != nil {
            Label {
                Text(L("Henüz e-posta gelmedi. Bankandan ilk bildirim gelince burada görünür; adresi şimdi denemek için deneme e-postası gönder.")).font(.footnote)
            } icon: {
                Image(systemName: "clock").foregroundStyle(Tema.metin3)
            }
            .foregroundStyle(Tema.metin2)
        }
    }

    // "2 saat önce"
    private static func once(_ d: Date) -> String {
        let f = RelativeDateTimeFormatter()
        f.locale = Bicim.locale
        f.unitsStyle = .full
        return f.localizedString(for: min(d, Date()), relativeTo: Date())
    }

    // "Yapı Kredi <bilgilendirme@yapikredi.com.tr>" → "Yapı Kredi"
    static func gonderen(_ s: String) -> String {
        let ad = s.replacingOccurrences(of: #"\s*<[^>]*>\s*"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "\" ").union(.whitespaces))
        return ad.isEmpty ? s : ad
    }

    // Deneme: kullanıcının e-posta uygulaması konusu "CashFollow deneme" olan bir e-postayla açılır (eposta.js TEST_SUBJECT)
    static func denemeAdresi(_ adres: String) -> URL? {
        var c = URLComponents()
        c.scheme = "mailto"
        c.path = adres
        c.queryItems = [URLQueryItem(name: "subject", value: "CashFollow deneme"),
                        URLQueryItem(name: "body", value: L("Bu e-posta CashFollow adresimin çalıştığını denemek için gönderildi."))]
        return c.url
    }

    private func rehber(_ baslik: String, _ adimlar: [String]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(baslik).fontWeight(.semibold)
            ForEach(Array(adimlar.enumerated()), id: \.offset) { i, a in
                Text("\(i + 1). \(a)").foregroundStyle(Tema.metin2)
            }
        }
        .padding(.vertical, 2)
    }

    private func adresAl(yenile: Bool) async {
        hata = nil
        kopyalandi = false
        do { adres = try await model.epostaAdresi(yenile: yenile) }
        catch { hata = (error as? AuthHatasi)?.turkish ?? error.localizedDescription }
    }

    private func dene() {
        do {
            sonuc = try model.read("try_bank_email", ["text": deneme]) as Deneme
            hata = nil
        } catch {
            sonuc = nil
            hata = error.localizedDescription
        }
    }

    @ViewBuilder private func denemeSonucu(_ s: Deneme) -> some View {
        let o = s.parsed
        VStack(alignment: .leading, spacing: 6) {
            Satir(title: L("Tutar"), value: o.amount.map { o.currency == nil || o.currency == Bicim.home ? Bicim.tl($0) : "\($0) \(o.currency ?? "")" } ?? "—")
            Satir(title: L("Tarih"), value: o.date.map { Bicim.day($0) } ?? "—")
            Satir(title: L("Taksit"), value: (o.installments ?? 1) > 1 ? L("{0} taksit", o.installments ?? 1) : L("Peşin"))
            Satir(title: L("İşyeri"), value: o.merchant ?? "—")
            Satir(title: L("Kart"), value: s.matchedCard ?? o.cardLast4.map { "•••• \($0)" } ?? "—")
            Text(s.wouldAutoAdd ? L("Kendiliğinden eklenir.") : L("Onaya düşer: {0}", EpostaKarti.neden(s.needsReview, o) ?? ""))
                .font(.footnote).foregroundStyle(s.wouldAutoAdd ? Tema.iyi : Tema.uyari)
        }
        .font(.subheadline)
    }
}

// Banka e-postaları → bildirim: uygulama kapalıyken eklenen harcama ve onay bekleyen e-posta (EpostaBildirim)
struct EpostaBildirimBolumu: View {
    @EnvironmentObject private var model: Model
    @Environment(\.openURL) private var openURL
    @State private var acik = EpostaBildirim.acik
    @State private var reddedildi = false

    var body: some View {
        Section {
            Toggle(L("Harcama eklenince bildir"), isOn: Binding(get: { acik }, set: { yeni in
                acik = yeni
                EpostaBildirim.acik = yeni
                EpostaBildirim.planla(model)
                Analitik.olay("inbox_notifications", ["enabled": yeni])
                guard yeni else { reddedildi = false; return }
                Task {
                    let c = UNUserNotificationCenter.current()
                    switch await c.notificationSettings().authorizationStatus {
                    case .notDetermined: reddedildi = !((try? await c.requestAuthorization(options: [.alert, .sound, .badge])) ?? false)
                    case .denied: reddedildi = true
                    default: reddedildi = false
                    }
                }
            }))
            if reddedildi {
                Button(L("Bildirim izni kapalı: iPhone Ayarları'nda aç")) {
                    if let u = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(u) }
                }
                .font(.footnote)
            }
        } footer: {
            Text(L("Uygulama kapalıyken iPhone ara sıra yeni e-postalara bakar (ne zaman olacağına iOS karar verir); eklenen harcamayı ve onay bekleyen e-postayı bildirir. Dokununca Harcamalar açılır."))
        }
        .task {
            if acik, await UNUserNotificationCenter.current().notificationSettings().authorizationStatus == .denied { reddedildi = true }
        }
    }
}

// Ödeme hatırlatmaları: aç / kapat, kaç gün önce, saat (Hatirlatma)
struct HatirlatmaBolumu: View {
    @EnvironmentObject private var model: Model
    @Environment(\.openURL) private var openURL
    @State private var acik = Hatirlatma.acik
    @State private var gun = Hatirlatma.gunOnce
    @State private var saat = Calendar.current.date(bySettingHour: Hatirlatma.dakika / 60, minute: Hatirlatma.dakika % 60, second: 0, of: Date()) ?? Date()
    @State private var reddedildi = false
    @State private var kesim = Hatirlatma.kesim
    @State private var bitis = Hatirlatma.bitis
    @State private var ayOzeti = Hatirlatma.ayOzeti

    var body: some View {
        Section {
            Toggle(L("Ödeme hatırlatmaları"), isOn: Binding(get: { acik }, set: { yeni in
                acik = yeni
                Task {
                    if yeni { acik = await Hatirlatma.ac(model, kaynak: "settings"); reddedildi = !acik }
                    else { await Hatirlatma.kapat(); reddedildi = false }
                }
            }))
            if acik {
                Picker(L("Ne zaman"), selection: $gun) {
                    Text(L("Ödeme günü")).tag(0)
                    Text(L("1 gün kala")).tag(1)
                    ForEach([2, 3, 7], id: \.self) { Text(L("{0} gün kala", $0)).tag($0) }
                }
                DatePicker(L("Saat"), selection: $saat, displayedComponents: .hourAndMinute)
                Toggle(L("Kesim gününden bir gün önce"), isOn: $kesim)
                Toggle(L("Taksit bitince"), isOn: $bitis)
                Toggle(L("Ay özeti"), isOn: $ayOzeti)
            }
            if reddedildi {
                Button(L("Bildirim izni kapalı: iPhone Ayarları'nda aç")) {
                    if let u = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(u) }
                }
                .font(.footnote)
            }
        } header: { Text(L("Bildirimler")) } footer: {
            Text(L("Kart ekstresi, kredi ve borç taksitlerinin ödeme gününü hatırlatır. Bildirimler bu telefonda kurulur; verin hiçbir yere gönderilmez."))
        }
        .onChange(of: gun) { _, v in Hatirlatma.gunOnce = v; Task { await Hatirlatma.kur(model) } }
        .onChange(of: kesim) { _, v in Hatirlatma.kesim = v; Task { await Hatirlatma.kur(model) } }
        .onChange(of: bitis) { _, v in Hatirlatma.bitis = v; Task { await Hatirlatma.kur(model) } }
        .onChange(of: ayOzeti) { _, v in Hatirlatma.ayOzeti = v; Task { await Hatirlatma.kur(model) } }
        .onChange(of: saat) { _, v in
            let c = Calendar.current.dateComponents([.hour, .minute], from: v)
            Hatirlatma.dakika = (c.hour ?? 10) * 60 + (c.minute ?? 0)
            Task { await Hatirlatma.kur(model) }
        }
        .task {
            // İzin iPhone Ayarları'ndan kaldırıldıysa anahtar kapalı görünür
            if acik, await Hatirlatma.izinDurumu() == .denied { reddedildi = true }
        }
    }
}

// Uygulama kilidi: Face ID / Touch ID / telefon şifresi (Kilit)
struct KilitBolumu: View {
    @EnvironmentObject private var kilit: Kilit

    var body: some View {
        if Kilit.kullanilabilir {
            Section {
                Toggle(L("{0} ile kilitle", Kilit.yontem), isOn: Binding(get: { kilit.acik }, set: { yeni in
                    Task { await kilit.ayarla(yeni) }
                }))
            } footer: {
                Text(L("Uygulama açılırken ve arka plandan dönerken sorar; uygulama değiştiricide tutarlar görünmez."))
            }
        }
    }
}

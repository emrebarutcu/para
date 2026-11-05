import Foundation
import SwiftUI

// Uygulamanın durumu: oturum, ekrandaki veri (Motor.box), eşitleme. Ekranlar veriyi araçlarla okur ve değiştirir
// (read / write); her değişiklikte revision artar, ekranlar yeniden okur, değişen satırlar 1.5 sn sonra buluta yazılır.
@MainActor
final class Model: ObservableObject {
    @Published private(set) var revision = 0
    @Published private(set) var session: Oturum?
    @Published private(set) var syncing = false
    @Published var syncError: String?
    @Published private(set) var lastSync: Date?
    @Published var showWelcome = false
    @Published var askMove = false          // girişsiz kullanımın verisi hesaba taşınsın mı (sync.js "Hesabıma taşı")
    @Published private(set) var country = "TR"   // hesabın ülkesi; ana para birimi ondan (para.js)
    @Published private(set) var epostalar: [Eposta] = []   // banka e-postalarından onay bekleyenler (Harcamalar)
    let motor: Motor?
    let startupError: String?
    let abonelik: Abonelik                       // CashFollow Premium (ekranlara ayrı environmentObject olarak verilir)
    private(set) var constants: Sabitler?

    private var senkron: Senkron?
    private var chain: Task<Void, Never>?
    private var pushTimer: Task<Void, Never>?

    init() {
        var motor: Motor?, failure: String?
        do { motor = try Motor() } catch { failure = error.localizedDescription }
        self.motor = motor
        self.startupError = failure
        abonelik = Abonelik { [motor] row in motor?.premium(row: row) ?? false }
        constants = motor?.constants()
        motor?.setRates(Depo.read(Depo.url("kur.json")))
        motor?.setPrices(Depo.read(Depo.url("fiyat.json")))
        session = Auth.stored()
        open(session?.userId)
        applyCountry()
        showWelcome = session == nil && !Depo.offlineChosen
        if session != nil, let local = Depo.read(Depo.stateFile(nil)), motor?.isBlank(local) == false { askMove = true }
        abonelik.hesap = { [weak self] in await self?.hesapAnahtari() }
    }

    // ── Veri ────────────────────────────────────────────────────────────────────

    // Ekrandaki veri: kullanıcının (ya da girişsiz kullanımın) dosyası
    private func open(_ userId: String?) {
        guard let motor else { return }
        let file = Depo.stateFile(userId)
        epostalar = []
        motor.box.json = Depo.read(file) ?? motor.defaultState
        motor.box.onSave = { [weak self] json in
            Depo.write(file, json)
            self?.changed()
        }
        senkron = userId.map { uid in
            Senkron(userId: uid, motor: motor, token: { [weak self] in try await self?.token() ?? "" }, apply: { [weak self] json in
                guard let self, self.session?.userId == uid else { return }
                motor.box.json = json
                Depo.write(file, json)
                self.revision += 1
            })
        }
        revision += 1
    }

    private func changed() {
        revision += 1
        schedulePush()
    }

    // Kişi ve kart renkleri (grafikler, avatarlar); revision değişince yeniden okunur
    private var renkOnbellek: (rev: Int, r: Renkler)?
    var renkler: Renkler {
        if let c = renkOnbellek, c.rev == revision { return c.r }
        let r = motor?.colors() ?? Renkler(people: [:], cards: [:])
        renkOnbellek = (revision, r)
        return r
    }
    func kisiRengi(_ key: String) -> Color { Tema.seri(renkler.people[key] ?? 0) }
    func kartRengi(_ key: String) -> Color { key == "Nakit" ? Tema.nakit : Tema.seri(renkler.cards[key] ?? 0) }

    private func engine() throws -> Motor {
        guard let motor else { throw AracHatasi(message: startupError ?? L("Uygulama çekirdeği açılamadı"), user: false) }
        return motor
    }

    // Okuyan araçlar (get_overview, list_cards…)
    func read<T: Decodable>(_ tool: String, _ args: [String: Any] = [:]) throws -> T {
        try engine().run(tool, args)
    }

    // Değiştiren araçlar (add_purchase, delete_card…): veri kaydedilir, ekranlar yenilenir, buluta yazılır
    func write<T: Decodable>(_ tool: String, _ args: [String: Any] = [:], as type: T.Type) throws -> T {
        try engine().run(tool, args)
    }

    @discardableResult
    func write(_ tool: String, _ args: [String: Any] = [:]) throws -> Data {
        try engine().runJSON(tool, args)
    }

    // ── Grafikler (nakit.js) ───────────────────────────────────────────────────

    func cash(start: String, shift: Int) throws -> NakitSerisi {
        try engine().cash(start: start, shift: shift)
    }

    // Geçmiş kapanışlar (/api/gecmis) dönem başına bir saat saklanır
    private var histories: [Int: (codes: String, json: String, at: Date)] = [:]

    // Varlığın seyri: range 1m, 3m, 6m, 1y, all; kayıt yoksa nil
    func assetSeries(range: String) async throws -> VarlikSerisi? {
        let motor = try engine()
        let plan = try motor.assetPlan(range: range)
        guard let span = plan.span else { return nil }
        var series = "{}"
        if !plan.codes.isEmpty {
            let key = plan.codes.joined(separator: ",")
            if let h = histories[span], h.codes == key, Date().timeIntervalSince(h.at) < 3600 {
                series = h.json
            } else if let json = try? await Piyasa.history(plan.codes, days: span) {
                histories[span] = (key, json, Date())
                series = json
            }
        }
        return try motor.asset(range: range, seriesJSON: series)
    }

    // ── Eşitleme ───────────────────────────────────────────────────────────────

    // Uygulama açılınca, öne gelince ve aşağı çekince: kurlar, fiyatlar; girişliyse çek ve yaz
    func refresh() async {
        async let market: Void = refreshMarket()
        await run { try await $0.pull(); try await $0.push() }
        await checkInbox()
        await market
        await sendProfile()
        await abonelik.yenile()
    }

    // Cihazın saat dilimi ya da uygulamanın dili değiştiyse hesaba yazılır (asistan "bugün"ü saat dilimine göre
    // hesaplar, giriş e-postaları bu dilde gider; şablonlar şimdilik Türkçe / İngilizce: "tr" dışındaki dillere İngilizce)
    private func sendProfile() async {
        let tz = TimeZone.current.identifier, profil = "\(tz)|\(Dil.kod)"
        guard let uid = session?.userId, UserDefaults.standard.string(forKey: "para.profil.\(uid)") != profil,
              let t = try? await token(), var s = session, s.userId == uid else { return }
        s.accessToken = t
        if (try? await Auth.updateProfile(s, tz: tz, lang: Dil.kod)) != nil {
            UserDefaults.standard.set(profil, forKey: "para.profil.\(uid)")
        }
    }

    // ── Banka e-postaları (yalnızca Türkiye; web'deki checkInbox) ──────────────

    // Okunabilen ve kartı bulunan e-postalar harcama olarak eklenir (ilk kişiye); kalanlar Harcamalar'da onaya bekler.
    // Önce sunucuda işlendi yapılır: başka cihaz aynı anda okuduysa harcama iki kez eklenmez.
    // Eklenen harcama sayısı; denenemediyse (giriş yok, ağ, başka kontrol sürüyor) nil
    private var inboxBusy = false
    @discardableResult
    private func checkInbox() async -> Int? {
        guard marketsAllowed else { epostalar = []; return nil }   // ülke Türkiye değilse onay bekleyenler de gizlenir
        guard let motor, let s = senkron, s.pulled, !inboxBusy else { return nil }
        inboxBusy = true
        defer { inboxBusy = false }
        var eklenen = 0
        do {
            let rows = try await s.inboxPending()
            guard senkron === s else { return nil }
            motor.setInbox(rows: rows)
            let ready = (try motor.run("list_inbox") as EpostaListesi).emails.filter { $0.needsReview == nil }.map(\.emailId)
            if !ready.isEmpty {
                let granted = try await s.inboxClaim(ready)
                guard senkron === s else { try? await s.inboxRelease(granted); return nil }
                motor.setInbox(rows: rows, granted: granted)
                if let out = try? motor.run("check_inbox") as EpostaSonucu, !out.added.isEmpty {
                    eklenen = out.added.count
                    Analitik.olay("inbox_added", ["count": eklenen])
                }
                let released = motor.inboxReleased()
                if !released.isEmpty { try? await s.inboxRelease(released) }
            }
            epostalar = (try motor.run("list_inbox", ["include_body": true]) as EpostaListesi).emails
            return eklenen
        } catch {
            // Tablo kurulmamış ya da ağ yok: sonraki yenilemede yeniden denenir
            return nil
        }
    }

    // Ayarlar → Banka e-postaları: "Şimdi kontrol et"; önce eşitlenir (kartların son 4 hanesi güncel olsun)
    func epostaKontrol() async -> Int? {
        await run { try await $0.pull() }
        return await checkInbox()
    }

    // "<adres>@cashfollow.app"; renew eskisini siler (bankadaki adres de değişmeli)
    func epostaAdresi(yenile: Bool) async throws -> String {
        _ = try await token()
        guard let s = senkron else { throw AracHatasi(message: L("Önce giriş yap"), user: true) }
        return "\(try await s.inboxAddress(renew: yenile))@\(Yapilandirma.inboxDomain)"
    }

    // Onay bekleyen e-posta eklendi ya da yok sayıldı: sunucuda işlendi yapılır
    func epostaBitti(_ id: Int) async {
        epostalar.removeAll { $0.emailId == id }
        _ = try? await senkron?.inboxClaim([id])
    }

    func schedulePush() {
        guard senkron != nil else { return }
        pushTimer?.cancel()
        pushTimer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            guard !Task.isCancelled else { return }
            await self?.run { try await $0.push() }
        }
    }

    // Eşitlemeler sırayla çalışır (taban aynı anda iki yerden değişmesin); hata sonraki denemeye kalır
    private func run(_ task: @escaping (Senkron) async throws -> Void) async {
        let previous = chain
        let next = Task { [weak self] in
            await previous?.value
            guard let self, let s = self.senkron else { return }
            self.syncing = true
            defer { self.syncing = false }
            do {
                try await task(s)
                if self.senkron === s { self.syncError = nil; self.lastSync = Date() }
            } catch {
                if self.senkron === s { self.syncError = (error as? AuthHatasi)?.turkish ?? error.localizedDescription }
            }
        }
        chain = next
        await next.value
    }

    private func refreshMarket() async {
        guard let motor else { return }
        if let json = try? await Piyasa.rates() {
            Depo.write(Depo.url("kur.json"), json)
            motor.setRates(json)
        }
        let codes = motor.marketCodes()
        if !codes.isEmpty, let json = try? await Piyasa.prices(codes) {
            Depo.write(Depo.url("fiyat.json"), json)
            motor.setPrices(json)
        }
        revision += 1
    }

    // Fon / hisse alışından önce o kodun güncel fiyatı (add_entry kodu doğrular, fiyatı bugünkü işlemde kendisi koyar)
    func fetchPrices(_ extra: [String]) async {
        guard let motor else { return }
        let codes = Array(Set(motor.marketCodes() + extra)).sorted()
        guard !codes.isEmpty, let json = try? await Piyasa.prices(codes) else { return }
        Depo.write(Depo.url("fiyat.json"), json)
        motor.setPrices(json)
    }

    // ── Oturum ─────────────────────────────────────────────────────────────────

    // Süresi dolmak üzereyse yenilenir; yenileme reddedilirse (oturum kapatılmış) yeniden giriş gerekir
    private func token() async throws -> String {
        guard var s = session else { throw AuthHatasi(status: 401, code: nil, message: L("Giriş yapılmadı")) }
        if s.expiresAt.timeIntervalSinceNow < 60 {
            do {
                s = try await Auth.refresh(s)
            } catch let e as AuthHatasi where (400..<500).contains(e.status) {
                expire()
                throw AuthHatasi(status: 401, code: nil, message: L("Oturumun süresi doldu, yeniden giriş yap."))
            }
            guard session?.userId == s.userId else { throw CancellationError() }
            session = s
            Auth.store(s)
        }
        return s.accessToken
    }

    // Girişliyse hesabın kimliği ve geçerli anahtar (Abonelik: hesabın Premium satırı, aboneliği hesaba bağlama)
    func hesapAnahtari() async -> (id: String, token: String)? {
        guard let id = session?.userId, let t = try? await token(), session?.userId == id else { return nil }
        return (id, t)
    }

    // Oturum geçersiz: veri cihazda kalır, aynı hesapla girince kaldığı yerden eşitlenir
    private func expire() {
        abonelik.cikis()
        Auth.store(nil)
        session = nil
        open(nil)
        applyCountry()
    }

    func signedIn(_ s: Oturum) {
        Analitik.girisYapti(s.userId)
        Analitik.olay("signed_in")
        Auth.store(s)
        session = s
        showWelcome = false
        open(s.userId)
        applyCountry()
        let local = Depo.read(Depo.stateFile(nil))
        if let local, let motor, !motor.isBlank(local) { askMove = true }
        Task { await refresh() }
    }

    // Girişsizken girilen veri: hesaba eklenir (önce hesaptaki veri çekilir) ya da silinir. Seçilene kadar silinmez.
    func moveLocal(_ keep: Bool) async {
        askMove = false
        let file = Depo.stateFile(nil)
        guard keep else { Depo.remove(file); return }
        guard let motor, let local = Depo.read(file), let uid = session?.userId else { return }
        await run { try await $0.pull() }
        guard senkron?.pulled == true, session?.userId == uid else {
            syncError = L("Hesaptaki veri alınamadı; cihazdaki veri taşınmadı. Bağlantı gelince yeniden dene.")
            askMove = true
            return
        }
        do {
            let combined = try motor.combine(account: motor.box.json, local: local)
            motor.box.json = combined
            motor.box.onSave?(combined)
            Depo.remove(file)
        } catch {
            syncError = error.localizedDescription
        }
    }

    func signOut() async {
        Analitik.olay("signed_out")
        defer { Analitik.cikisYapti() }
        pushTimer?.cancel()
        await run { try await $0.push() }   // bekleyen değişiklikler yazılsın
        guard let s = session else { return }
        await Auth.signOut(s)
        Auth.store(nil)
        abonelik.cikis(s.userId)
        // Hesabın verisi cihazdan silinir (bulutta durur)
        Depo.remove(Depo.stateFile(s.userId))
        Depo.remove(Depo.metaFile(s.userId))
        session = nil
        syncError = nil
        lastSync = nil
        open(nil)
        applyCountry()
    }

    // Hesabı ve bütün verisini siler (buluttan ve bu cihazdan); sonra uygulama girişsiz, boş açılır
    func deleteAccount() async throws {
        pushTimer?.cancel()
        guard var s = session else { return }
        s.accessToken = try await token()
        try await Auth.deleteAccount(s)
        Analitik.olay("account_deleted")
        Analitik.cikisYapti()
        Auth.store(nil)
        Depo.remove(Depo.stateFile(s.userId))
        Depo.remove(Depo.metaFile(s.userId))
        UserDefaults.standard.removeObject(forKey: "para.profil.\(s.userId)")
        UserDefaults.standard.removeObject(forKey: "para.tz.\(s.userId)")
        abonelik.cikis(s.userId)
        session = nil
        syncError = nil
        lastSync = nil
        open(nil)
        applyCountry()
    }

    // ── Ülke ve ana para birimi ────────────────────────────────────────────────

    // Hesabın (ya da girişsiz kullanımın) ülkesi: veri, kurlar, araçlar ve biçimler o ülkenin para birimiyle
    private func applyCountry() {
        let code = session.map { $0.country ?? "TR" } ?? Depo.offlineCountry ?? "TR"
        country = code
        Analitik.ulkeAyarla(code)
        guard let motor else { return }
        let home = motor.homeOf(country: code)
        motor.setHome(home)
        motor.setCashDef(Depo.cashDef)
        constants = motor.constants()
        let c = constants?.currencies.first { $0.code == home }
        Bicim.home = home
        Bicim.homeSymbol = c?.symbol ?? home
        // Kısa ad metinlerde ("TL bakiyemden"): İngilizcede para birimi kodu (USD), TL hariç
        Bicim.homeShort = Dil.turkceDegil ? (home == "TRY" ? "TL" : home) : (c?.short ?? home)
        if !marketsAllowed { epostalar = [] }   // banka e-postaları yalnızca Türkiye'de
        revision += 1
    }

    var home: String { Bicim.home }

    // Nakit sayılanlar (Özet'teki Nakit grafiği); nil varsayılana döner
    // Para piyasası fonları yalnızca Türkiye'de (marketsAllowed)
    var cashDef: [String] { (Depo.cashDef ?? constants?.cashDefault ?? [home, "MMF"]).filter { $0 != "MMF" || marketsAllowed } }
    func setCashDef(_ list: [String]?) {
        Depo.cashDef = list
        motor?.setCashDef(list)
        revision += 1
    }
    var marketsAllowed: Bool { constants?.markets ?? true }
    var aprAllowed: Bool { constants?.apr ?? false }      // kartın APR'si (döner kredi), ABD
    var bnplAllowed: Bool { constants?.bnpl ?? false }    // Pay in 4, ABD

    // Ülke değişince tutarlar çevrilmez: kayıtlar yazıldıkları para biriminde kalır
    func setCountry(_ code: String) async throws {
        if session != nil {
            _ = try await token()   // süresi dolmak üzereyse yenilenir
            guard let s = session else { return }
            let next = try await Auth.updateCountry(s, code)
            session = next
            Auth.store(next)
        } else {
            Depo.offlineCountry = code
        }
        applyCountry()
        schedulePush()
    }

    func continueOffline(country: String) {
        Analitik.olay("started_without_account", ["country": country])
        Depo.offlineCountry = country
        applyCountry()
        Depo.offlineChosen = true
        showWelcome = false
    }
}

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
    let motor: Motor?
    let startupError: String?
    private(set) var constants: Sabitler?

    private var senkron: Senkron?
    private var chain: Task<Void, Never>?
    private var pushTimer: Task<Void, Never>?

    init() {
        var motor: Motor?, failure: String?
        do { motor = try Motor() } catch { failure = error.localizedDescription }
        self.motor = motor
        self.startupError = failure
        constants = motor?.constants()
        motor?.setRates(Depo.read(Depo.url("kur.json")))
        motor?.setPrices(Depo.read(Depo.url("fiyat.json")))
        session = Auth.stored()
        open(session?.userId)
        showWelcome = session == nil && !Depo.offlineChosen
        if session != nil, let local = Depo.read(Depo.stateFile(nil)), motor?.isBlank(local) == false { askMove = true }
    }

    // ── Veri ────────────────────────────────────────────────────────────────────

    // Ekrandaki veri: kullanıcının (ya da girişsiz kullanımın) dosyası
    private func open(_ userId: String?) {
        guard let motor else { return }
        let file = Depo.stateFile(userId)
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

    private func engine() throws -> Motor {
        guard let motor else { throw AracHatasi(message: startupError ?? "Uygulama çekirdeği açılamadı", user: false) }
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

    // ── Eşitleme ───────────────────────────────────────────────────────────────

    // Uygulama açılınca, öne gelince ve aşağı çekince: kurlar, fiyatlar; girişliyse çek ve yaz
    func refresh() async {
        async let market: Void = refreshMarket()
        await run { try await $0.pull(); try await $0.push() }
        await market
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
        guard var s = session else { throw AuthHatasi(status: 401, code: nil, message: "Giriş yapılmadı") }
        if s.expiresAt.timeIntervalSinceNow < 60 {
            do {
                s = try await Auth.refresh(s)
            } catch let e as AuthHatasi where (400..<500).contains(e.status) {
                expire()
                throw AuthHatasi(status: 401, code: nil, message: "Oturumun süresi doldu, yeniden giriş yap.")
            }
            guard session?.userId == s.userId else { throw CancellationError() }
            session = s
            Auth.store(s)
        }
        return s.accessToken
    }

    // Oturum geçersiz: veri cihazda kalır, aynı hesapla girince kaldığı yerden eşitlenir
    private func expire() {
        Auth.store(nil)
        session = nil
        open(nil)
    }

    func signedIn(_ s: Oturum) {
        Auth.store(s)
        session = s
        showWelcome = false
        open(s.userId)
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
            syncError = "Hesaptaki veri alınamadı; cihazdaki veri taşınmadı. Bağlantı gelince yeniden dene."
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
        pushTimer?.cancel()
        await run { try await $0.push() }   // bekleyen değişiklikler yazılsın
        guard let s = session else { return }
        await Auth.signOut(s)
        Auth.store(nil)
        // Hesabın verisi cihazdan silinir (bulutta durur)
        Depo.remove(Depo.stateFile(s.userId))
        Depo.remove(Depo.metaFile(s.userId))
        session = nil
        syncError = nil
        lastSync = nil
        open(nil)
    }

    func continueOffline() {
        Depo.offlineChosen = true
        showWelcome = false
    }
}

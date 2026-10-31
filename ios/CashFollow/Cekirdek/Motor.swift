import Foundation
import JavaScriptCore
import Security

// Aracın kullanıcıya gösterilecek hatası (doğrulama) ya da iç hata
struct AracHatasi: LocalizedError {
    let message: String
    let user: Bool
    var errorDescription: String? { message }
}

// Kayıtlı verinin (web'deki localStorage cashflow.v1 biçimi) bellekteki kopyası; JavaScript native.load / save ile okur
// ve yazar, Depo diske yazar.
final class VeriKutusu {
    var json: String
    var onSave: ((String) -> Void)?
    init(json: String = "") { self.json = json }
}

// Web'in hesap modüllerini ve asistan araçlarını (mcp/tools.js) çalıştıran JavaScriptCore bağlamı. Hesap kuralları
// (kesim / son ödeme, taksit, bakiye, borç) burada yeniden yazılmaz: ekranlar araçları çağırır. Ana iş parçacığında.
@MainActor
final class Motor {
    // Yükleme sırası: her modül kendinden öncekileri genel nesneden alır (ios/js/kopru.js)
    private static let scripts = ["tekrar", "taksit", "varlik", "borc", "kategori", "eposta", "icgoru", "tablo", "kopru"]

    let box: VeriKutusu
    private let context: JSContext
    private let kopru: JSValue
    private var lastException: String?

    init() throws {
        guard let context = JSContext() else { throw AracHatasi(message: "JavaScriptCore açılamadı", user: false) }
        let box = VeriKutusu()
        self.box = box
        self.context = context
        context.name = "CashFollow"

        let native = JSValue(newObjectIn: context)!
        let load: @convention(block) () -> String = { box.json }
        let save: @convention(block) (String) -> Void = { json in
            box.json = json
            box.onSave?(json)
        }
        let random: @convention(block) (Int) -> [Int] = { n in
            var bytes = [UInt8](repeating: 0, count: max(n, 0))
            if SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) != errSecSuccess {
                bytes = bytes.map { _ in UInt8.random(in: 0...255) }
            }
            return bytes.map(Int.init)
        }
        let log: @convention(block) (String, String) -> Void = { level, msg in
            #if DEBUG
            print("js \(level): \(msg)")
            #endif
        }
        native.setObject(unsafeBitCast(load, to: AnyObject.self), forKeyedSubscript: "load" as NSString)
        native.setObject(unsafeBitCast(save, to: AnyObject.self), forKeyedSubscript: "save" as NSString)
        native.setObject(unsafeBitCast(random, to: AnyObject.self), forKeyedSubscript: "random" as NSString)
        native.setObject(unsafeBitCast(log, to: AnyObject.self), forKeyedSubscript: "log" as NSString)
        context.setObject(native, forKeyedSubscript: "native" as NSString)

        var failure: String?
        context.exceptionHandler = { _, value in
            failure = value?.toString() ?? "JavaScript hatası"
        }
        for name in Self.scripts {
            guard let url = Bundle.main.url(forResource: name, withExtension: "js", subdirectory: "js"),
                  let src = try? String(contentsOf: url, encoding: .utf8) else {
                throw AracHatasi(message: "\(name).js uygulama paketinde yok (Xcode → Web modülleri adımı)", user: false)
            }
            context.evaluateScript(src, withSourceURL: url)
            if let failure { throw AracHatasi(message: "\(name).js: \(failure)", user: false) }
        }
        guard let kopru = context.objectForKeyedSubscript("Kopru"), kopru.isObject else {
            throw AracHatasi(message: "Kopru yüklenemedi", user: false)
        }
        guard let url = Bundle.main.url(forResource: "tools", withExtension: "js", subdirectory: "js"),
              let tools = try? String(contentsOf: url, encoding: .utf8) else {
            throw AracHatasi(message: "tools.js uygulama paketinde yok", user: false)
        }
        kopru.invokeMethod("loadTools", withArguments: [tools])
        if let failure { throw AracHatasi(message: "tools.js: \(failure)", user: false) }
        self.kopru = kopru

        context.exceptionHandler = { [weak self] _, value in
            self?.lastException = value?.toString() ?? "JavaScript hatası"
        }
    }

    // ── Araçlar (mcp/tools.js) ──────────────────────────────────────────────────

    // Aracı çalıştırır, cevabı JSON olarak döndürür. Araçlar ağ beklemez (kurlar önceden verilir): sonuç JavaScriptCore
    // çağrıdan dönerken bekleyen işleri (Promise) bitirince gelir.
    @discardableResult
    func runJSON(_ tool: String, _ args: [String: Any] = [:]) throws -> Data {
        let argsData = try JSONSerialization.data(withJSONObject: args)
        var out: String?
        var error: AracHatasi?
        let done: @convention(block) (JSValue, JSValue) -> Void = { value, err in
            if err.isObject {
                error = AracHatasi(message: err.forProperty("message")?.toString() ?? "Hata",
                                   user: err.forProperty("user")?.toBool() ?? false)
            } else {
                out = value.toString()
            }
        }
        lastException = nil
        kopru.invokeMethod("run", withArguments: [tool, String(decoding: argsData, as: UTF8.self), "", JSValue(object: unsafeBitCast(done, to: AnyObject.self), in: context)!])
        if out == nil && error == nil { context.evaluateScript("void 0") }   // bekleyen işler bitsin
        if let error { throw error }
        if let lastException { throw AracHatasi(message: lastException, user: false) }
        guard let out else { throw AracHatasi(message: "\(tool) sonuç vermedi", user: false) }
        return Data(out.utf8)
    }

    func run<T: Decodable>(_ tool: String, _ args: [String: Any] = [:], as type: T.Type = T.self) throws -> T {
        let data = try runJSON(tool, args)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw AracHatasi(message: "\(tool) cevabı okunamadı: \(error)", user: false)
        }
    }

    // ── Kurlar, fiyatlar, sabitler ─────────────────────────────────────────────

    func setRates(_ json: String?) { kopru.invokeMethod("setRates", withArguments: [json.map { $0 as Any } ?? NSNull()]) }
    func setPrices(_ json: String?) { kopru.invokeMethod("setPrices", withArguments: [json.map { $0 as Any } ?? NSNull()]) }

    func marketCodes() -> [String] {
        kopru.invokeMethod("marketCodes", withArguments: [])?.toArray()?.compactMap { $0 as? String } ?? []
    }

    func constants() -> Sabitler? {
        guard let json = kopru.invokeMethod("constants", withArguments: [])?.toString() else { return nil }
        return try? JSONDecoder().decode(Sabitler.self, from: Data(json.utf8))
    }

    var defaultState: String { kopru.invokeMethod("defaultState", withArguments: [])?.toString() ?? "" }

    // ── Eşitleme (tablo.js; Senkron.swift) ─────────────────────────────────────

    private func sync(_ fn: String, _ args: [Any]) throws -> JSValue {
        lastException = nil
        guard let s = kopru.forProperty("sync"), let v = s.invokeMethod(fn, withArguments: args) else {
            throw AracHatasi(message: "sync.\(fn)", user: false)
        }
        if let lastException { throw AracHatasi(message: "sync.\(fn): \(lastException)", user: false) }
        return v
    }

    var tables: [String] { kopru.forProperty("sync")?.forProperty("TABLES")?.toArray()?.compactMap { $0 as? String } ?? [] }
    var schema: Int { Int(kopru.forProperty("sync")?.forProperty("SCHEMA")?.toInt32() ?? 0) }

    func isBlank(_ state: String) -> Bool { (try? sync("isBlank", [state]).toBool()) ?? true }
    func stale(state: String, base: String) throws -> Bool { try sync("stale", [state, base]).toBool() }
    func rekey(base: String) throws -> String { try sync("rekey", [base]).toString() }
    func changes(state: String, base: String) throws -> String { try sync("changes", [state, base]).toString() }
    func fromRows(state: String, rows: String) throws -> String { try sync("fromRows", [state, rows]).toString() }
    func merge(state: String, base: String, rows: String) throws -> String { try sync("merge", [state, base, rows]).toString() }
    func combine(account: String, local: String) throws -> String { try sync("combine", [account, local]).toString() }
}

struct Sabitler: Decodable {
    struct Kategori: Decodable, Identifiable, Hashable { let id: String; let name: String; let hint: String }
    struct Varlik: Decodable, Identifiable, Hashable {
        let code: String; let name: String; let short: String; let symbol: String; let digits: Int
        var id: String { code }
    }
    let categories: [Kategori]
    let assets: [Varlik]
}

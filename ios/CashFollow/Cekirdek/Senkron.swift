import Foundation

// Bulut eşitlemesi: web'deki sync.js'in pull / push'unun aynısı. Her kişi, kart, harcama, varlık hareketi ve borç kaydı
// Supabase'te ayrı bir satırdır (supabase/tablolar.sql); yalnızca değişen satırlar yazılır, silinenler deleted_at ile
// işaretlenir. Hangi satırın değiştiğini, uzaktan gelenin yerel değişikliği ezip ezmeyeceğini tablo.js bilir (Motor).
// Realtime yok: uygulama açılınca, öne gelince, her kayıttan sonra ve aşağı çekince eşitlenir.
@MainActor
final class Senkron {
    private static let page = 1000       // PostgREST'in bir cevapta döndürdüğü en fazla satır
    private static let batch = 200       // bir istekte yazılan / silinen en fazla satır
    private static let overlap: TimeInterval = 30   // imleçten bu kadar sn geriden okunur: aynı anda biten yazmalar kaçmasın

    let userId: String
    private let motor: Motor
    private let token: () async throws -> String
    private let apply: (String) -> Void   // uzaktan gelenlerle yeni veri (ekrana ve diske)

    init(userId: String, motor: Motor, token: @escaping () async throws -> String, apply: @escaping (String) -> Void) {
        self.userId = userId
        self.motor = motor
        self.token = token
        self.apply = apply
    }

    // ── Taban ve imleç ──────────────────────────────────────────────────────────

    // Bu cihazda hesabın verisi en az bir kez çekildi mi
    var pulled: Bool { loadMeta() != nil }

    private func loadMeta() -> EsitlemeMeta? {
        guard let text = Depo.read(Depo.metaFile(userId)),
              var meta = try? JSONDecoder().decode(EsitlemeMeta.self, from: Data(text.utf8)) else { return nil }
        if meta.schema != motor.schema {   // önceki sürümün tabanı: yeni satır biçimine çevrilir, bütün satırlar yeniden çekilir
            guard let rekeyed = try? motor.rekey(base: Self.json(meta.base)),
                  let base = Self.decodeBase(rekeyed) else { return nil }
            meta = EsitlemeMeta(base: base, cursor: [:], schema: motor.schema)
            saveMeta(meta)
        }
        return meta
    }

    private func saveMeta(_ meta: EsitlemeMeta) {
        if let data = try? JSONEncoder().encode(meta) { Depo.write(Depo.metaFile(userId), String(decoding: data, as: UTF8.self)) }
    }

    // ── Çekme ───────────────────────────────────────────────────────────────────

    func pull() async throws {
        var meta = loadMeta()
        // Ekrandaki veri boşken taban doluysa taban geçersizdir: hiç eşitlenmemiş cihaz gibi bütün satırlar baştan çekilir
        if let m = meta, try motor.stale(state: motor.box.json, base: Self.json(m.base)) { meta = nil }

        var rows: [String: [[String: Any]]] = [:]
        for t in motor.tables {
            let since = meta?.cursor[t].flatMap(Self.time).map { Self.iso($0.addingTimeInterval(-Self.overlap)) }
            rows[t] = try await fetchRows(t, since: since)
        }
        let rowsJSON = Self.json(rows)

        let state: String, base: [String: [String: String]], changed: Bool
        if meta == nil && rows.values.contains(where: { !$0.isEmpty }) {
            let out = try Self.object(motor.fromRows(state: motor.box.json, rows: rowsJSON))
            state = Self.json(out["state"] ?? [String: Any]())
            base = out["base"] as? [String: [String: String]] ?? [:]
            changed = true
        } else {
            let out = try Self.object(motor.merge(state: motor.box.json, base: Self.json(meta?.base ?? [:]), rows: rowsJSON))
            state = Self.json(out["state"] ?? [String: Any]())
            base = out["base"] as? [String: [String: String]] ?? [:]
            changed = out["changed"] as? Bool ?? false
        }
        var cursor = meta?.cursor ?? [:]
        for (t, list) in rows {
            for r in list {
                guard let at = r["updated_at"] as? String, let time = Self.time(at) else { continue }
                if let cur = cursor[t].flatMap(Self.time), cur >= time { continue }
                cursor[t] = at
            }
        }
        saveMeta(EsitlemeMeta(base: base, cursor: cursor, schema: motor.schema))
        if changed { apply(state) }
    }

    // since'ten sonra değişen satırlar (silinenler dahil), updated_at sırasıyla
    private func fetchRows(_ table: String, since: String?) async throws -> [[String: Any]] {
        var rows: [[String: Any]] = []
        var last: [String: Any]?
        while true {
            var q: [(String, String)] = [("select", "*"), ("user_id", "eq.\(userId)"), ("order", "updated_at.asc,id.asc"), ("limit", "\(Self.page)")]
            if let last {
                let at = Self.quote(last["updated_at"] as? String ?? ""), id = Self.quote(last["id"] as? String ?? "")
                q.append(("or", "(updated_at.gt.\(at),and(updated_at.eq.\(at),id.gt.\(id)))"))
            } else if let since {
                q.append(("updated_at", "gt.\(since)"))
            }
            let data = try await rest(table, query: q)
            let page = (try JSONSerialization.jsonObject(with: data)) as? [[String: Any]] ?? []
            rows += page
            if page.count < Self.page { return rows }
            last = page.last
        }
    }

    // ── Yazma ───────────────────────────────────────────────────────────────────

    func push() async throws {
        if loadMeta() == nil { try await pull() }
        guard var meta = loadMeta() else { return }
        let state = motor.box.json
        // Boş ekran tabandaki her kaydı silinmiş gösterir: silme yazılmaz, veri tablolardan yeniden alınır
        if try motor.stale(state: state, base: Self.json(meta.base)) { try await pull(); return }
        let plan = try Self.object(motor.changes(state: state, base: Self.json(meta.base)))

        for t in motor.tables {
            let list = (plan[t] as? [String: Any])?["upsert"] as? [[String: Any]] ?? []
            for part in Self.chunks(list) {
                let body = part.map { x -> [String: Any] in
                    var row = x["row"] as? [String: Any] ?? [:]
                    row["user_id"] = userId
                    row["deleted_at"] = NSNull()
                    return row
                }
                _ = try await rest(t, query: [("on_conflict", "user_id,id")], method: "POST",
                                   body: try JSONSerialization.data(withJSONObject: body), prefer: "resolution=merge-duplicates,return=minimal")
                for x in part { if let id = x["id"] as? String, let key = x["key"] as? String { meta.base[t, default: [:]][id] = key } }
                saveMeta(meta)
            }
        }
        // Silinenler: önce harcamalar, sonra kartlar ve kişiler
        let deletedAt = Self.iso(Date())
        for t in motor.tables.reversed() {
            let ids = (plan[t] as? [String: Any])?["delete"] as? [String] ?? []
            for part in Self.chunks(ids) {
                _ = try await rest(t, query: [("user_id", "eq.\(userId)"), ("id", "in.(\(part.map(Self.quote).joined(separator: ",")))")],
                                   method: "PATCH", body: try JSONSerialization.data(withJSONObject: ["deleted_at": deletedAt]), prefer: "return=minimal")
                for id in part { meta.base[t]?.removeValue(forKey: id) }
                saveMeta(meta)
            }
        }
    }

    // ── PostgREST ───────────────────────────────────────────────────────────────

    private func rest(_ table: String, query: [(String, String)], method: String = "GET", body: Data? = nil, prefer: String? = nil) async throws -> Data {
        let bearer = try await token()
        let q = query.map { "\(Self.encode($0.0))=\(Self.encode($0.1))" }.joined(separator: "&")
        var req = URLRequest(url: URL(string: "\(Yapilandirma.supabaseURL.absoluteString)/rest/v1/\(table)?\(q)")!)
        req.httpMethod = method
        req.setValue(Yapilandirma.supabaseKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let prefer { req.setValue(prefer, forHTTPHeaderField: "Prefer") }
        req.httpBody = body
        let (data, res) = try await URLSession.shared.data(for: req)
        let status = (res as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw AracHatasi(message: "Supabase \(status): \(String(decoding: data.prefix(300), as: UTF8.self))", user: false)
        }
        return data
    }

    // ── Yardımcılar ─────────────────────────────────────────────────────────────

    private static let unreserved = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
    private static func encode(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: unreserved) ?? s }
    // PostgREST in.(…) / or=(…) değeri
    private static func quote(_ v: String) -> String { "\"" + v.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\"" }

    private static func chunks<T>(_ list: [T]) -> [[T]] {
        stride(from: 0, to: list.count, by: batch).map { Array(list[$0..<min($0 + batch, list.count)]) }
    }

    // PostgREST zamanı (mikrosaniyeli, "+00:00") → Date; kesir 3 haneye kısaltılır (sync.js time gibi)
    private static let isoFrac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoPlain = ISO8601DateFormatter()
    static func time(_ s: String) -> Date? {
        var t = s
        if let dot = t.firstIndex(of: ".") {
            let digits = t[t.index(after: dot)...].prefix(while: \.isNumber)
            let frac = String((digits + "000").prefix(3))
            t = String(t[..<dot]) + "." + frac + String(t[t.index(after: dot)...].dropFirst(digits.count))
            return isoFrac.date(from: t)
        }
        return isoPlain.date(from: t)
    }
    static func iso(_ d: Date) -> String { isoFrac.string(from: d) }

    static func json(_ v: Any) -> String {
        (try? JSONSerialization.data(withJSONObject: v)).map { String(decoding: $0, as: UTF8.self) } ?? "{}"
    }
    private static func object(_ json: String) throws -> [String: Any] {
        guard let o = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else {
            throw AracHatasi(message: "eşitleme: beklenmeyen cevap", user: false)
        }
        return o
    }
    private static func decodeBase(_ json: String) -> [String: [String: String]]? {
        (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: [String: String]]
    }
}

// Kurlar ve fon / hisse fiyatları: cashfollow.app'in Worker'ı (mcp/kur.js, mcp/piyasa.js)
enum Piyasa {
    private static func get(_ path: String) async throws -> String {
        var req = URLRequest(url: URL(string: Yapilandirma.site.absoluteString + path)!)
        req.timeoutInterval = 15
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, res) = try await URLSession.shared.data(for: req)
        guard (res as? HTTPURLResponse)?.statusCode == 200,
              (try? JSONSerialization.jsonObject(with: data)) is [String: Any] else {
            throw AracHatasi(message: "Kurlar şu an alınamıyor.", user: true)
        }
        return String(decoding: data, as: UTF8.self)
    }

    // { rates: { TRY, USD, EUR, GAU }, updatedAt, source }
    static func rates() async throws -> String { try await get("/api/kur") }

    // { prices: { "FON:AFT": { price, … } }, missing, failed, updatedAt }
    static func prices(_ codes: [String]) async throws -> String {
        try await get("/api/fiyat?kod=" + codes.joined(separator: ",").addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)!)
    }
}

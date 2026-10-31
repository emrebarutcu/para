import Foundation

// Supabase Auth (GoTrue) REST: e-posta ve şifreyle giriş / kayıt, şifre sıfırlama, oturum yenileme. Web'deki sync.js'in
// supabase-js ile yaptıklarının aynısı. E-postadaki bağlantılar (doğrulama, şifre sıfırlama) cashfollow.app'te açılır.
struct Oturum: Codable, Equatable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date
    var userId: String
    var email: String
}

enum KayitSonucu {
    case session(Oturum)   // doğrulama gerekmiyor, giriş yapıldı
    case confirmEmail      // e-postadaki bağlantıyla doğrulanacak
    case alreadyExists     // adres zaten kayıtlı (Supabase bunu belli etmemek için başarılı döner)
}

struct AuthHatasi: LocalizedError {
    let status: Int
    let code: String?
    let message: String
    var errorDescription: String? { message }

    // Kullanıcıya Türkçe (web'deki iletiler)
    var turkish: String {
        if code == "email_not_confirmed" || message == "Email not confirmed" {
            return "E-posta adresin henüz doğrulanmadı. E-postana gelen bağlantıya tıkla."
        }
        if code == "invalid_credentials" || message == "Invalid login credentials" { return "E-posta veya şifre hatalı." }
        if status == 429 || code == "over_email_send_rate_limit" { return "Biraz bekleyip yeniden dene." }
        if code == "weak_password" { return "Şifre çok zayıf: en az 6 karakter olmalı." }
        if code == "validation_failed" || code == "email_address_invalid" { return "E-posta adresi geçersiz." }
        return message
    }
    var unconfirmed: Bool { code == "email_not_confirmed" || message == "Email not confirmed" }
}

enum Auth {
    // path sorgu da içerebilir ("token?grant_type=password")
    private static func endpoint(_ path: String, redirect: Bool = false) -> URL {
        var c = URLComponents(string: Yapilandirma.supabaseURL.absoluteString + "/auth/v1/" + path)!
        if redirect { c.queryItems = (c.queryItems ?? []) + [URLQueryItem(name: "redirect_to", value: Yapilandirma.site.absoluteString)] }
        return c.url!
    }

    private static func post(_ url: URL, _ body: [String: Any], token: String? = nil) async throws -> [String: Any] {
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue(Yapilandirma.supabaseKey, forHTTPHeaderField: "apikey")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, res) = try await URLSession.shared.data(for: req)
        let status = (res as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (200..<300).contains(status) else {
            let code = json["error_code"] as? String ?? json["error"] as? String
            let msg = json["msg"] as? String ?? json["error_description"] as? String ?? json["message"] as? String
                ?? "Sunucu hatası (\(status))"
            throw AuthHatasi(status: status, code: code, message: msg)
        }
        return json
    }

    private static func session(_ json: [String: Any]) -> Oturum? {
        guard let access = json["access_token"] as? String, let refresh = json["refresh_token"] as? String,
              let user = json["user"] as? [String: Any], let id = user["id"] as? String else { return nil }
        let expires: Date
        if let at = json["expires_at"] as? Double { expires = Date(timeIntervalSince1970: at) }
        else { expires = Date().addingTimeInterval(json["expires_in"] as? Double ?? 3600) }
        return Oturum(accessToken: access, refreshToken: refresh, expiresAt: expires, userId: id, email: user["email"] as? String ?? "")
    }

    static func signIn(email: String, password: String) async throws -> Oturum {
        let json = try await post(endpoint("token?grant_type=password"), ["email": email, "password": password])
        guard let s = session(json) else { throw AuthHatasi(status: 0, code: nil, message: "Oturum açılamadı") }
        return s
    }

    static func signUp(email: String, password: String) async throws -> KayitSonucu {
        let json = try await post(endpoint("signup", redirect: true), ["email": email, "password": password])
        if let s = session(json) { return .session(s) }
        let user = json["user"] as? [String: Any] ?? json
        if let ids = user["identities"] as? [Any], ids.isEmpty { return .alreadyExists }
        return .confirmEmail
    }

    static func resend(email: String) async throws {
        _ = try await post(endpoint("resend", redirect: true), ["type": "signup", "email": email])
    }

    static func recover(email: String) async throws {
        _ = try await post(endpoint("recover", redirect: true), ["email": email])
    }

    static func refresh(_ s: Oturum) async throws -> Oturum {
        let json = try await post(endpoint("token?grant_type=refresh_token"), ["refresh_token": s.refreshToken])
        guard let next = session(json) else { throw AuthHatasi(status: 0, code: nil, message: "Oturum yenilenemedi") }
        return next
    }

    static func signOut(_ s: Oturum) async {
        _ = try? await post(endpoint("logout"), [:], token: s.accessToken)
    }

    // Kayıtlı oturum (Anahtar Zinciri)
    static func stored() -> Oturum? {
        guard let data = AnahtarZinciri.load() else { return nil }
        return try? JSONDecoder().decode(Oturum.self, from: data)
    }
    static func store(_ s: Oturum?) {
        if let s, let data = try? JSONEncoder().encode(s) { AnahtarZinciri.save(data) } else { AnahtarZinciri.delete() }
    }
}

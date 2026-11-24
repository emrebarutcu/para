import SwiftUI
import AuthenticationServices
import CryptoKit

// "Apple ile devam et" (Sign in with Apple): tek dokunuşla hesap, e-posta doğrulaması yok. Giriş ekranında (GirisEkrani) ve
// yapay zekâ asistanı ekranında (asistan hesap ister). Yeni hesabın ülkesi (user_metadata.country) seçili ülkeden yazılır;
// girişsizken girilen veri için Model.signedIn "Hesabıma taşı" sorar. Yetki: com.apple.developer.applesignin
// (CashFollow.entitlements; TestFlight'ta asc_imza.py App ID'de açar). Supabase'de Apple sağlayıcısı: supabase/apple.sh.
struct AppleIleGiris: View {
    @EnvironmentObject private var model: Model
    @Environment(\.colorScheme) private var scheme
    let ulke: String          // yeni hesabın ülkesi
    let kaynak: String        // analitik: welcome, settings, onboarding, assistant
    var bitti: () -> Void = {}
    @State private var nonce = ""
    @State private var hata: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SignInWithAppleButton(.continue) { istek in
                nonce = Self.rastgele()
                istek.requestedScopes = [.email]
                istek.nonce = Self.ozet(nonce)
                hata = nil
            } onCompletion: { sonuc in
                Task { await tamamla(sonuc) }
            }
            .signInWithAppleButtonStyle(scheme == .dark ? .white : .black)
            .frame(height: 50)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .disabled(busy)
            .overlay { if busy { ProgressView().tint(scheme == .dark ? .black : .white) } }
            if let hata { Text(hata).font(.footnote).foregroundStyle(Renk.gider) }
        }
    }

    private func tamamla(_ sonuc: Result<ASAuthorization, Error>) async {
        switch sonuc {
        case .failure(let e):
            if (e as? ASAuthorizationError)?.code == .canceled { return }
            hata = L("Apple ile giriş yapılamadı: {0}", e.localizedDescription)
            Analitik.olay("apple_sign_in_failed", ["source": kaynak, "stage": "apple"])
        case .success(let yetki):
            guard let k = yetki.credential as? ASAuthorizationAppleIDCredential, let veri = k.identityToken,
                  let belirtec = String(data: veri, encoding: .utf8) else {
                hata = L("Apple ile giriş yapılamadı.")
                return
            }
            busy = true
            defer { busy = false }
            do {
                var (s, yeni) = try await Auth.signInWithApple(idToken: belirtec, nonce: nonce)
                if yeni, s.country == nil, !ulke.isEmpty { s = (try? await Auth.updateCountry(s, ulke)) ?? s }
                if yeni { Analitik.olay("account_created", ["country": ulke, "result": "session", "source": kaynak, "method": "apple"]) }
                model.signedIn(s)
                Analitik.olay("apple_sign_in", ["source": kaynak, "new": yeni])
                bitti()
            } catch let e as AuthHatasi {
                hata = e.turkish
                Analitik.olay("apple_sign_in_failed", ["source": kaynak, "stage": "server", "status": e.status])
            } catch {
                hata = L("Bağlanılamadı: {0}", error.localizedDescription)
                Analitik.olay("apple_sign_in_failed", ["source": kaynak, "stage": "network"])
            }
        }
    }

    // Tek kullanımlık rastgele değer: Apple'a özeti gider, Supabase kendisini denetler (belirtecin yeniden kullanılmasına karşı)
    private static func rastgele() -> String {
        var bayt = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bayt.count, &bayt)
        return bayt.map { String(format: "%02x", $0) }.joined()
    }

    private static func ozet(_ s: String) -> String {
        SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

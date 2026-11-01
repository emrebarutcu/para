import SwiftUI

// Giriş / kayıt (sync.js'teki pencere). İlk açılışta (welcome) kapatılamaz, "Çevrimdışı devam et" ile geçilir.
// Doğrulama ve şifre sıfırlama bağlantıları cashfollow.app'te açılır; sonra burada giriş yapılır.
struct GirisEkrani: View {
    @EnvironmentObject private var model: Model
    @Environment(\.dismiss) private var dismiss
    let welcome: Bool
    @State private var register = false
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var message: (text: String, ok: Bool)?
    @State private var resendFor: String?
    // Ülke: ana para birimi ondan (para.js); varsayılan cihazın bölgesi (listede yoksa Türkiye)
    @State private var ulke = Locale.current.region?.identifier ?? "TR"

    var body: some View {
        NavigationStack {
            Form {
                if welcome {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(L("CashFollow'a hoş geldin")).font(.title2.weight(.semibold))
                            Text(L("Kredi kartı taksitlerini, nakit akışını ve varlıklarını takip et. Hesabınla veriler web'de ve diğer cihazlarında da olur."))
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                }
                Section {
                    Picker("", selection: $register) {
                        Text(L("Giriş Yap")).tag(false)
                        Text(L("Kayıt Ol")).tag(true)
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: register) { _, _ in message = nil; resendFor = nil }
                    TextField(L("E-posta"), text: $email)
                        .keyboardType(.emailAddress).textContentType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField(L("Şifre"), text: $password)
                        .textContentType(register ? .newPassword : .password)
                    if register || welcome {
                        UlkeSecici(secim: $ulke)
                    }
                    Button { Task { await submit() } } label: {
                        HStack { Spacer(); if busy { ProgressView() } else { Text(register ? L("Kayıt Ol") : L("Giriş Yap")) }; Spacer() }
                    }
                    .disabled(busy || email.isEmpty || password.isEmpty)
                } footer: {
                    if register {
                        let metin = L("Kayıt olarak [Kullanım Koşulları]({0})'nı ve [Gizlilik Politikası]({1})'nı kabul edersin.", Yapilandirma.kosullar.absoluteString, Yapilandirma.gizlilik.absoluteString)
                        Text((try? AttributedString(markdown: metin)) ?? AttributedString(metin))
                    }
                }
                if let m = message {
                    Section {
                        Text((m.ok ? "✓ " : "⚠ ") + m.text).foregroundStyle(m.ok ? Renk.gelir : Renk.gider)
                        if let r = resendFor {
                            Button(L("Doğrulama e-postasını yeniden gönder")) { Task { await resend(r) } }
                        }
                    }
                }
                if !register {
                    Section {
                        Button(L("Şifremi unuttum")) { Task { await forgot() } }.disabled(email.isEmpty || busy)
                    }
                }
                if welcome {
                    Section {
                        Button(L("Hesap açmadan başla")) { model.continueOffline(country: ulke) }
                    } footer: {
                        Text(L("Veriler yalnızca bu telefonda durur; istediğin zaman Ayarlar'dan giriş yapıp yedekleyebilirsin."))
                    }
                }
            }
            .navigationTitle(welcome ? "" : L("Giriş yap"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !welcome { ToolbarItem(placement: .cancellationAction) { Button(L("Kapat")) { dismiss() } } }
            }
        }
        .interactiveDismissDisabled(welcome)
        .onAppear {
            if model.constants?.countries.contains(where: { $0.code == ulke }) != true { ulke = "TR" }
        }
    }

    private var trimmed: String { email.trimmingCharacters(in: .whitespaces) }

    private func submit() async {
        busy = true
        defer { busy = false }
        resendFor = nil
        do {
            if register {
                let sonuc = try await Auth.signUp(email: trimmed, password: password, country: ulke)
                if case .alreadyExists = sonuc {} else { Analitik.olay("account_created", ["country": ulke]) }
                switch sonuc {
                case .session(let s):
                    model.signedIn(s)
                    dismiss()
                case .confirmEmail:
                    message = (L("Kayıt olundu! E-postana gelen bağlantıyla hesabını doğrula, sonra burada giriş yap. Gelmezse gereksiz / spam klasörüne de bak."), true)
                    resendFor = trimmed
                case .alreadyExists:
                    message = (L("Bu e-postayla zaten bir hesap var. Giriş Yap'tan gir; şifreni hatırlamıyorsan \"Şifremi unuttum\"."), false)
                }
            } else {
                let s = try await Auth.signIn(email: trimmed, password: password)
                model.signedIn(s)
                dismiss()
            }
        } catch let e as AuthHatasi {
            message = (e.turkish, false)
            if e.unconfirmed { resendFor = trimmed }
        } catch {
            message = (L("Bağlanılamadı: {0}", error.localizedDescription), false)
        }
    }

    private func resend(_ email: String) async {
        do {
            try await Auth.resend(email: email)
            message = (L("Doğrulama e-postası yeniden gönderildi. Gelmezse gereksiz / spam klasörüne de bak."), true)
        } catch let e as AuthHatasi {
            message = (e.turkish, false)
        } catch {
            message = (error.localizedDescription, false)
        }
    }

    private func forgot() async {
        busy = true
        defer { busy = false }
        do {
            try await Auth.recover(email: trimmed)
            message = (L("Şifre sıfırlama bağlantısı gönderildi — e-postanı kontrol et. Yeni şifreyi cashfollow.app'te belirleyip burada giriş yap."), true)
        } catch let e as AuthHatasi {
            message = (e.turkish, false)
        } catch {
            message = (error.localizedDescription, false)
        }
    }
}

// Ülke seçici: para birimiyle birlikte ("Almanya · Euro")
struct UlkeSecici: View {
    @EnvironmentObject private var model: Model
    @Binding var secim: String

    private var ulkeler: [Sabitler.Ulke] {
        let liste = model.constants?.countries ?? []
        return Dil.ingilizce ? liste.sorted { Bicim.ulkeAdi($0.code, $0.name) < Bicim.ulkeAdi($1.code, $1.name) } : liste
    }

    var body: some View {
        Picker(L("Ülke"), selection: $secim) {
            // İngilizcede ülke adları telefonun dilinde (Locale), alfabetik; para birimi kodla
            ForEach(ulkeler) { u in
                Text("\(Bicim.ulkeAdi(u.code, u.name)) · \(Dil.ingilizce ? u.currency : model.constants?.currencies.first { $0.code == u.currency }?.short ?? u.currency)").tag(u.code)
            }
        }
    }
}

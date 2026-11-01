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
                            Text("CashFollow'a hoş geldin").font(.title2.weight(.semibold))
                            Text("Kredi kartı taksitlerini, nakit akışını ve varlıklarını takip et. Hesabınla veriler web'de ve diğer cihazlarında da olur.")
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                }
                Section {
                    Picker("", selection: $register) {
                        Text("Giriş Yap").tag(false)
                        Text("Kayıt Ol").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: register) { _, _ in message = nil; resendFor = nil }
                    TextField("E-posta", text: $email)
                        .keyboardType(.emailAddress).textContentType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Şifre", text: $password)
                        .textContentType(register ? .newPassword : .password)
                    if register || welcome {
                        UlkeSecici(secim: $ulke)
                    }
                    Button { Task { await submit() } } label: {
                        HStack { Spacer(); if busy { ProgressView() } else { Text(register ? "Kayıt Ol" : "Giriş Yap") }; Spacer() }
                    }
                    .disabled(busy || email.isEmpty || password.isEmpty)
                }
                if let m = message {
                    Section {
                        Text((m.ok ? "✓ " : "⚠ ") + m.text).foregroundStyle(m.ok ? Renk.gelir : Renk.gider)
                        if let r = resendFor {
                            Button("Doğrulama e-postasını yeniden gönder") { Task { await resend(r) } }
                        }
                    }
                }
                if !register {
                    Section {
                        Button("Şifremi unuttum") { Task { await forgot() } }.disabled(email.isEmpty || busy)
                    }
                }
                if welcome {
                    Section {
                        Button("Hesap açmadan başla") { model.continueOffline(country: ulke) }
                    } footer: {
                        Text("Veriler yalnızca bu telefonda durur; istediğin zaman Ayarlar'dan giriş yapıp yedekleyebilirsin.")
                    }
                }
            }
            .navigationTitle(welcome ? "" : "Giriş yap")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !welcome { ToolbarItem(placement: .cancellationAction) { Button("Kapat") { dismiss() } } }
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
                switch try await Auth.signUp(email: trimmed, password: password, country: ulke) {
                case .session(let s):
                    model.signedIn(s)
                    dismiss()
                case .confirmEmail:
                    message = ("Kayıt olundu! E-postana gelen bağlantıyla hesabını doğrula, sonra burada giriş yap. Gelmezse gereksiz / spam klasörüne de bak.", true)
                    resendFor = trimmed
                case .alreadyExists:
                    message = ("Bu e-postayla zaten bir hesap var. Giriş Yap'tan gir; şifreni hatırlamıyorsan \"Şifremi unuttum\".", false)
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
            message = ("Bağlanılamadı: \(error.localizedDescription)", false)
        }
    }

    private func resend(_ email: String) async {
        do {
            try await Auth.resend(email: email)
            message = ("Doğrulama e-postası yeniden gönderildi. Gelmezse gereksiz / spam klasörüne de bak.", true)
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
            message = ("Şifre sıfırlama bağlantısı gönderildi — e-postanı kontrol et. Yeni şifreyi cashfollow.app'te belirleyip burada giriş yap.", true)
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

    var body: some View {
        Picker("Ülke", selection: $secim) {
            ForEach(model.constants?.countries ?? []) { u in
                Text("\(u.name) · \(model.constants?.currencies.first { $0.code == u.currency }?.short ?? u.currency)").tag(u.code)
            }
        }
    }
}

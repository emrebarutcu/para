import SwiftUI

// Ayarlar: hesap ve eşitleme, kişiler, sürüm
struct AyarlarEkrani: View {
    @EnvironmentObject private var model: Model
    @Environment(\.dismiss) private var dismiss
    @State private var login = false
    @State private var confirmLogout = false
    @State private var newPerson = ""
    @State private var addingPerson = false
    @State private var renaming: Kisi?
    @State private var renameText = ""
    @State private var deleting: Kisi?
    @State private var error: String?
    @State private var ulke = ""
    @State private var ulkeHatasi: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if let s = model.session {
                        Satir(title: "Hesap", value: s.email)
                        if let e = model.syncError {
                            Text(e).font(.footnote).foregroundStyle(Renk.gider)
                        } else if let at = model.lastSync {
                            Satir(title: "Son eşitleme", value: at.formatted(.dateTime.hour().minute().locale(Bicim.locale)))
                        }
                        Button(model.syncing ? "Eşitleniyor…" : "Şimdi eşitle") { Task { await model.refresh() } }
                            .disabled(model.syncing)
                        Button("Çıkış yap", role: .destructive) { confirmLogout = true }
                    } else {
                        Text("Veriler yalnızca bu cihazda. Giriş yapınca bulutta saklanır ve web (cashfollow.app), diğer cihazlar ve yapay zekâ asistanlarıyla eşitlenir.")
                            .font(.footnote).foregroundStyle(.secondary)
                        Button("Giriş yap / Kayıt ol") { login = true }
                    }
                } header: { Text("Bulut senkronizasyonu") }

                Section {
                    UlkeSecici(secim: $ulke)
                    Satir(title: "Para birimi", value: "\(Bicim.homeShort) (\(Bicim.home))")
                    HataMetni(text: ulkeHatasi)
                } header: { Text("Ülke") } footer: {
                    Text("Tutarlar ve kurlar ülkenin para biriminde gösterilir; web ve asistan da aynısını kullanır. Ülke değişince kayıtlı tutarlar çevrilmez. Fon ve hisse şimdilik yalnızca Türkiye'de.")
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
                    Okunan(tool: "list_people") { (l: KisiListesi) in
                        ForEach(Array(l.people.enumerated()), id: \.element.id) { i, p in
                            HStack {
                                Circle().fill(Renk.seri[i % Renk.seri.count]).frame(width: 10, height: 10)
                                Text(p.name)
                                Spacer()
                                if let owes = p.owesUser, abs(owes) >= 0.01 {
                                    Text(Bicim.tl(owes)).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .contentShape(Rectangle())
                            .onTapGesture { renameText = p.name; renaming = p }
                            .swipeActions {
                                if l.people.count > 1 { Button("Sil", role: .destructive) { deleting = p } }
                            }
                        }
                        Button("Kişi ekle") { newPerson = ""; addingPerson = true }
                    }
                    HataMetni(text: error)
                } header: { Text("Kişiler") } footer: {
                    Text("İlk kişi kartları ödeyen sensin; diğerlerinin kartlarındaki harcamaları sana borç sayılır.")
                }

                Section {
                    Link("Web'de aç (içe aktarma, banka e-postaları)", destination: Yapilandirma.site)
                    Satir(title: "Sürüm", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
                }
            }
            .navigationTitle("Ayarlar")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Bitti") { dismiss() } } }
            .sheet(isPresented: $login) { GirisEkrani(welcome: false) }
            .confirmationDialog("Çıkış yapılsın mı?", isPresented: $confirmLogout, titleVisibility: .visible) {
                Button("Çıkış yap", role: .destructive) { Task { await model.signOut() } }
            } message: {
                Text("Hesabının verisi bu cihazdan silinir, bulutta kalır.")
            }
            .alert("Kişi ekle", isPresented: $addingPerson) {
                TextField("Ad", text: $newPerson)
                Button("Ekle") { act("add_person", ["name": newPerson]) }
                Button("Vazgeç", role: .cancel) {}
            }
            .alert("Adını değiştir", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
                TextField("Ad", text: $renameText)
                Button("Kaydet") { if let p = renaming { act("rename_person", ["person": p.id, "name": renameText]) } }
                Button("Vazgeç", role: .cancel) {}
            }
            .confirmationDialog(deleting.map { "\($0.name) silinsin mi?" } ?? "", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                Button("Sil", role: .destructive) { if let p = deleting { act("delete_person", ["person": p.id]) } }
            } message: {
                Text("Kişinin bütün harcamaları, varlık hareketleri ve borçları da silinir.")
            }
        }
    }

    private func act(_ tool: String, _ args: [String: Any]) {
        do { try model.write(tool, args); error = nil } catch { self.error = error.localizedDescription }
    }
}

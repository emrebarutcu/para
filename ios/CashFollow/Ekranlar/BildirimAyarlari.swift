import SwiftUI
import UIKit

// Ayarlar → Bildirimler: hangi bildirimlerin geleceğini kullanıcı seçer, her biri ayrı (Bildirimler). Ödemeler (ödeme
// günü ve ne zaman, hesap kesimi), taksit bitişi ve ay özeti seçilen saatte gelir; bankadan gelenler (e-posta ve SMS)
// yalnızca banka e-postası / mesajı olan ülkelerde görünür. İzin iPhone Ayarları'ndan kaldırıldıysa üstte söylenir.
struct BildirimAyarlari: View {
    @EnvironmentObject private var model: Model
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @State private var secili: [Bildirimler.Tur: Bool] = [:]
    @State private var gun = Hatirlatma.gunOnce
    @State private var saat = Calendar.current.date(bySettingHour: Hatirlatma.dakika / 60, minute: Hatirlatma.dakika % 60, second: 0, of: Date()) ?? Date()
    @State private var izin: UNAuthorizationStatus = .notDetermined

    private var banka: Bool { model.bankEmailsAllowed }

    var body: some View {
        List {
            if izin == .denied {
                Section {
                    Button(L("Bildirim izni kapalı: iPhone Ayarları'nda aç")) {
                        if let u = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(u) }
                    }
                } footer: {
                    Text(L("İzin verene kadar seçtiğin bildirimler gelmez."))
                }
            }

            Section {
                anahtar(.odeme, L("Ödeme günü"))
                if deger(.odeme) {
                    Picker(L("Ne zaman"), selection: $gun) {
                        Text(L("Ödeme günü")).tag(0)
                        Text(L("1 gün kala")).tag(1)
                        ForEach([2, 3, 7], id: \.self) { Text(L("{0} gün kala", $0)).tag($0) }
                    }
                }
                anahtar(.kesim, L("Hesap kesiminden bir gün önce"))
            } header: { Text(L("Ödemeler")) } footer: {
                Text(L("Kart ekstresi, kredi ve borç taksitlerinin ödeme günü. Kesimden önce: bugün alınanın hangi gün ödeneceği."))
            }

            Section {
                anahtar(.bitis, L("Taksit bitince"))
                anahtar(.ayOzeti, L("Ay özeti"))
            } header: { Text(L("Taksitler ve ay")) } footer: {
                Text(L("Bir taksit bitince boşalan aylık tutar; her ayın ilk günü geçen ayın özeti."))
            }

            if Bildirimler.Tur.allCases.contains(where: { $0.zamanli && deger($0) }) {
                Section {
                    DatePicker(L("Saat"), selection: $saat, displayedComponents: .hourAndMinute)
                } footer: {
                    Text(L("Yukarıdaki bildirimler bu saatte gelir."))
                }
            }

            if banka {
                Section {
                    anahtar(.eklenen, L("Harcama eklenince"))
                    anahtar(.bekleyen, L("Onay bekleyen olunca"))
                } header: { Text(L("Bankadan gelenler")) } footer: {
                    Text(L("Banka e-postası ya da mesajından eklenen harcamalar ve onayını bekleyenler. Uygulama açıkken bildirim gelmez; iPhone kapalıyken ne zaman bakacağına iOS karar verir."))
                }
            }

            Section {} footer: {
                Text(L("Bildirimler bu telefonda kurulur; verin hiçbir yere gönderilmez."))
            }
        }
        .navigationTitle(L("Bildirimler"))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { yenile() }
        .task { izin = await Bildirimler.izinDurumu() }
        // iPhone Ayarları'ndan dönünce izin yeniden okunur
        .onChange(of: scenePhase) { _, p in if p == .active { Task { izin = await Bildirimler.izinDurumu() } } }
        .onChange(of: gun) { _, v in Hatirlatma.gunOnce = v; Task { await Hatirlatma.kur(model) } }
        .onChange(of: saat) { _, v in
            let c = Calendar.current.dateComponents([.hour, .minute], from: v)
            Hatirlatma.dakika = (c.hour ?? 10) * 60 + (c.minute ?? 0)
            Task { await Hatirlatma.kur(model) }
        }
    }

    private func deger(_ t: Bildirimler.Tur) -> Bool { secili[t] ?? Bildirimler.acik(t) }

    private func yenile() {
        secili = Dictionary(uniqueKeysWithValues: Bildirimler.Tur.allCases.map { ($0, Bildirimler.acik($0)) })
    }

    private func anahtar(_ t: Bildirimler.Tur, _ baslik: String) -> some View {
        Toggle(baslik, isOn: Binding(get: { deger(t) }, set: { yeni in
            secili[t] = yeni
            Task {
                await Bildirimler.ayarla(t, yeni, model: model)
                izin = await Bildirimler.izinDurumu()
            }
        }))
    }
}

// Ayarlar'daki satır: Bildirimler → kaç tanesi açık
struct BildirimSatiri: View {
    @EnvironmentObject private var model: Model
    @State private var ozet = ""

    var body: some View {
        NavigationLink { BildirimAyarlari() } label: {
            Satir(title: L("Bildirimler"), value: ozet)
        }
        .onAppear { ozet = Bildirimler.ozet(banka: model.bankEmailsAllowed) }
    }
}

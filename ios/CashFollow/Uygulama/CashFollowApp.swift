import SwiftUI

@main
struct CashFollowApp: App {
    @StateObject private var model = Model()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        OzDenetim.runIfRequested()
        Ornek.hazirlaIfRequested()
    }

    var body: some Scene {
        WindowGroup {
            AnaEkran()
                .environmentObject(model)
                .tint(Tema.metin)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.refresh() } }
        }
    }
}

struct AnaEkran: View {
    @EnvironmentObject private var model: Model
    @State private var sekme = Ornek.sekme

    var body: some View {
        Group {
            if let error = model.startupError {
                ContentUnavailableView(L("Uygulama açılamadı"), systemImage: "exclamationmark.triangle", description: Text(error))
            } else if let g = Ornek.galeri {
                GrafikGalerisi(sayfa: g)
            } else {
                // iPhone'da en fazla 5 sekme: borç ve krediler Kartlar'da, Ayarlar Özet'teki dişlide
                TabView(selection: $sekme) {
                    OzetEkrani().tabItem { Label(L("Özet"), systemImage: "house") }.tag(0)
                    AkisEkrani().tabItem { Label(L("Akış"), systemImage: "calendar") }.tag(1)
                    HarcamalarEkrani().tabItem { Label(L("Harcamalar"), systemImage: "list.bullet.rectangle") }.tag(2)
                    BorclarEkrani().tabItem { Label(L("Kartlar"), systemImage: "creditcard") }.tag(3)
                    VarliklarEkrani().tabItem { Label(L("Varlıklar"), systemImage: "banknote") }.tag(4)
                }
            }
        }
        .fullScreenCover(isPresented: $model.showWelcome) {
            GirisEkrani(welcome: true)
        }
        .confirmationDialog(L("Bu cihazda girişsiz girilen veriler var"), isPresented: $model.askMove, titleVisibility: .visible) {
            Button(L("Hesabıma taşı")) { Task { await model.moveLocal(true) } }
            Button(L("Sil, hesabımdakilerle devam et"), role: .destructive) { Task { await model.moveLocal(false) } }
            Button(L("Sonra karar ver"), role: .cancel) {}
        } message: {
            Text(L("Taşırsan aynı adlı kişiler ve aynı kartlar birleşir. Seçene kadar cihazdaki veri silinmez."))
        }
    }
}

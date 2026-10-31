import SwiftUI

@main
struct CashFollowApp: App {
    @StateObject private var model = Model()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        OzDenetim.runIfRequested()
    }

    var body: some Scene {
        WindowGroup {
            AnaEkran()
                .environmentObject(model)
                .tint(Renk.vurgu)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.refresh() } }
        }
    }
}

struct AnaEkran: View {
    @EnvironmentObject private var model: Model

    var body: some View {
        Group {
            if let error = model.startupError {
                ContentUnavailableView("Uygulama açılamadı", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                TabView {
                    OzetEkrani().tabItem { Label("Özet", systemImage: "house") }
                    HarcamalarEkrani().tabItem { Label("Harcamalar", systemImage: "list.bullet.rectangle") }
                    KartlarEkrani().tabItem { Label("Kartlar", systemImage: "creditcard") }
                    VarliklarEkrani().tabItem { Label("Varlıklar", systemImage: "banknote") }
                    AyarlarEkrani().tabItem { Label("Ayarlar", systemImage: "gearshape") }
                }
            }
        }
        .fullScreenCover(isPresented: $model.showWelcome) {
            GirisEkrani(welcome: true)
        }
        .confirmationDialog("Bu cihazda girişsiz girilen veriler var", isPresented: $model.askMove, titleVisibility: .visible) {
            Button("Hesabıma taşı") { Task { await model.moveLocal(true) } }
            Button("Sil, hesabımdakilerle devam et", role: .destructive) { Task { await model.moveLocal(false) } }
            Button("Sonra karar ver", role: .cancel) {}
        } message: {
            Text("Taşırsan aynı adlı kişiler ve aynı kartlar birleşir. Seçene kadar cihazdaki veri silinmez.")
        }
    }
}

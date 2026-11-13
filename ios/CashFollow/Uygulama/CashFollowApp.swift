import Combine
import SwiftUI
import UserNotifications

@main
struct CashFollowApp: App {
    @StateObject private var model = Model()
    @StateObject private var kilit = Kilit()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        OzDenetim.runIfRequested()
        Karsilama.baslat()   // yeni kurulum mu (ilk açılış akışı yalnızca yenilere)
        Ornek.hazirlaIfRequested()
        Cokme.baslat()
        UNUserNotificationCenter.current().delegate = BildirimTemsilcisi.shared   // bildirime dokununca ilgili sekme
    }

    var body: some Scene {
        WindowGroup {
            AnaEkran()
                .environmentObject(model)
                .environmentObject(model.abonelik)
                .environmentObject(kilit)
                .tint(Tema.metin)
                // Açılışta perde penceresi sahne hazır olunca kurulur; o ana kadar ekranı bu perde örter
                .overlay { if kilit.acik && kilit.kilitli { KilitPerdesi().environmentObject(kilit) } }
                .onAppear { kilit.faz = scenePhase; Task { await kilit.kendiliginden() } }
        }
        .onChange(of: scenePhase) { _, phase in
            kilit.faz = phase   // kilit açıksa uygulama değiştiricide içerik görünmez
            if phase == .active {
                Task { await kilit.kendiliginden() }
                Puanlama.acildi()
                Task { await model.refresh() }
                Analitik.olay("app_opened", ["signed_in": model.session != nil])
                Task { await Analitik.bayraklariYukle() }
            }
            if phase == .background {
                kilit.arkaPlan()
                Analitik.gonder()
                EpostaBildirim.planla(model)
            }
        }
        // Banka e-postaları: uygulama kapalıyken iOS'un verdiği arka plan zamanında (EpostaBildirim)
        .backgroundTask(.appRefresh(EpostaBildirim.gorev)) {
            await EpostaBildirim.calis(model)
        }
    }
}

struct AnaEkran: View {
    @EnvironmentObject private var model: Model
    @State private var sekme = Ornek.sekme
    @State private var kisayol: KisayolHarcamasi?

    var body: some View {
        Group {
            if let error = model.startupError {
                ContentUnavailableView(L("Uygulama açılamadı"), systemImage: "exclamationmark.triangle", description: Text(error))
            } else if let tur = Ornek.tur {
                TurEkrani(adimlar: tur)
            } else if let g = Ornek.galeri {
                GrafikGalerisi(sayfa: g)
            } else {
                Sekmeler(sekme: $sekme)
            }
        }
        // Bir işin sonucu (harcama kaydedildi…) üstte kısa bir bantla
        .overlay(alignment: .top) { BantGorunumu() }
        // Ödeme hatırlatmaları veri değişince yeniden kurulur (2 sn içindeki değişiklikler bir kez)
        .task(id: model.revision) {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if !Task.isCancelled { await Hatirlatma.kur(model) }
        }
        // Bildirime dokununca açılacak sekme (EpostaBildirim → Harcamalar)
        .onReceive(Yonlendirici.shared.$sekme.compactMap { $0 }) { yeni in
            sekme = yeni
            Yonlendirici.shared.sekme = nil
        }
        // "Harcama ekle" kısayolu: form verilen tutar, ad ve taksitle açılır (karşılama sürerken açılmaz)
        .onReceive(Yonlendirici.shared.$harcama.compactMap { $0 }) { taslak in
            Yonlendirici.shared.harcama = nil
            if !model.showWelcome { kisayol = taslak }
        }
        .sheet(item: $kisayol) { HarcamaFormu(kisayol: $0) }
        // İlk açılış: yeni kullanıcıya karşılama akışı (KarsilamaEkrani), daha önce kullanmış olana giriş ekranı
        .fullScreenCover(isPresented: $model.showWelcome) {
            KarsilamaKapisi()
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

// iPhone'da en fazla 5 sekme: borç ve krediler Kartlar'da, Ayarlar Özet'teki dişlide
struct Sekmeler: View {
    @EnvironmentObject private var model: Model
    @Binding var sekme: Int

    var body: some View {
        TabView(selection: $sekme) {
            OzetEkrani().tabItem { Label(L("Özet"), systemImage: "house") }.tag(0)
            AkisEkrani().tabItem { Label(L("Akış"), systemImage: "calendar") }.tag(1)
            HarcamalarEkrani().tabItem { Label(L("Harcamalar"), systemImage: "list.bullet.rectangle") }.tag(2)
                .badge(model.epostalar.count)   // onay bekleyen banka e-postaları
            BorclarEkrani().tabItem { Label(L("Kartlar"), systemImage: "creditcard") }.tag(3)
            VarliklarEkrani().tabItem { Label(L("Varlıklar"), systemImage: "banknote") }.tag(4)
        }
        .onChange(of: sekme) { _, yeni in
            Analitik.olay("tab_viewed", ["tab": ["overview", "cash_flow", "purchases", "cards", "assets"][min(max(yeni, 0), 4)]])
        }
    }
}

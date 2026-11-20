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
        Hatirlatma.gecis()   // bildirim türleri birbirinden bağımsız (1.3.0)
        MesajZekasi.denemeIfRequested()
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

// Dört sekme: Özet, Akış, Harcamalar, Durum. Durum iki yüz taşır: Kartlar ve borçlar (sekme 3) ile Varlıklar (sekme 4);
// sekme numaraları eskisi gibi kalır (bildirimler, -sekme, tab_viewed), yalnızca alttaki çubukta tek sekme görünür.
// Ayarlar Özet'teki dişlide.
struct Sekmeler: View {
    @EnvironmentObject private var model: Model
    @Binding var sekme: Int
    @AppStorage("durum.son") private var durumSon = 3   // Durum'da en son açılan yüz

    var body: some View {
        TabView(selection: Binding(get: { sekme == 4 ? 3 : sekme },
                                   set: { yeni in sekme = yeni == 3 ? (sekme == 3 || sekme == 4 ? sekme : durumSon) : yeni })) {
            OzetEkrani().tabItem { Label(L("Özet"), systemImage: "house") }.tag(0)
            AkisEkrani().tabItem { Label(L("Akış"), systemImage: "calendar") }.tag(1)
            HarcamalarEkrani().tabItem { Label(L("Harcamalar"), systemImage: "list.bullet.rectangle") }.tag(2)
                .badge(model.epostalar.count)   // onay bekleyen banka e-postaları
            DurumEkrani(sekme: $sekme).tabItem { Label(L("Durum"), systemImage: "chart.pie") }.tag(3)
        }
        .onChange(of: sekme) { _, yeni in
            if yeni == 3 || yeni == 4 { durumSon = yeni }
            Analitik.olay("tab_viewed", ["tab": ["overview", "cash_flow", "purchases", "cards", "assets"][min(max(yeni, 0), 4)]])
        }
    }
}

// Durum sekmesi: Kartlar ve borçlar (sekme 3) ya da Varlıklar (sekme 4); ekranlar üstlerindeki seçiciyle yüz değiştirir
// (durumSecici).
struct DurumEkrani: View {
    @Binding var sekme: Int

    var body: some View {
        Group {
            if sekme == 4 { VarliklarEkrani() } else { BorclarEkrani() }
        }
        .environment(\.durumSekmesi, $sekme)
    }
}

private struct DurumSekmesiAnahtari: EnvironmentKey {
    static let defaultValue: Binding<Int>? = nil
}

extension EnvironmentValues {
    // Durum sekmesinin seçili yüzü (3 Kartlar ve borçlar, 4 Varlıklar); Durum'un dışında nil
    var durumSekmesi: Binding<Int>? {
        get { self[DurumSekmesiAnahtari.self] }
        set { self[DurumSekmesiAnahtari.self] = newValue }
    }
}

private struct DurumSecici: ViewModifier {
    @Environment(\.durumSekmesi) private var sekme

    func body(content: Content) -> some View {
        if let sekme {
            content.safeAreaInset(edge: .top, spacing: 0) {
                Picker(L("Durum"), selection: sekme) {
                    Text(L("Kartlar ve borçlar")).tag(3)
                    Text(L("Varlıklar")).tag(4)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                // Zemin yalnızca seçicinin altında: ShapeStyle arka planı varsayılan olarak ekranın tepesine kadar uzanır
                // ve büyük başlığı ("Kartlar ve borçlar", "Varlıklar") örtüyordu
                .background(Tema.zemin, ignoresSafeAreaEdges: [])
            }
        } else {
            content
        }
    }
}

extension View {
    // Kartlar ve Varlıklar ekranlarının üstünde Durum'un iki yüzü arasında geçiş
    func durumSecici() -> some View { modifier(DurumSecici()) }
}

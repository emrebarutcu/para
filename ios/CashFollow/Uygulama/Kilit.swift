import SwiftUI
import LocalAuthentication

// Uygulama kilidi: Face ID / Touch ID (olmazsa telefonun şifresi). Açıksa uygulama açılınca ve arka plandan dönünce
// kilitlenir; uygulama değiştiricide ekran içeriği görünmez. Perde ayrı bir pencerede, açık formların (sheet) da üstünde.
@MainActor
final class Kilit: ObservableObject {
    @Published private(set) var kilitli: Bool { didSet { perde() } }
    @Published private(set) var dogruluyor = false
    @Published private(set) var acik: Bool { didSet { UserDefaults.standard.set(acik, forKey: "kilit.acik"); perde() } }
    var faz: ScenePhase = .active { didSet { perde() } }
    private var pencere: UIWindow?
    // Kendiliğinden yalnızca açılışta ve arka plandan dönünce sorulur: Face ID penceresi uygulamayı bir an .inactive
    // yapar; "Vazgeç"ten sonra yeniden sorulursa döngüye girer (sonra "Kilidi aç" düğmesi)
    private var sorabilir = true

    init() {
        let acik = UserDefaults.standard.bool(forKey: "kilit.acik") && Ornek.tur == nil && Ornek.galeri == nil
            && !CommandLine.arguments.contains("-ornek")
        self.acik = acik
        kilitli = acik
    }

    // Kilitliyken ya da uygulama öndeyken değilse perde en üstteki pencerede
    private func perde() {
        let goster = acik && (kilitli || faz != .active)
        if goster, pencere == nil {
            guard let sahne = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else {
                DispatchQueue.main.async { [weak self] in self?.perde() }   // sahne henüz bağlanmadı
                return
            }
            let w = UIWindow(windowScene: sahne)
            w.windowLevel = .alert + 1
            let h = UIHostingController(rootView: KilitPerdesi().environmentObject(self))
            h.view.backgroundColor = .clear
            w.rootViewController = h
            w.isHidden = false
            pencere = w
        } else if !goster, let w = pencere {
            w.isHidden = true
            pencere = nil
        }
    }

    // Cihazdaki yöntemin adı: Face ID, Touch ID, Optic ID ya da şifre
    static var yontem: String {
        let c = LAContext()
        _ = c.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch c.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        default: return L("Telefon şifresi")
        }
    }
    static var simge: String {
        let c = LAContext()
        _ = c.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch c.biometryType {
        case .faceID: return "faceid"
        case .touchID: return "touchid"
        case .opticID: return "opticid"
        default: return "lock"
        }
    }
    // Telefonda şifre yoksa kilit kurulamaz
    static var kullanilabilir: Bool { LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) }

    func arkaPlan() { if acik { kilitli = true; sorabilir = true } }

    func kendiliginden() async {
        guard sorabilir else { return }
        sorabilir = false
        await ac()
    }

    func ac() async {
        guard kilitli, !dogruluyor else { return }
        dogruluyor = true
        defer { dogruluyor = false }
        if await Self.dogrula(L("CashFollow'u açmak için")) { kilitli = false }
    }

    // Ayarlar'daki anahtar: açarken ve kapatırken doğrulanır
    func ayarla(_ yeni: Bool) async {
        guard yeni != acik else { return }
        guard await Self.dogrula(yeni ? L("Uygulama kilidini açmak için") : L("Uygulama kilidini kapatmak için")) else { return }
        acik = yeni
        Analitik.olay(yeni ? "app_lock_enabled" : "app_lock_disabled")
    }

    private static func dogrula(_ neden: String) async -> Bool {
        let c = LAContext()
        c.localizedCancelTitle = L("Vazgeç")
        return (try? await c.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: neden)) ?? false
    }
}

// Kilitliyken ya da uygulama değiştiricideyken ekranın üstüne çekilen perde
struct KilitPerdesi: View {
    @EnvironmentObject private var kilit: Kilit

    var body: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial).ignoresSafeArea()
            Tema.zemin.opacity(0.6).ignoresSafeArea()
            if kilit.kilitli {
                VStack(spacing: 18) {
                    Image(systemName: Kilit.simge).font(.system(size: 44, weight: .light)).foregroundStyle(Tema.metin2)
                    Text("CashFollow").font(.title2.weight(.semibold))
                    Button { Task { await kilit.ac() } } label: {
                        Text(L("Kilidi aç")).font(.body.weight(.semibold)).foregroundStyle(Tema.ustMetin)
                            .frame(minWidth: 160).padding(.vertical, 12).background(Tema.metin, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(kilit.dogruluyor)
                }
            }
        }
    }
}

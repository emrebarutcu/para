import SwiftUI

// Ekranların ortak parçaları

// Aracı revision her değiştiğinde yeniden okur (veri değişti, eşitleme bitti, kurlar geldi)
struct Okunan<T: Decodable, Content: View>: View {
    @EnvironmentObject private var model: Model
    let tool: String
    var args: [String: Any] = [:]
    var key: String = ""
    @ViewBuilder let content: (T) -> Content
    @State private var value: T?
    @State private var error: String?

    var body: some View {
        Group {
            if let value {
                content(value)
            } else if let error {
                ContentUnavailableView(L("Okunamadı"), systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 80)
            }
        }
        .task(id: "\(model.revision)|\(key)") { load() }
    }

    private func load() {
        do {
            value = try model.read(tool, args) as T
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// Başlık + değer satırı
struct Satir: View {
    let title: String
    let value: String
    var color: Color = Tema.metin

    var body: some View {
        HStack {
            Text(title).foregroundStyle(Tema.metin2)
            Spacer()
            Text(value).foregroundStyle(color).monospacedDigit()
        }
    }
}

// Limit kullanımı: gri yol üstünde koyu çubuk; limit aşılınca kırmızı (web: .limit-bar)
struct Doluluk: View {
    let used: Double
    let limit: Double
    var renk: Color? = nil
    var erisim: String? = nil   // sesli okuma etiketi; verilmezse limit kullanımı

    var body: some View {
        let ratio = limit > 0 ? min(max(used / limit, 0), 1) : 0
        let asim = limit > 0 && used > limit
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Tema.yuzey3)
                Capsule().fill(asim ? Tema.tehlike : (renk ?? Tema.metin)).frame(width: max(ratio > 0 ? 4 : 0, g.size.width * ratio))
            }
        }
        .frame(height: 6)
        .accessibilityElement()
        .accessibilityLabel(erisim ?? L("Limitin yüzde {0} kullanıldı", Int((ratio * 100).rounded())))
    }
}

// Girişsizken Özet'in üstündeki not (web: offlineNote). Yeni kullanıcıya ilk 72 saat gösterilmez (hesap açmadan
// başlamayı seçti; önce uygulamayı tanısın), sonra uyarı değil sakin bir öneri olarak
struct CevrimdisiNotu: View {
    @EnvironmentObject private var model: Model
    @State private var login = false

    var body: some View {
        if model.session == nil, !Karsilama.yeni {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: "icloud.and.arrow.up").font(.system(size: 18)).foregroundStyle(Tema.metin2)
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("Verilerin yalnızca bu telefonda")).font(.subheadline.weight(.semibold)).foregroundStyle(Tema.metin)
                    Text(L("Yedeklemek ve web'de de görmek için giriş yap.")).font(.footnote).foregroundStyle(Tema.metin2)
                }
                Spacer(minLength: 4)
                KucukDugme(ad: L("Giriş yap")) { login = true }
            }
            .padding(14)
            .background(Tema.yuzey, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Tema.cizgi, lineWidth: 1))
            .sheet(isPresented: $login) { GirisEkrani(welcome: false, kaynak: "offline_note") }
        }
    }
}

// Hata iletisi (araçların doğrulama hataları İngilizcedir: asistanlar için yazılmış)
struct HataMetni: View {
    let text: String?
    var body: some View {
        if let text { Text(text).font(.footnote).foregroundStyle(Renk.gider) }
    }
}

extension View {
    // Aşağı çekince eşitle
    func yenilenebilir(_ model: Model) -> some View {
        refreshable { await model.refresh() }
    }
}

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
                ContentUnavailableView("Okunamadı", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                ProgressView()
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
    var color: Color = .primary

    var body: some View {
        HStack {
            Text(title).foregroundStyle(.secondary)
            Spacer()
            Text(value).foregroundStyle(color).monospacedDigit()
        }
    }
}

// Limit kullanımı
struct Doluluk: View {
    let used: Double
    let limit: Double

    var body: some View {
        let ratio = limit > 0 ? min(max(used / limit, 0), 1) : 0
        ProgressView(value: ratio)
            .tint(ratio > 0.9 ? Renk.gider : ratio > 0.7 ? Renk.uyari : Renk.vurgu)
    }
}

// Girişsizken Özet'in üstündeki not (web: offlineNote)
struct CevrimdisiNotu: View {
    @EnvironmentObject private var model: Model
    @State private var login = false

    var body: some View {
        if model.session == nil {
            Button { login = true } label: {
                Label("Veriler yalnızca bu cihazda. Yedeklemek ve diğer cihazlarla eşitlemek için giriş yap.", systemImage: "icloud.slash")
                    .font(.footnote)
                    .multilineTextAlignment(.leading)
            }
            .sheet(isPresented: $login) { GirisEkrani(welcome: false) }
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

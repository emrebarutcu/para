import SwiftUI
import UIKit

// Yapay zekâ asistanı: CashFollow'u Claude, ChatGPT ya da Gemini'ye bağlama (MCP, cashfollow.app/mcp; web'deki Yapay zekâ
// penceresiyle aynı bağlantılar, app.js AI_CLIENTS). Claude'un bağlantısı "özel bağlayıcı ekle" penceresini adresi dolu açar;
// ChatGPT ve Gemini'de adres panoya kopyalanır, eklendiği sayfa açılır. Asistan CashFollow izin sayfasını açar, kullanıcı
// giriş yapıp izin verir. Araç çağrıları Premium ister (mcp/server.js).
struct AsistanEkrani: View {
    @EnvironmentObject private var model: Model
    @EnvironmentObject private var abonelik: Abonelik
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var not: String?
    @State private var kopyalandi = false
    @State private var odeme = false

    static let adres = Yapilandirma.site.appendingPathComponent("mcp").absoluteString

    private struct Asistan: Identifiable {
        let id: String
        let url: URL
        let kopyala: Bool
        let not: String
    }

    private var asistanlar: [Asistan] {
        let mcp = Self.adres.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? Self.adres
        return [
            Asistan(id: "Claude", url: URL(string: "https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=CashFollow&connectorUrl=\(mcp)")!,
                    kopyala: false, not: L("Claude'da açılan pencerede adres hazır: Ekle'ye dokun, sonra CashFollow sayfasında giriş yapıp İzin ver'e dokun.")),
            Asistan(id: "ChatGPT", url: URL(string: "https://chatgpt.com/plugins")!, kopyala: true,
                    not: L("Adres kopyalandı. ChatGPT'de + → Add custom MCP server: ad olarak CashFollow yaz, adresi yapıştır, kimlik doğrulamada OAuth seç ve Create as a plugin'e dokun. Sonra CashFollow sayfasında İzin ver.")),
            Asistan(id: "Gemini", url: URL(string: "https://gemini.google.com/apps")!, kopyala: true,
                    not: L("Adres kopyalandı. Gemini'de Custom apps → Add a custom app: adresi yapıştır, Next'e dokun, sonra CashFollow sayfasında İzin ver. Gemini'de özel uygulamalar şimdilik ABD'de, kişisel Google hesabıyla ve İngilizce arayüzde açık.")),
        ]
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(L("CashFollow'u bir yapay zekâ asistanına bağla; \"Telefonu 6 taksitle karta ekle\", \"Bu ay ne kadar ödeyeceğim?\" gibi isteklerle harcama, kart ve ödemelerini yönetsin."))
                        .font(.subheadline)
                    if model.session == nil {
                        Text(L("Asistan bulut hesabıyla çalışır: önce Ayarlar → Hesap'tan giriş yap.")).font(.footnote).foregroundStyle(Tema.uyari)
                    }
                    if !abonelik.premium {
                        Text(L("Asistan bağlantısı CashFollow Premium ile çalışır.")).font(.footnote).foregroundStyle(Tema.uyari)
                        Button(L("Premium'a geç")) { odeme = true }.font(.body.weight(.semibold))
                    }
                }
                Section {
                    ForEach(asistanlar) { a in
                        Button { ekle(a) } label: {
                            HStack {
                                Text(a.id).foregroundStyle(Tema.metin)
                                Spacer()
                                Image(systemName: "arrow.up.right").font(.footnote.weight(.semibold)).foregroundStyle(Tema.metin3)
                            }
                        }
                    }
                } header: { Text(L("Tek dokunuşla ekle")) } footer: {
                    if let not { Text(not) }
                }
                Section {
                    HStack {
                        Text(Self.adres).font(.callout.monospaced()).textSelection(.enabled)
                        Spacer()
                        Button(kopyalandi ? L("Kopyalandı") : L("Kopyala")) {
                            UIPasteboard.general.string = Self.adres
                            kopyalandi = true
                        }
                        .font(.subheadline.weight(.semibold))
                    }
                } header: { Text(L("Başka bir asistan")) } footer: {
                    Text(L("MCP destekleyen asistana bu adresi özel bağlayıcı olarak ekle; açılan CashFollow sayfasında giriş yapıp İzin ver'e dokun."))
                }
            }
            .navigationTitle(L("Yapay zekâ asistanı"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Bitti")) { dismiss() } } }
            .sheet(isPresented: $odeme) { PremiumEkrani(neden: "assistant") }
        }
        .onAppear { Analitik.olay("assistant_opened") }
    }

    private func ekle(_ a: Asistan) {
        if a.kopyala { UIPasteboard.general.string = Self.adres }
        not = a.not
        Analitik.olay("assistant_add", ["client": a.id.lowercased()])
        openURL(a.url)
    }
}

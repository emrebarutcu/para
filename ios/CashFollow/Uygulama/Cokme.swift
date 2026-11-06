import Foundation
import MetricKit

// Çökme raporları: iOS'un MetricKit'i çökmeleri toplar ve bir sonraki açılışta (en geç 24 saat sonra) verir; her biri
// "app_crashed" olayı olarak analitiğe gider (Analitik.olay: "Kullanım verisi gönder" kapalıysa gitmez). Rapor yalnızca
// çökmenin türünü ve çağrı yığınını içerir: kullanıcının verisi yok. Takılmalar (hang) da "app_hang" olarak.
final class Cokme: NSObject, MXMetricManagerSubscriber {
    static let paylasilan = Cokme()
    private static let yiginSiniri = 12_000   // PostHog olay boyutu için çağrı yığını kısaltılır

    static func baslat() {
        guard !CommandLine.arguments.contains("-ornek") else { return }
        MXMetricManager.shared.add(paylasilan)
    }

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        var olaylar: [(String, [String: Any])] = []
        for p in payloads {
            for c in p.crashDiagnostics ?? [] {
                var o = Self.ortak(c.metaData, c.callStackTree)
                o["exception_type"] = c.exceptionType?.intValue
                o["exception_code"] = c.exceptionCode?.intValue
                o["signal"] = c.signal?.intValue
                o["termination_reason"] = c.terminationReason
                if let r = c.exceptionReason {
                    o["exception_name"] = r.exceptionName
                    o["exception_class"] = r.className
                }
                olaylar.append(("app_crashed", o))
            }
            for h in p.hangDiagnostics ?? [] {
                var o = Self.ortak(h.metaData, h.callStackTree)
                o["hang_seconds"] = h.hangDuration.converted(to: .seconds).value
                olaylar.append(("app_hang", o))
            }
        }
        guard !olaylar.isEmpty else { return }
        Task { @MainActor in
            for (ad, o) in olaylar { Analitik.olay(ad, o) }
            Analitik.gonder()
        }
    }

    private static func ortak(_ m: MXMetaData, _ yigin: MXCallStackTree) -> [String: Any] {
        var y = String(data: yigin.jsonRepresentation(), encoding: .utf8) ?? ""
        if y.count > yiginSiniri { y = String(y.prefix(yiginSiniri)) }
        return [
            "crashed_version": m.applicationBuildVersion,
            "crashed_os": m.osVersion,
            "device_model": m.deviceType,
            "call_stack": y,
        ]
    }
}

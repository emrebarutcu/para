import test from "node:test";
import assert from "node:assert/strict";
import V from "../../varlik.js";

test("fon ve hisse kodları: FON:XXX (3 hane), BIST:XXXX; geçersizler null", () => {
  assert.deepEqual(V.market("FON:AFT"), { market: "FON", ticker: "AFT" });
  assert.deepEqual(V.market("BIST:A1CAP"), { market: "BIST", ticker: "A1CAP" });
  for (const c of ["FON:AF", "FON:AFTX", "BIST:TH", "BIST:1ABC", "bist:THYAO", "XYZ:AFT", "TRY", null, "BIST:THYAO "]) assert.equal(V.market(c), null, c);
  assert.equal(V.marketCode("bist", " thyao "), "BIST:THYAO");
  assert.equal(V.marketCode("FON", "ab"), null);
  const a = V.asset("BIST:THYAO");
  assert.equal(a.name, "THYAO");
  assert.equal(a.market, "BIST");
  assert.equal(V.asset("TRY").market, undefined);
  assert.equal(V.round(1.234567, "FON:AFT"), 1.2346);
  // Sabit varlık listesi değişmez (harcama ve borç formları yalnızca bunları gösterir)
  assert.deepEqual(V.ASSETS.map(x => x.code), ["TRY", "USD", "EUR", "GAU"]);
});

test("alış / satış TL bakiyesine işlenirse (settle) TL'den düşer ya da TL'ye eklenir; fiyatla TL karşılığı", () => {
  const es = [
    { asset: "TRY", amount: 10000, date: "2026-10-01" },
    { asset: "BIST:THYAO", amount: 10, price: 250, settle: true, date: "2026-10-02" },
    { asset: "BIST:THYAO", amount: 10, price: 270, date: "2026-10-03" },              // TL'ye dokunmaz
    { asset: "BIST:THYAO", amount: -5, price: 300, settle: true, date: "2026-10-05" },
    { asset: "FON:AFT", amount: 1000, settle: true, date: "2026-10-05" },             // fiyatsız: TL'ye dokunmaz
  ];
  assert.deepEqual(V.balances(es, "2026-10-30"), { TRY: 9000, "BIST:THYAO": 15, "FON:AFT": 1000 });
  assert.equal(V.tradeValue(es[3]), -1500);
  assert.equal(V.settled(es[2]), 0);
  assert.equal(V.toTry(15, "BIST:THYAO", { "BIST:THYAO": 247.1 }), 3706.5);
  assert.equal(V.toTry(15, "BIST:THYAO", { USD: 40 }), null);
  const t = V.totalTry(V.balances(es, "2026-10-30"), { TRY: 1, "BIST:THYAO": 200 });
  assert.equal(t.total, 12000);
  assert.deepEqual(t.missing, ["FON:AFT"]);
});

test("pozisyon: ortalama maliyet, gerçekleşen kâr; fiyatsız alış ya da fazla satış maliyeti bilinmez kılar", () => {
  const p = V.positions([
    { asset: "BIST:THYAO", amount: -5, price: 300, date: "2026-10-05" },
    { asset: "BIST:THYAO", amount: 10, price: 250, date: "2026-10-02" },
    { asset: "BIST:THYAO", amount: 10, price: 270, date: "2026-10-03" },
    { asset: "FON:AFT", amount: 1000, date: "2026-10-05" },
    { asset: "FON:TTE", amount: 100, price: 1, date: "2026-10-01" },
    { asset: "FON:TTE", amount: -150, price: 1.2, date: "2026-10-02" },
    { asset: "TRY", amount: 5, date: "2026-10-01" },
  ]);
  assert.deepEqual(p["BIST:THYAO"], { units: 15, cost: 3900, realized: 200 });
  assert.equal(p["FON:AFT"].cost, null);
  assert.equal(p["FON:TTE"].cost, null);
  assert.equal(p.TRY, undefined);
  // Hepsi satılınca pozisyon kapanır, yeni alış bilinen maliyetle başlar
  const q = V.positions([
    { asset: "FON:AFT", amount: 100, date: "2026-10-01" },
    { asset: "FON:AFT", amount: -100, price: 1, date: "2026-10-02" },
    { asset: "FON:AFT", amount: 50, price: 2, date: "2026-10-03" },
  ]);
  assert.equal(q["FON:AFT"].units, 50);
  assert.equal(q["FON:AFT"].cost, 100);
  assert.equal(q["FON:AFT"].realized, null);
});

test("nakit tanımı: varsayılan TL ve para piyasası fonları (emeklilik hariç); geçersiz ögeler atılır", () => {
  const ppf = { name: "AK PORTFÖY PARA PİYASASI (TL) FONU", kind: "YAT" };
  assert.ok(V.moneyMarket(ppf));
  assert.ok(V.moneyMarket({ name: "İSTANBUL PORTFÖY BİRİNCİ PARA PİYASASI SERBEST (TL) FON", kind: "YAT" }));
  assert.ok(!V.moneyMarket({ name: "AGESA HAYAT VE EMEKLİLİK A.Ş. PARA PİYASASI EMEKLİLİK YATIRIM FONU", kind: "EMK" }));
  assert.ok(!V.moneyMarket({ name: "AK PORTFÖY KISA VADELİ BORÇLANMA ARAÇLARI (TL) FONU", kind: "YAT" }));
  assert.ok(!V.moneyMarket(null));

  assert.ok(V.isCash("TRY"));
  assert.ok(!V.isCash("USD"));
  assert.ok(V.isCash("FON:ALE", undefined, ppf));
  assert.ok(!V.isCash("FON:ALE"));                              // fon bilgisi yoksa bilinmez
  assert.ok(!V.isCash("BIST:THYAO", undefined, ppf));
  assert.ok(!V.isCash("FON:ALE", ["TRY"], ppf));
  assert.ok(V.isCash("FON:AFT", ["TRY", "FON:AFT"]));
  assert.ok(V.isCash("USD", ["USD"]));

  assert.deepEqual(V.cashDef(null), ["TRY", "MMF"]);
  assert.deepEqual(V.cashDef(["TRY", "TRY", "BTC", "USD", "FON:AFT", "fon:aft", 3]), ["TRY", "USD", "FON:AFT"]);
  assert.deepEqual(V.cashDef([]), []);
});

import test from "node:test";
import assert from "node:assert/strict";
import { getPrices, getFunds, searchFunds, clearMarket, handlePrices, handleFunds } from "../piyasa.js";
import V from "../../varlik.js";

// Cuma 30 Ekim 2026, 13:00 Türkiye
const NOW = () => Date.parse("2026-10-30T10:00:00Z");

const FUNDS = {
  YAT: [
    { fonKodu: "AFT", fonUnvan: "AK PORTFÖY YENİ TEKNOLOJİLER YABANCI HİSSE SENEDİ FONU", tarih: "2026-10-30", fiyat: 0.959756 },
    { fonKodu: "TTE", fonUnvan: "İŞ PORTFÖY BIST TEKNOLOJİ AĞIRLIK SINIRLAMALI ENDEKSİ HİSSE SENEDİ (TL) FONU", tarih: "2026-10-30", fiyat: 1.000137 },
    { fonKodu: "CPU", fonUnvan: "AKTİF PORTFÖY TEKNOLOJİ KATILIM FONU", tarih: "2026-10-30", fiyat: 3.849169 },
  ],
  EMK: [{ fonKodu: "AAJ", fonUnvan: "AGESA HAYAT VE EMEKLİLİK A.Ş. OKS STANDART EMEKLİLİK YATIRIM FONU", tarih: "2026-10-30", fiyat: 0.110641 }],
  BYF: [],
};
const QUOTES = {
  THYAO: { symbol: "THYAO", last: 247.1, dayClose: 252.5, basePrice: 252.5, updateDate: "2026-10-30T12:51:06.000+03" },
  GARAN: { symbol: "GARAN", last: 125.4, dayClose: 126.7, basePrice: 126.7, updateDate: "2026-10-30T12:51:19.000+03" },
};

// Sahte TEFAS ve İş Yatırım. days: fon türü → fiyatı olan günler (yoksa yalnızca 2026-10-30)
function fake({ days = {}, down = {} } = {}) {
  const calls = [];
  const fn = async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname === "www.tefas.gov.tr") {
      const body = JSON.parse(init.body);
      calls.push({ host: "tefas", kind: body.fonTipi, day: body.basTarih });
      if (down.tefas?.includes(body.fonTipi)) return new Response("", { status: 503 });
      const day = `${body.basTarih.slice(0, 4)}-${body.basTarih.slice(4, 6)}-${body.basTarih.slice(6)}`;
      const ok = (days[body.fonTipi] ?? ["2026-10-30"]).includes(day);
      const list = ok ? FUNDS[body.fonTipi].map(r => ({ ...r, tarih: day })) : [];
      return Response.json(list.length ? { errorCode: null, errorMessage: null, resultList: list }
        : { errorCode: null, errorMessage: "Index 0 out of bounds for length 0", resultList: null });
    }
    if (url.hostname === "www.isyatirim.com.tr") {
      const symbols = url.searchParams.get("endeks").split(",");
      calls.push({ host: "isyatirim", symbols });
      if (down.stocks) return new Response("", { status: 500 });
      const found = symbols.filter(s => QUOTES[s]).map(s => QUOTES[s]);
      return Response.json(found.length ? found : { error: { code: "EINVAL", message: `Symbols ${symbols} are not allowed!` } });
    }
    throw new Error(`beklenmeyen istek ${url}`);
  };
  return { fetch: fn, calls };
}

test("fon ve hisse fiyatları; bulunamayan kodlar missing'de", async () => {
  clearMarket();
  const f = fake();
  const out = await getPrices(["FON:AFT", "FON:AAJ", "FON:ZZZ", "BIST:THYAO", "BIST:XYZW"], { fetch: f.fetch, now: NOW });
  assert.deepEqual(out.prices["FON:AFT"], { price: 0.959756, date: "2026-10-30", name: FUNDS.YAT[0].fonUnvan, kind: "YAT" });
  assert.equal(out.prices["FON:AAJ"].kind, "EMK");
  assert.deepEqual(out.prices["BIST:THYAO"], { price: 247.1, prev: 252.5, at: "2026-10-30T09:51:06.000Z", date: "2026-10-30" });
  assert.deepEqual(out.missing.sort(), ["BIST:XYZW", "FON:ZZZ"]);
  assert.deepEqual(out.failed, []);
  // Liste ve fiyatlar saklanır: ikinci çağrı istek atmaz
  const n = f.calls.length;
  await getPrices(["FON:AFT", "BIST:THYAO"], { fetch: f.fetch, now: NOW });
  assert.equal(f.calls.length, n);
});

test("fiyatı olmayan gün (hafta sonu, tatil) atlanır, son fiyat günü bulunur", async () => {
  clearMarket();
  // Pazartesi 2 Kasım sabahı: bugünün fiyatı henüz yok, hafta sonu sorulmaz, cuma bulunur
  const f = fake({ days: { YAT: ["2026-10-30"], EMK: ["2026-10-30"], BYF: ["2026-10-30"] } });
  const { date, funds } = await getFunds({ fetch: f.fetch, now: () => Date.parse("2026-11-02T05:00:00Z") });
  assert.equal(date, "2026-10-30");
  assert.equal(funds.get("AFT").date, "2026-10-30");
  const yat = f.calls.filter(c => c.kind === "YAT").map(c => c.day);
  assert.deepEqual(yat, ["20261102", "20261030"]);
  // Diğer türler doğrudan yatırım fonlarının gününden aranır
  assert.deepEqual(f.calls.filter(c => c.kind === "EMK").map(c => c.day), ["20261030"]);
});

test("emeklilik fonları alınamazsa yatırım fonları yine gelir, liste kısa süre sonra yenilenir", async () => {
  clearMarket();
  const f = fake({ down: { tefas: ["EMK"] } });
  const { funds } = await getFunds({ fetch: f.fetch, now: NOW });
  assert.ok(funds.has("AFT"));
  assert.ok(!funds.has("AAJ"));
  const n = f.calls.length;
  await getFunds({ fetch: f.fetch, now: () => NOW() + 6 * 60_000 });
  assert.ok(f.calls.length > n);
});

test("bir kaynak çökerse diğeri döner (failed); ikisi de çökerse hata", async () => {
  clearMarket();
  const f = fake({ down: { stocks: true } });
  const out = await getPrices(["FON:AFT", "BIST:THYAO"], { fetch: f.fetch, now: NOW });
  assert.ok(out.prices["FON:AFT"]);
  assert.deepEqual(out.failed, ["BIST"]);
  assert.deepEqual(out.missing, []);
  clearMarket();
  const g = fake({ down: { stocks: true, tefas: ["YAT", "EMK", "BYF"] } });
  await assert.rejects(getPrices(["FON:AFT", "BIST:THYAO"], { fetch: g.fetch, now: NOW }), /alınamıyor/);
  // Önceden alınmış fon listesi kaynak çökünce de kullanılır
  clearMarket();
  await getFunds({ fetch: fake().fetch, now: NOW });
  const late = await getFunds({ fetch: g.fetch, now: () => NOW() + 2 * 3600_000 });
  assert.ok(late.funds.has("AFT"));
});

test("hisseler toplu sorulur; hiçbiri bulunamazsa hata değil", async () => {
  clearMarket();
  const f = fake();
  const out = await getPrices(["BIST:THYAO", "BIST:GARAN", "BIST:NONE1"], { fetch: f.fetch, now: NOW });
  assert.deepEqual(Object.keys(out.prices).sort(), ["BIST:GARAN", "BIST:THYAO"]);
  assert.equal(f.calls.filter(c => c.host === "isyatirim").length, 1);
  const none = await getPrices(["BIST:NONE2"], { fetch: f.fetch, now: NOW });
  assert.deepEqual(none.missing, ["BIST:NONE2"]);
});

test("fon araması: kod, ad kelimelerinin başı; Türkçe harfler sade", async () => {
  clearMarket();
  const f = fake();
  assert.deepEqual((await searchFunds("tte", { fetch: f.fetch, now: NOW })).map(x => x.code), ["FON:TTE"]);
  assert.deepEqual((await searchFunds("is portfoy tek", { fetch: f.fetch, now: NOW })).map(x => x.code), ["FON:TTE"]);
  // "ak portföy teknoloji": tam geçen kelimesi çok olan önce
  assert.deepEqual((await searchFunds("ak portföy teknoloji", { fetch: f.fetch, now: NOW })).map(x => x.code), ["FON:AFT", "FON:CPU"]);
  assert.deepEqual(await searchFunds("  ", { fetch: f.fetch, now: NOW }), []);
  assert.equal(V.matchFunds([{ code: "AFT", name: "X" }], "af")[0].code, "AFT");
});

test("/api/fiyat kodları doğrular; /api/fonlar listeyi verir", async () => {
  clearMarket();
  const bad = await handlePrices(new Request("https://cashfollow.app/api/fiyat?kod=USD"));
  assert.equal(bad.status, 400);
  const none = await handlePrices(new Request("https://cashfollow.app/api/fiyat"));
  assert.equal(none.status, 400);
  // Ağ yok: global fetch'e gider; burada sahte fetch'le doldurulmuş önbellek kullanılır
  await getPrices(["FON:AFT", "BIST:THYAO"], { fetch: fake().fetch, now: Date.now });
  const res = await handlePrices(new Request("https://cashfollow.app/api/fiyat?kod=bist:thyao,FON:AFT"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body.prices).sort(), ["BIST:THYAO", "FON:AFT"]);
  assert.match(res.headers.get("Cache-Control"), /max-age=120/);
  const list = await (await handleFunds(new Request("https://cashfollow.app/api/fonlar"))).json();
  assert.equal(list.funds.find(x => x.code === "AFT").price, 0.959756);
});

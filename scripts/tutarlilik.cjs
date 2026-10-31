// Tutarlılık denetimi: aynı veriden hesaplanan görünümler birbirini tutuyor mu? Senaryolar (ve rastgele veriler)
// tarayıcıda uygulamanın kendi koduyla hesaplanır; kurallar:
//   Varlık (üstteki toplam) = Varlığın seyri'nin bugünü; Nakit grafiğinin bugünü = nakit sayılan bakiyeler;
//   serbest nakit (içgörü) + borç alınan para + beklenen tahsilat = Nakit grafiğinin dönem net'i;
//   Girdi ve çıktılar'ın Girdi'si = içgörünün geliri; alış / satış (aktarım) Varlık'ı, geliri ve Girdi ve çıktılar
//   toplamlarını değiştirmez, nakitten nakde aktarım nakdi değiştirmez; ileri tarihli hareket bugünkü bakiyede yok;
//   kişilerin Varlık'ları toplamı = hepsi; birikimden yatırım açık değildir; geçmiş kapanışla alış seyirde sıçramaz;
//   formdan dolar alışı ve bozdurma aktarım olarak saklanır.
// node scripts/yerel.mjs &  ve  node scripts/tutarlilik.cjs [-v]   (Playwright ve internet gerekir: gerçek kur ve fiyatlar;
// SEED=… rastgele verilerin başlangıç değeri)
const { chromium } = require("playwright");

// Sayfada çalışan kısım: senaryoları kurar, her görünümün sayılarını toplar, kuralları denetler
async function inPage(start) {
  const today = T.todayKey();
  const idx = T.parseDate(today).idx;
  const monthFrom = T.dateKey(idx, 1), monthTo = T.dateKey(idx, 31);
  const r = curRates();
  const price = c => r[c];
  const base = () => ({
    people: [{ id: "ben", name: "Ben", color: 0 }, { id: "es", name: "Eşim", color: 1 }], cards: [], installments: [], debts: [],
    entries: [{ id: "maas", personId: "ben", asset: "TRY", amount: 100000, desc: "Maaş", date: T.dateKey(idx, 1) }],
  });
  const day = n => T.dateKey(idx, n);
  const parse = s => { const m = /([−-]?)₺([\d.]+),(\d\d)/.exec(s || ""); return m ? (m[1] ? -1 : 1) * Number(m[2].replace(/\./g, "") + "." + m[3]) : NaN; };

  // Bir verinin bütün görünümleri
  function views(s, pid = "all") {
    state = T.hydrate(JSON.parse(JSON.stringify(s)));
    assetMemo = null;
    const t = B.totals(state, today, curRates(), pid);
    const cs = cashSeries(monthFrom, monthTo, today);
    const cashToday = cs.days.find(d => d.date === today).balance;
    let cashExpected = 0;
    for (const [c, amt] of Object.entries(B.totals(state, today, curRates(), "all").balances)) {
      if (isCashCode(c)) cashExpected += V.toTry(amt, c, curRates()) ?? 0;
    }
    timelineStart = "1"; timelineKind = "all";
    renderTimeline(idx);
    const sum = [...document.querySelectorAll("#timelineSum dd")].map(x => parse(x.textContent));
    const ins = I.insights(state, { today, rates: curRates(), cash: isCashCode });
    const flow = ins.find(x => x.id === "serbest" || x.id === "acik");
    const seyir = assetSeries("1m", pid);
    // İçgörülerin bu ayı (serbest nakit; açık başka bir ayda olabilir)
    const month = I.monthFlows(state, idx, curRates(), T.buildCashflow(state.people, state.cards, state.installments, idx, idx + 1), today, isCashCode);
    return {
      hero: t.assets, seyirToday: seyir?.points.at(-1).value ?? 0, cashToday, cashExpected,
      cashNet: cs.days.at(-1).net, tlIn: sum[0], tlOut: sum[1], tlNet: sum[2],
      month, moves: cs.days.flatMap(d => d.moves.map(m => `${d.date} ${m.desc} ${Math.round(m.value)}`)),
      insIds: ins.map(x => x.id), insIncomeAll: month.income, insNet: month.net + month.borrowed + month.pending, insText: flow?.text ?? "",
    };
  }

  const fails = [];
  const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;
  const check = (name, ok, detail) => { if (!ok) fails.push(`${name}: ${detail}`); };
  const S = {};

  // Senaryolar
  S.yalnizTL = base();
  S.tlPpf = base(); S.tlPpf.entries.push({ id: "ppf", personId: "ben", asset: "FON:ALE", amount: 1000, desc: "", date: day(10), price: price("FON:ALE"), settle: true });
  S.tlHisse = base(); S.tlHisse.entries.push({ id: "h", personId: "ben", asset: "BIST:THYAO", amount: 100, desc: "", date: day(12), price: price("BIST:THYAO"), settle: true });
  S.hisseSat = JSON.parse(JSON.stringify(S.tlHisse)); S.hisseSat.entries.push({ id: "hs", personId: "ben", asset: "BIST:THYAO", amount: -40, desc: "", date: day(20), price: price("BIST:THYAO"), settle: true });
  S.dolarAl = base(); S.dolarAl.entries.push({ id: "usd", personId: "ben", asset: "USD", amount: 1000, desc: "Dolar alımı", date: day(5), price: price("USD"), settle: true });
  S.dolarBoz = JSON.parse(JSON.stringify(S.dolarAl)); S.dolarBoz.entries.push({ id: "usd2", personId: "ben", asset: "USD", amount: -400, desc: "Bozdurma", date: day(15), price: price("USD"), settle: true });
  S.altinAl = base(); S.altinAl.entries.push({ id: "gau", personId: "ben", asset: "GAU", amount: 5, desc: "", date: day(6), price: price("GAU"), settle: true });
  S.ileriTarih = base(); S.ileriTarih.entries.push({ id: "ileri", personId: "ben", asset: "TRY", amount: 20000, desc: "Prim", date: T.addDays(today, 10) });
  S.ileriAlis = base(); S.ileriAlis.entries.push({ id: "ia", personId: "ben", asset: "FON:AFT", amount: 1000, desc: "", date: T.addDays(today, 5), price: price("FON:AFT"), settle: true });
  S.nakitHarcama = base(); S.nakitHarcama.installments.push({ id: "m", personId: "ben", cardId: null, desc: "Market", total: 5000, count: 1, date: day(8) });
  S.dolarMaas = base(); S.dolarMaas.entries.push({ id: "um", personId: "ben", asset: "USD", amount: 500, desc: "Freelance", date: day(3) });
  S.iki = base(); S.iki.entries.push({ id: "e2", personId: "es", asset: "TRY", amount: 30000, desc: "Maaş", date: day(2) },
    { id: "e3", personId: "es", asset: "BIST:ASELS", amount: 10, desc: "", date: day(9), price: price("BIST:ASELS"), settle: true });

  // Kart: Bonus (kesim 5, son ödeme 15), ayın başından takipte; geçen ay ve bu ay harcama
  S.kartli = base(); S.kartli.cards.push({ id: "bonus", name: "Bonus", limit: 50000, cutoffDay: 5, dueDay: 15, color: 0, trackSince: T.dateKey(idx - 1, 1) });
  S.kartli.installments.push({ id: "k1", personId: "ben", cardId: "bonus", desc: "TV", total: 9000, count: 3, date: T.dateKey(idx - 1, 20) },
    { id: "k2", personId: "ben", cardId: "bonus", desc: "Market", total: 2500, count: 1, date: day(3) });
  // Borç: 20.000 TL borç (3'ünde), 5.000 ödeme (20'sinde); 10.000 TL borç verildi (4'ünde)
  S.borclu = base(); S.borclu.debts.push(
    { id: "b1", kind: "person", side: "debt", personId: "ben", party: "Ali", asset: "TRY", amount: 20000, principal: 20000, date: day(3) },
    { id: "b1p", kind: "payment", personId: "ben", debtId: "b1", amount: 5000, date: day(20) },
    { id: "b2", kind: "person", side: "receivable", personId: "ben", party: "Can", asset: "TRY", amount: 10000, principal: 10000, date: day(4) });
  // Kredi: 50.000 çekildi (2'sinde), 12 × 5.000, ilk taksit 25'inde
  S.kredili = base(); S.kredili.debts.push({ id: "kr", kind: "loan", personId: "ben", party: "Banka", asset: "TRY", amount: 60000, principal: 50000, date: day(2), due: day(25), count: 12 });
  // Tekrarlayan: ocaktan beri her ay maaş, her ay nakit kira
  S.tekrarli = { ...base(), entries: [{ id: "tm", personId: "ben", asset: "TRY", amount: 60000, desc: "Maaş", date: T.dateKey(idx - 9, 1), repeat: 0 }],
    installments: [{ id: "kira", personId: "ben", cardId: null, desc: "Kira", total: 20000, count: 1, date: T.dateKey(idx - 9, 3), repeat: 0 }] };
  // Dolar geliri ve dolarla nakit harcama
  S.dolarHarcama = base(); S.dolarHarcama.entries.push({ id: "ug", personId: "ben", asset: "USD", amount: 1000, desc: "Freelance", date: day(3) });
  S.dolarHarcama.installments.push({ id: "uh", personId: "ben", cardId: null, desc: "Otel", total: 200, count: 1, date: day(9), asset: "USD" });
  // Alacağın tahsili ve kart payı
  S.ortakKart = JSON.parse(JSON.stringify(S.kartli)); S.ortakKart.installments.push({ id: "k3", personId: "es", cardId: "bonus", desc: "Ayakkabı", total: 3000, count: 1, date: day(2) });

  // Beklenen tahsilat ve beklenen borç ödemesi bu ayın sonunda (elle ödenen kişi borçları)
  const late = T.dateKey(idx, 29) > today ? T.dateKey(idx, 29) : T.addDays(today, 1);
  S.beklenen = base(); S.beklenen.debts.push(
    { id: "r1", kind: "person", side: "receivable", personId: "ben", party: "Can", asset: "TRY", amount: 8000, principal: 8000, date: day(2), due: late },
    { id: "d1", kind: "person", side: "debt", personId: "ben", party: "Ali", asset: "TRY", amount: 6000, principal: 6000, date: day(3), due: late });
  S.tahsilat = JSON.parse(JSON.stringify(S.beklenen)); S.tahsilat.debts.push({ id: "r1p", kind: "payment", personId: "ben", debtId: "r1", amount: 3000, date: day(10) });

  const V0 = views(S.yalnizTL);
  const all = {};
  for (const [name, s] of Object.entries(S)) {
    const v = all[name] = views(s);
    // 1. Varlık toplamı = Varlığın seyri'nin bugünkü noktası
    check(`${name} · Varlık = seyir bugün`, near(v.hero, v.seyirToday), `${v.hero} ≠ ${v.seyirToday}`);
    // 2. Nakit grafiğinin bugünü = nakit sayılan bakiyeler (kart yok)
    check(`${name} · Nakit bugün = nakit bakiyeleri`, near(v.cashToday, v.cashExpected), `${v.cashToday} ≠ ${v.cashExpected}`);
  }
  // 3. Serbest nakit (içgörü, nakit tanımıyla) + borç alınan para + beklenen tahsilat = Nakit grafiğinin dönem net'i
  for (const name of Object.keys(S)) {
    const v = all[name];
    check(`${name} · içgörü serbest nakit = Nakit dönem net`, v.insNet != null && near(v.insNet, v.cashNet, 1), `${v.insNet} ≠ ${v.cashNet}`);
    // Girdi ve çıktılar gelir / gider listesidir: Girdi = içgörünün geliri (bütün varlıklar)
    check(`${name} · Girdi = içgörü geliri`, near(v.tlIn, v.insIncomeAll, 1), `${v.tlIn} ≠ ${v.insIncomeAll}`);
  }
  // 4. Alış / satış (aktarım): güncel fiyatla Varlık'ı değiştirmez; gelir ya da gider değildir (Girdi ve çıktılar
  // toplamlarına ve içgörü gelirine girmez)
  for (const name of ["tlPpf", "tlHisse", "hisseSat", "dolarAl", "dolarBoz", "altinAl"]) {
    const v = all[name];
    check(`${name} · Varlık değişmez`, near(v.hero, V0.hero, 1), `${v.hero} ≠ ${V0.hero}`);
    check(`${name} · içgörü geliri değişmez`, near(v.insIncomeAll, V0.insIncomeAll, 1), `${v.insIncomeAll} ≠ ${V0.insIncomeAll}`);
    for (const k of ["tlIn", "tlOut", "tlNet"]) check(`${name} · Girdi ve çıktılar ${k} değişmez`, near(v[k], V0[k], 1), `${v[k]} ≠ ${V0[k]}`);
  }
  // 5. Nakitten nakde (TL → para piyasası fonu) aktarım nakdi ve çıktıları değiştirmez
  check("tlPpf · Nakit değişmez", near(all.tlPpf.cashToday, V0.cashToday, 1), `${all.tlPpf.cashToday} ≠ ${V0.cashToday}`);
  // 6. İleri tarihli tek seferlik hareket bugün bakiyede yok
  check("ileriTarih · Varlık'a bugün girmez", near(all.ileriTarih.hero, V0.hero), `${all.ileriTarih.hero} ≠ ${V0.hero}`);
  check("ileriAlis · Varlık'a bugün girmez", near(all.ileriAlis.hero, V0.hero), `${all.ileriAlis.hero} ≠ ${V0.hero}`);
  // 7. Kişilerin Varlık'ları toplamı = hepsi
  const parts = ["ben", "es"].map(p => views(S.iki, p).hero);
  check("iki · kişiler toplamı", near(parts[0] + parts[1], all.iki.hero), `${parts.join(" + ")} ≠ ${all.iki.hero}`);
  // 9. Kişi süzgeci: seyrin bugünü o kişinin Varlık'ı
  for (const name of ["iki", "ortakKart", "kartli"]) for (const pid of ["ben", "es"]) {
    const v = views(S[name], pid);
    check(`${name} · ${pid} · Varlık = seyir bugün`, near(v.hero, v.seyirToday), `${v.hero} ≠ ${v.seyirToday}`);
  }
  // 10. Nakit tanımı değişince de: Nakit bugün = nakit bakiyeleri, serbest nakit = Nakit dönem net
  const def0 = cashDef;
  for (const def of [["TRY"], ["TRY", "MMF", "USD"], ["TRY", "USD", "GAU", "BIST:THYAO"]]) {
    cashDef = def;
    for (const name of ["tlPpf", "tlHisse", "dolarAl", "dolarBoz", "altinAl", "dolarMaas", "dolarHarcama", "kartli", "borclu"]) {
      const v = views(S[name]);
      check(`${name} · [${def}] · Nakit bugün = nakit bakiyeleri`, near(v.cashToday, v.cashExpected), `${v.cashToday} ≠ ${v.cashExpected}`);
      check(`${name} · [${def}] · serbest nakit = Nakit dönem net`, near(v.insNet, v.cashNet, 1), `${v.insNet} ≠ ${v.cashNet}`);
    }
  }
  cashDef = def0;
  // 11. Varlığın seyri: o günün kapanışıyla TL'den alış o gün Varlık'ı değiştirmez (geçmiş fiyatlarla)
  state = T.hydrate(JSON.parse(JSON.stringify(S.tlHisse)));
  loadHistory(["BIST:THYAO", "FON:ALE", "USD"], 30);
  if (historyLoading) await historyLoading;
  const close = (c, d) => priceAt(histories.get(30)?.series[c], d);
  for (const [code, n] of [["BIST:THYAO", 100], ["FON:ALE", 1000], ["USD", 500]]) {
    const d = [12, 13, 14, 15, 16, 19, 20, 21].map(day).find(x => x < today && (histories.get(30)?.series[code] || []).some(([k]) => k === x));
    if (!d) { fails.push(`${code} · geçmiş fiyat yok`); continue; }
    const s = base(); s.entries.push({ id: "t", personId: "ben", asset: code, amount: n, desc: "", date: d, price: close(code, d), settle: true });
    state = T.hydrate(s); assetMemo = null;
    const pts = assetSeries("1m", "all").points;
    const at = pts.find(x => x.date === d), before = pts[pts.indexOf(at) - 1];
    check(`seyir · ${code} alış günü (${d})`, at && before && near(at.value, before.value, 1), `${before?.value} → ${at?.value}`);
  }
  // 12. Birikimden yapılan (planlı) yatırım açık uyarısı vermez
  check("ileriAlis · yatırım açık sayılmaz", !all.ileriAlis.insIds.includes("acik"), all.ileriAlis.insIds.join(","));
  S.buyukAlis = base(); S.buyukAlis.entries.push({ id: "ba", personId: "ben", asset: "BIST:THYAO", amount: 1000, desc: "", date: day(12), price: price("BIST:THYAO"), settle: true });
  const ba = views(S.buyukAlis);
  check("buyukAlis · yatırım açık sayılmaz", !ba.insIds.includes("acik") && /azalıyor/.test(ba.insText), `${ba.insIds} · ${ba.insText}`);
  // 13. Rastgele veriler: kurallar 1, 2, 3, Girdi = gelir, kişiler toplamı
  let seed = start;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const assets = ["TRY", "TRY", "USD", "EUR", "GAU", "FON:ALE", "FON:AFT", "BIST:THYAO", "BIST:ASELS"];
  const defs = [["TRY", "MMF"], ["TRY"], ["TRY", "MMF", "USD", "GAU"]];
  for (let k = 0; k < 300; k++) {
    const s = base();
    s.entries[0].personId = pick(["ben", "es"]);
    const n = 2 + Math.floor(rnd() * 8);
    for (let i = 0; i < n; i++) {
      const a = pick(assets), m = V.market(a), d = T.addDays(today, -Math.floor(rnd() * 40) + (rnd() < 0.15 ? 20 : 0));
      const who = pick(["ben", "es"]), qty = Math.round(1 + rnd() * (a === "TRY" ? 20000 : a === "GAU" ? 20 : m ? 500 : 900));
      const settle = a !== "TRY" && (m ? rnd() < 0.8 : rnd() < 0.5);
      const sell = settle && rnd() < 0.3;
      const e = { id: "r" + i, personId: who, asset: a, amount: sell ? -qty : qty, desc: "x", date: d };
      if (settle) { e.price = price(a) * (0.8 + rnd() * 0.4); e.settle = true; }
      else if (m) { if (rnd() < 0.5) e.price = price(a); }
      else if (a === "TRY" && rnd() < 0.3) e.amount = -qty;
      if (a === "TRY" && rnd() < 0.2) { e.repeat = 0; e.date = T.addDays(today, -60); }
      s.entries.push(e);
    }
    if (rnd() < 0.5) s.installments.push({ id: "p", personId: pick(["ben", "es"]), cardId: null, desc: "Harcama", total: Math.round(rnd() * 8000) + 1, count: 1, date: T.addDays(today, -Math.floor(rnd() * 25)), ...(rnd() < 0.3 ? { asset: "USD", total: 50 } : {}) });
    if (rnd() < 0.4) s.debts.push({ id: "d", kind: "person", side: pick(["debt", "receivable"]), personId: "ben", party: "X", asset: pick(["TRY", "USD"]), amount: 5000, principal: 5000, date: T.addDays(today, -Math.floor(rnd() * 20)) });
    cashDef = defs[k % 3];
    const v = views(s);
    const tag = `rastgele ${k} [${cashDef}]`;
    check(`${tag} · Varlık = seyir bugün`, near(v.hero, v.seyirToday), `${v.hero} ≠ ${v.seyirToday}`);
    check(`${tag} · Nakit bugün = nakit bakiyeleri`, near(v.cashToday, v.cashExpected), `${v.cashToday} ≠ ${v.cashExpected}`);
    if (!near(v.insNet, v.cashNet, 1) && !globalThis.dumped) {
      globalThis.dumped = true;
      const m = v.month;
      fails.push(`AYRINTI ${tag}: ${JSON.stringify(s.entries.concat(s.installments, s.debts))}\n  HAREKETLER: ${v.moves.join(" | ")}\n  İÇGÖRÜ: ${JSON.stringify({ cashIn: m.cashIn, cashOut: m.cashOut, pay: m.cashPayments, invest: m.invest, revalue: m.revalue, borrowed: m.borrowed, pending: m.pending })}`);
    }
    check(`${tag} · serbest nakit = Nakit dönem net`, near(v.insNet, v.cashNet, 1), `${v.insNet} ≠ ${v.cashNet}`);
    check(`${tag} · Girdi = içgörü geliri`, near(v.tlIn, v.insIncomeAll, 1), `${v.tlIn} ≠ ${v.insIncomeAll}`);
    const ps = ["ben", "es"].map(pid => views(s, pid).hero);
    if (!s.debts.length) check(`${tag} · kişiler toplamı`, near(ps[0] + ps[1], v.hero, 0.05), `${ps[0]} + ${ps[1]} ≠ ${v.hero}`);
  }
  cashDef = def0;
  // 8. Dolar geliri (TL'ye çevrilmemiş) gelirdir
  check("dolarMaas · Girdi'ye girer", all.dolarMaas.tlIn > V0.tlIn + 1, `${all.dolarMaas.tlIn} ≤ ${V0.tlIn}`);
  return { fails, all };
}

// Formdan: dolar alışı (TL'den) ve bozdurma kaydedilir, aktarım olarak saklanır
async function formFlow(p) {
  const fails = [];
  await p.evaluate(() => { state = T.hydrate({ people: [{ id: "ben", name: "Ben", color: 0 }], cards: [], installments: [], debts: [],
    entries: [{ id: "m", personId: "ben", asset: "TRY", amount: 100000, desc: "Maaş", date: T.todayKey() }] }); render(); });
  const open = async () => { await p.evaluate(() => openEntrySheet(null, "USD")); await p.waitForTimeout(200); };
  await open();
  await p.fill("#entryForm input[name=amount]", "500");
  await p.check("#entryForm input[name=settle]");
  await p.waitForTimeout(200);
  const kur = await p.inputValue("#entryForm input[name=price]");
  if (!kur) fails.push("form · dolar alışında kur güncel kurla dolmadı");
  await p.click("#entryForm button[type=submit]");
  await p.waitForTimeout(300);
  await open();
  await p.click("#entrySellOpt");
  await p.fill("#entryForm input[name=amount]", "200");
  await p.waitForTimeout(200);
  if (await p.isVisible("#entryForm input[name=settle]")) fails.push("form · bozdurmada TL'ye işleme kutusu görünmemeli");
  await p.click("#entryForm button[type=submit]");
  await p.waitForTimeout(300);
  const es = await p.evaluate(() => state.entries.filter(e => e.asset === "USD"));
  const buy = es.find(e => e.amount === 500), sell = es.find(e => e.amount === -200);
  if (!buy?.settle || !(buy.price > 0)) fails.push(`form · alış aktarım değil: ${JSON.stringify(buy)}`);
  if (!sell?.settle || !(sell.price > 0)) fails.push(`form · bozdurma aktarım değil: ${JSON.stringify(sell)}`);
  const v = await p.evaluate(() => {
    const t = B.totals(state, T.todayKey(), curRates(), "all");
    return { tl: t.balances.TRY, usd: t.balances.USD, rate: curRates().USD, rows: Tablo.changes(state, {}).entries.upsert.map(x => x.row) };
  });
  if (buy && sell && Math.abs(v.tl - (100000 - buy.price * 500 + sell.price * 200)) > 0.02) fails.push(`form · TL bakiyesi ${v.tl}`);
  if (v.usd !== 300) fails.push(`form · dolar bakiyesi ${v.usd}`);
  if (!v.rows.every(r => r.asset !== "USD" || (r.settle === true && r.price > 0))) fails.push("form · eşitleme satırında price / settle yok");
  // Bozdurma düzenlemede yine bozdurma formunda açılır (harcama formuna gitmez)
  await p.evaluate(() => openEntrySheet(state.entries.find(e => e.amount === -200)));
  await p.waitForTimeout(200);
  if (!(await p.isVisible("#entrySheet")) || (await p.inputValue("#entryForm input[name=dir]:checked")) !== "sell") fails.push("form · bozdurma düzenlemede açılmadı");
  await p.keyboard.press("Escape");
  return fails;
}

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 900 } });
  const errors = [];
  p.on("pageerror", e => errors.push(String(e)));
  await p.route("**/cdn.jsdelivr.net/**", r => r.abort());
  // Fiyatları yüklensin diye senaryolardaki fon ve hisseler eldeymiş gibi başla
  const seed = { people: [{ id: "ben", name: "Ben", color: 0 }], cards: [], installments: [], debts: [], entries: ["FON:ALE", "FON:AFT", "BIST:THYAO", "BIST:ASELS"]
    .map((a, i) => ({ id: "s" + i, personId: "ben", asset: a, amount: 1, desc: "", date: "2026-01-01" })).concat([{ id: "u", personId: "ben", asset: "USD", amount: 1, desc: "x", date: "2026-01-01" }]) };
  await p.addInitScript(d => { localStorage.clear(); localStorage.setItem("para.offline", "1"); localStorage.setItem("cashflow.v1", JSON.stringify(d)); }, seed);
  await p.goto(`${process.env.CF_URL || "http://localhost:3100"}/#varliklar`);
  await p.waitForFunction(() => prices?.prices?.["FON:ALE"] && prices?.prices?.["BIST:THYAO"] && rates?.rates?.USD, null, { timeout: 30000 });
  const out = await p.evaluate(inPage, Number(process.env.SEED) || 1234567);
  out.fails.push(...await formFlow(p));
  if (process.argv.includes("-v")) for (const [k, v] of Object.entries(out.all)) console.log(k.padEnd(13), JSON.stringify(v));
  console.log(out.fails.length ? `TUTARSIZ (${out.fails.length}):\n- ` + out.fails.join("\n- ") : "Tutarsızlık yok");
  if (errors.length) console.log("SAYFA HATALARI:\n" + errors.join("\n"));
  await b.close();
  process.exit(out.fails.length ? 1 : 0);
})();

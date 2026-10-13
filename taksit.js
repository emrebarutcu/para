// ---------- Taksit hesapları (DOM'dan bağımsız) ----------
// Excel'deki mantık: bir alışveriş "Ekstre" ayından itibaren "Taksit" kadar ay
// ödenir; her ekstre bir sonraki ayın son ödeme gününde (varsayılan 22) ödenir.
(function (root) {
  const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

  // Ay aritmetiği tek bir tamsayı üzerinden: "2026-09" ↔ 2026 * 12 + 8
  function monthIndex(ym) {
    const [y, m] = String(ym).split("-").map(Number);
    return y * 12 + m - 1;
  }
  function monthKey(idx) {
    return `${Math.floor(idx / 12)}-${String(idx % 12 + 1).padStart(2, "0")}`;
  }
  function monthName(idx) { return MONTHS[idx % 12]; }
  function monthShort(idx) { return MONTHS_SHORT[idx % 12]; }
  function yearOf(idx) { return Math.floor(idx / 12); }

  function dueDate(idx, dueDay) {
    const y = yearOf(idx), m = idx % 12;
    return new Date(y, m, Math.min(dueDay, new Date(y, m + 1, 0).getDate()));
  }

  // ---------- Bir taksitli alışveriş ----------
  // { id, personId, desc, statement: "YYYY-MM", count, total, planCount? }
  // count: ekstre ayından itibaren kalan taksit sayısı (Excel'deki "Taksit")
  // planCount: alışverişin asıl taksit sayısı (Excel'deki "Orijinal Tutar" bundan çıkar)
  function perInstallment(inst) { return inst.total / inst.count; }
  function firstDueIndex(inst) { return monthIndex(inst.statement) + 1; }
  function lastDueIndex(inst)  { return firstDueIndex(inst) + inst.count - 1; }
  function planLength(inst)    { return Math.max(inst.planCount || 0, inst.count); }
  function originalTotal(inst) { return perInstallment(inst) * planLength(inst); }

  // O ay ödenen taksitin plan içindeki sırası (1 tabanlı); ödeme yoksa 0
  function installmentNo(inst, idx) {
    const k = idx - firstDueIndex(inst);
    if (k < 0 || k >= inst.count) return 0;
    return planLength(inst) - inst.count + k + 1;
  }

  // fromIdx ayı ve sonrasında ödenecek taksit sayısı
  function remainingFrom(inst, fromIdx) {
    const first = Math.max(firstDueIndex(inst), fromIdx);
    return Math.max(0, lastDueIndex(inst) - first + 1);
  }

  // Excel'deki özet sayfası: her ay × her kişi için ödenecek tutar
  function buildSchedule(people, installments, fromIdx, toIdx) {
    const known = new Set(people.map(p => p.id));
    const rows = [];
    for (let idx = fromIdx; idx <= toIdx; idx++) {
      const byPerson = Object.fromEntries(people.map(p => [p.id, 0]));
      const items = [];
      let total = 0;
      for (const inst of installments) {
        const no = installmentNo(inst, idx);
        if (!no || !known.has(inst.personId)) continue;
        const amount = perInstallment(inst);
        byPerson[inst.personId] += amount;
        total += amount;
        items.push({ inst, no, amount });
      }
      rows.push({ idx, byPerson, total, items });
    }
    return rows;
  }

  // ---------- Excel içe aktarma ----------
  function normalize(s) {
    return String(s ?? "").trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
  }

  function titleCase(s) {
    return String(s).trim().split(/\s+/)
      .map(w => w.charAt(0).toLocaleUpperCase("tr-TR") + w.slice(1)).join(" ");
  }

  // Sayı ya da "4.821,12" / "4821.12" gibi metin
  function toNumber(v) {
    if (typeof v === "number") return v;
    const s = String(v ?? "").trim().replace(/[₺\s]/g, "");
    if (!s) return NaN;
    return Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  }

  function monthFromName(s) {
    return MONTHS_SHORT.findIndex(n => s.startsWith(normalize(n)));
  }

  // "Eylül", "Eylül 2026", "2026-09" ya da Date → "YYYY-MM".
  // Yılsız ay adı içinde bulunulan yıla oturtulur; bir sonraki aydan ilerideyse geçen yıla.
  function parseStatement(value, today = new Date()) {
    if (value instanceof Date && !isNaN(value)) return monthKey(value.getFullYear() * 12 + value.getMonth());
    const s = normalize(value);
    const iso = s.match(/^(\d{4})-(\d{1,2})/);
    if (iso) return monthKey(Number(iso[1]) * 12 + Number(iso[2]) - 1);
    const mi = monthFromName(s);
    if (mi < 0) return null;
    const y = s.match(/\d{4}/);
    let year = y ? Number(y[0]) : today.getFullYear();
    if (!y && mi > today.getMonth() + 1) year -= 1;
    return monthKey(year * 12 + mi);
  }

  // Bir sayfanın satırları → taksitler. Başlığında "Ürün" olmayan sayfa (ör. özet) null döner.
  function parseSheetRows(rows, today) {
    const hi = rows.findIndex(r => Array.isArray(r) && r.some(c => normalize(c) === "ürün"));
    if (hi < 0) return null;
    const col = {};
    rows[hi].forEach((c, i) => { const k = normalize(c); if (k && !(k in col)) col[k] = i; });
    const cell = (r, name) => (name in col ? r[col[name]] : undefined);

    const items = [];
    let skipped = 0;
    for (const r of rows.slice(hi + 1)) {
      if (!Array.isArray(r)) continue;
      const desc = String(cell(r, "ürün") ?? "").trim();
      if (!desc) continue;
      const count = Math.round(toNumber(cell(r, "taksit")));
      const statement = parseStatement(cell(r, "ekstre"), today);
      const per = toNumber(cell(r, "taksit tutarı"));
      let total = toNumber(cell(r, "toplam"));
      if (!(total > 0) && per > 0) total = per * count;
      if (!statement || !(count > 0) || !(total > 0)) { skipped++; continue; }
      const item = { desc, statement, count, total };
      const original = toNumber(cell(r, "orijinal tutar"));
      const planCount = original > 0 ? Math.round(original / (total / count)) : 0;
      if (planCount > count) item.planCount = planCount;
      items.push(item);
    }
    return { items, skipped };
  }

  // Sayfalar → kişiler. Özet sayfasındaki "22 Ekim" gibi başlıklardan son ödeme günü okunur.
  function parseWorkbook(sheets, today = new Date()) {
    const people = [];
    let dueDay = null, skipped = 0;
    for (const { name, rows } of sheets) {
      const parsed = parseSheetRows(rows, today);
      if (parsed) {
        people.push({ name: titleCase(name), installments: parsed.items });
        skipped += parsed.skipped;
        continue;
      }
      for (const r of rows) {
        for (const c of Array.isArray(r) ? r : []) {
          const m = normalize(c).match(/^(\d{1,2}) (\S+)$/);
          if (dueDay == null && m && monthFromName(m[2]) >= 0 && Number(m[1]) <= 31) dueDay = Number(m[1]);
        }
      }
    }
    return { people, dueDay, skipped };
  }

  const api = {
    MONTHS, MONTHS_SHORT,
    monthIndex, monthKey, monthName, monthShort, yearOf, dueDate,
    perInstallment, firstDueIndex, lastDueIndex, planLength, originalTotal,
    installmentNo, remainingFrom, buildSchedule,
    normalize, titleCase, parseStatement, parseSheetRows, parseWorkbook,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Taksit = api;
})(this);

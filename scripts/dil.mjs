// Çeviri denetimi: iPhone'da (L("…")) ve paylaşılan modüllerde (L("…"), D.t("…")) görünen her Türkçe metnin
// dil/en.json'da İngilizcesi var mı. Eksik varsa listeler ve hata verir (CI: ios.yml → kopru).
//   node scripts/dil.mjs           denetle
//   node scripts/dil.mjs --eksik   eksikleri JSON olarak yaz (sözlüğe eklemek için)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const dict = JSON.parse(fs.readFileSync(path.join(ROOT, "dil/en.json"), "utf8"));

const keys = new Map();   // anahtar → ilk geçtiği yer
const add = (k, where) => { if (!keys.has(k)) keys.set(k, where); };

// Swift ve JS dizgesindeki kaçışları çöz (\" → ", \\ → \)
const unescape = s => s.replace(/\\(["\\'])/g, "$1");

function scan(file, re) {
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(re)) {
    const line = src.slice(0, m.index).split("\n").length;
    add(unescape(m[1]), `${path.relative(ROOT, file)}:${line}`);
  }
}

// iPhone: L("…")
function walk(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}
for (const f of walk(path.join(ROOT, "ios/CashFollow"), ".swift")) {
  if (f.endsWith("Dil.swift")) continue;
  scan(f, /(?<![A-Za-z0-9_])L\("((?:[^"\\]|\\.)*)"/g);
}

// Paylaşılan modüller: L("…") ve D.t("…")
for (const f of ["icgoru.js", "nakit.js", "borc.js", "tekrar.js", "taksit.js", "kategori.js", "varlik.js"]) {
  scan(path.join(ROOT, f), /(?<![A-Za-z0-9_.$])(?:L|D\.t)\("((?:[^"\\]|\\.)*)"/g);
}

// Kodda kurulan anahtarlar: kategoriler, tekrar etiketleri, varlık adları
const K = require(path.join(ROOT, "kategori.js"));
for (const c of K.CATEGORIES) { add(c.name, "kategori.js"); add(c.hint, "kategori.js"); }
const R = require(path.join(ROOT, "tekrar.js"));
for (const u of Object.keys(R.UNIT_IN)) {
  const s = `${R.UNIT_IN[u]} bir`;
  add(s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1), "tekrar.js");
  add(`{0} ${R.UNIT_IN[u]} bir`, "tekrar.js");
  add(`/${R.UNIT_NAMES[u]}`, "tekrar.js");
  add(`/{0} ${R.UNIT_NAMES[u]}`, "tekrar.js");
}
const V = require(path.join(ROOT, "varlik.js"));
for (const a of V.assetsFor("TRY")) add(a.name, "varlik.js");

const missing = [...keys].filter(([k]) => typeof dict[k] !== "string" || !dict[k]);
// Yer tutucular aynı mı ({0}, {1}…)
const holes = s => [...s.matchAll(/\{(\d+)\}/g)].map(m => m[1]).sort().join(",");
const badHoles = [...keys.keys()].filter(k => typeof dict[k] === "string" && holes(k) !== holes(dict[k]));
const unused = Object.keys(dict).filter(k => !keys.has(k));

if (process.argv.includes("--eksik")) {
  console.log(JSON.stringify(Object.fromEntries(missing.map(([k]) => [k, ""])), null, 2));
  process.exit(0);
}
console.log(`${keys.size} metin, ${Object.keys(dict).length} çeviri`);
if (unused.length) console.log(`Kullanılmayan çeviri (${unused.length}): ${unused.slice(0, 10).map(k => JSON.stringify(k)).join(", ")}${unused.length > 10 ? " …" : ""}`);
if (badHoles.length) console.log(`Yer tutucusu uymayan (${badHoles.length}):\n` + badHoles.map(k => `  ${JSON.stringify(k)} → ${JSON.stringify(dict[k])}`).join("\n"));
if (missing.length) console.log(`Çevirisi olmayan (${missing.length}):\n` + missing.map(([k, w]) => `  ${w}  ${JSON.stringify(k)}`).join("\n"));
process.exit(missing.length || badHoles.length ? 1 : 0);

#!/usr/bin/env python3
"""App Store sayfası (magaza.yml): magaza/<dil>.md metinlerini ve magaza/ayarlar.json'u App Store Connect API ile yazar.

  asc_magaza.py oku                  → App Store Connect'teki durumu yazar (hiçbir şey değiştirmez)
  asc_magaza.py kuru  [--ekran DIR]  → neyin değişeceğini yazar, değiştirmez
  asc_magaza.py gonder [--ekran DIR] → değiştirir: metinler, adresler, kategori, telif, yaş sınırı, ülkeler, fiyat,
                                        build, ekran görüntüleri (DIR: ekran-goruntuleri dalının içeriği)

İncelemeye göndermez: o adım elle (App Store Connect → Add for Review), kullanıcının onayıyla.
Depo herkese açık, Actions günlükleri de: inceleme iletişim bilgileri ve demo hesap yalnızca "dolu / boş" diye yazılır.
Ortam: KEY_ID, ISSUER_ID, KEY_PATH (.p8). Gerekli paketler: pyjwt, cryptography.
"""
import hashlib, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

KOK = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MAGAZA = os.path.join(KOK, "magaza")
API = "https://api.appstoreconnect.apple.com"

# magaza/<dil>.md başlıkları (parantez içi sınır yok sayılır) → alan, App Store'un karakter sınırı
BASLIK = {"name": "ad", "名前": "ad", "subtitle": "alt", "サブタイトル": "alt", "keywords": "anahtar", "キーワード": "anahtar",
          "promotional text": "tanitim", "プロモーションテキスト": "tanitim", "description": "aciklama", "説明": "aciklama",
          "what's new": "yenilikler", "新機能": "yenilikler"}
SINIR = {"ad": 30, "alt": 30, "anahtar": 100, "tanitim": 170, "aciklama": 4000, "yenilikler": 4000}
# Alan → App Store Connect özniteliği
BILGI = {"ad": "name", "alt": "subtitle"}                                                 # appInfoLocalizations
SURUM = {"aciklama": "description", "anahtar": "keywords", "tanitim": "promotionalText",   # appStoreVersionLocalizations
         "yenilikler": "whatsNew"}
DUZENLENIR = {"PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"}
YAYINDA = {"READY_FOR_DISTRIBUTION", "READY_FOR_SALE", "REPLACED_WITH_NEW_INFO", "ACCEPTED"}

KURU = True
HATALAR = []


class HataAPI(Exception):
    def __init__(self, kod, metin):
        super().__init__(f"{kod} {metin}")
        self.kod = kod


def token():
    import jwt
    now = int(time.time())
    return jwt.encode({"iss": os.environ["ISSUER_ID"], "iat": now, "exp": now + 900, "aud": "appstoreconnect-v1"},
                      open(os.environ["KEY_PATH"]).read(), algorithm="ES256", headers={"kid": os.environ["KEY_ID"], "typ": "JWT"})


def call(method, path, body=None):
    url = path if path.startswith("http") else API + (path if path.startswith("/v") else "/v1" + path)
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json"})
    for deneme in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                text = res.read().decode()
                return json.loads(text) if text else None
        except urllib.error.HTTPError as e:
            metin = e.read().decode()
            if e.code in (429, 500, 502, 503) and deneme < 3:
                time.sleep(5 * (deneme + 1))
                continue
            try:
                errs = json.loads(metin).get("errors", [])
                metin = "; ".join(f"{x.get('title', '')}: {x.get('detail', '')}" for x in errs) or metin
            except ValueError:
                pass
            raise HataAPI(e.code, f"{method} {url.replace(API, '')}: {metin[:1200]}")


def get(path):
    return call("GET", path)


def hepsi(path):
    """Sayfalı listenin bütün öğeleri (ve included)."""
    data, inc = [], []
    while path:
        r = get(path)
        data += r.get("data", [])
        inc += r.get("included", [])
        path = r.get("links", {}).get("next")
    return data, inc


def yoksa_none(path):
    try:
        return get(path)
    except HataAPI as e:
        if e.kod == 404:
            return None
        raise


def yaz(method, path, body, aciklama):
    """Değişiklik: kuruda yalnızca yazar."""
    print(("  [kuru] " if KURU else "  → ") + aciklama)
    if KURU:
        return None
    return call(method, path, body)


def bolum(ad, f, *a):
    """Bir bölümdeki hata ötekileri durdurmasın; sonda hepsi yazılır."""
    print(f"\n## {ad}")
    try:
        return f(*a)
    except HataAPI as e:
        mesaj = f"{ad}: {e}"
        if e.kod == 403:
            mesaj += " (API anahtarının yetkisi yetmiyor: App Store Connect → Kullanıcılar ve Erişim → Entegrasyonlar'da anahtar App Manager ya da Admin olmalı)"
        print(f"::error::{mesaj}")
        HATALAR.append(mesaj)


def kisa(s, n=90):
    s = (s or "").replace("\n", " ⏎ ")
    return s if len(s) <= n else s[:n] + f"… ({len(s or '')} karakter)"


# ---------- magaza/ dosyaları ----------

def ayarlar():
    with open(os.path.join(MAGAZA, "ayarlar.json"), encoding="utf-8") as f:
        return json.load(f)


def metin(dosya):
    """magaza/<dil>.md → {ad, alt, anahtar, tanitim, aciklama[, yenilikler]}; sınırı aşan alan hata."""
    alanlar, ad, satirlar = {}, None, []
    for satir in open(dosya, encoding="utf-8").read().splitlines() + ["## son"]:
        if satir.startswith("## "):
            if ad:
                alanlar[ad] = "\n".join(satirlar).strip()
            baslik = re.sub(r"\s*\(.*\)\s*$", "", satir[3:]).strip().lower()
            ad = BASLIK.get(baslik)
            if ad is None and baslik != "son":
                sys.exit(f"{dosya}: tanınmayan başlık '{satir}' (BASLIK'a ekle)")
            satirlar = []
        elif ad:
            satirlar.append(satir)
    for k, v in alanlar.items():
        if len(v) > SINIR[k]:
            sys.exit(f"{dosya}: {k} {len(v)} karakter, sınır {SINIR[k]}")
    eksik = {"ad", "alt", "anahtar", "aciklama"} - set(alanlar)
    if eksik:
        sys.exit(f"{dosya}: eksik bölüm {sorted(eksik)}")
    return alanlar


def metinler(ay):
    return {loc: metin(os.path.join(MAGAZA, f"{dil}.md")) for dil, loc in ay["diller"].items()}


# ---------- App Store Connect nesneleri ----------

def uygulama(ay):
    bundle = ay["paket"]
    apps = [a for a in get(f"/apps?filter[bundleId]={bundle}")["data"] if a["attributes"]["bundleId"] == bundle]
    if not apps:
        sys.exit(f"App Store Connect'te {bundle} yok (SETUP.md → TestFlight, 2. adım)")
    return apps[0]


def durum(x):
    a = x["attributes"]
    return a.get("appVersionState") or a.get("appStoreState") or a.get("state") or "?"


def app_info(app):
    infos = get(f"/apps/{app['id']}/appInfos?include=primaryCategory,secondaryCategory")["data"]
    duz = [i for i in infos if durum(i) not in YAYINDA]
    return (duz or infos)[0], infos


def surumler(app):
    return hepsi(f"/apps/{app['id']}/appStoreVersions?filter[platform]=IOS&limit=20")[0]


def duzenlenen_surum(app):
    vs = [v for v in surumler(app) if durum(v) in DUZENLENIR]
    return vs[0] if vs else None


def web_surumu():
    s = open(os.path.join(KOK, "version.js")).read()
    return re.search(r"APP_VERSION = '([^']+)'", s).group(1)


# ---------- oku ----------

def oku_uygulama(app):
    a = app["attributes"]
    print(f"{a['name']} ({a['bundleId']}), id {app['id']}, ana dil {a.get('primaryLocale')}, "
          f"içerik hakları {a.get('contentRightsDeclaration')}")


def oku_bilgi(app):
    info, infos = app_info(app)
    for i in infos:
        rel = i.get("relationships", {})
        kat = lambda k: (rel.get(k, {}).get("data") or {}).get("id")
        print(f"appInfo {i['id']}: {durum(i)}, kategori {kat('primaryCategory')} / {kat('secondaryCategory')}"
              + (" ← düzenlenen" if i is info else ""))
    for l in hepsi(f"/appInfos/{info['id']}/appInfoLocalizations?limit=50")[0]:
        a = l["attributes"]
        print(f"  {a['locale']}: ad «{a.get('name')}», alt «{a.get('subtitle')}», gizlilik {a.get('privacyPolicyUrl')}")
    yas = get(f"/appInfos/{info['id']}/ageRatingDeclaration")["data"]
    print("Yaş sınırı bildirimi:", json.dumps(yas["attributes"], ensure_ascii=False, sort_keys=True))


def oku_surumler(app):
    for v in surumler(app):
        a = v["attributes"]
        print(f"sürüm {a['versionString']}: {durum(v)}, telif «{a.get('copyright')}», yayın {a.get('releaseType')}, "
              f"oluşturuldu {a.get('createdDate')}")
        if durum(v) not in DUZENLENIR and durum(v) not in YAYINDA:
            continue
        b = yoksa_none(f"/appStoreVersions/{v['id']}/build")
        b = b and b.get("data")
        print(f"  build: {b['attributes']['version'] if b else 'seçilmedi'}")
        d = yoksa_none(f"/appStoreVersions/{v['id']}/appStoreReviewDetail")
        if d and d.get("data"):
            r = d["data"]["attributes"]
            print("  inceleme bilgisi: " + ", ".join(f"{k} {'dolu' if r.get(k) else 'boş'}" for k in
                  ("contactFirstName", "contactLastName", "contactPhone", "contactEmail", "notes"))
                  + f", demo hesap gerekli: {r.get('demoAccountRequired')}, demo hesap {'dolu' if r.get('demoAccountName') else 'boş'}")
        else:
            print("  inceleme bilgisi: yok")
        for l in hepsi(f"/appStoreVersions/{v['id']}/appStoreVersionLocalizations?limit=50")[0]:
            a = l["attributes"]
            print(f"  {a['locale']}: destek {a.get('supportUrl')}, pazarlama {a.get('marketingUrl')}")
            for k in ("keywords", "promotionalText", "description", "whatsNew"):
                print(f"    {k}: {kisa(a.get(k))}")
            sets, inc = hepsi(f"/appStoreVersionLocalizations/{l['id']}/appScreenshotSets?include=appScreenshots&limit=50")
            for s in sets:
                n = len(s.get("relationships", {}).get("appScreenshots", {}).get("data", []))
                print(f"    ekran {s['attributes']['screenshotDisplayType']}: {n} görüntü")


def oku_satis(app):
    av = yoksa_none(f"/apps/{app['id']}/appAvailabilityV2")
    if not av or not av.get("data"):
        print("Ülkeler: hiç ayarlanmamış")
    else:
        ta, inc = hepsi(f"/v2/appAvailabilities/{av['data']['id']}/territoryAvailabilities?include=territory&limit=200")
        acik = sorted(t["relationships"]["territory"]["data"]["id"] for t in ta if t["attributes"].get("available"))
        kapali = sorted(t["relationships"]["territory"]["data"]["id"] for t in ta if not t["attributes"].get("available"))
        print(f"Ülkeler: {len(acik)} açık, kapalı: {' '.join(kapali) or '—'}; yeni ülkelerde otomatik: "
              f"{av['data']['attributes'].get('availableInNewTerritories')}")
    fiyat = fiyatlar(app)
    print(f"Fiyat: {fiyat}" if fiyat is not None else "Fiyat: ayarlanmamış")


def fiyatlar(app):
    """Elle girilmiş fiyatlar (USD karşılığı); hiç ayarlanmamışsa None (o zaman manualPrices 404 döner)."""
    ps = yoksa_none(f"/apps/{app['id']}/appPriceSchedule")
    if not ps or not ps.get("data"):
        return None
    try:
        mp, inc = hepsi(f"/appPriceSchedules/{ps['data']['id']}/manualPrices?include=appPricePoint&limit=50")
    except HataAPI as e:
        if e.kod == 404:
            return None
        raise
    return [i["attributes"].get("customerPrice") for i in inc if i["type"] == "appPricePoints"] if mp else None


def oku_abonelik(app):
    gruplar, inc = hepsi(f"/apps/{app['id']}/subscriptionGroups?include=subscriptions&limit=20")
    if not gruplar:
        print("Abonelik grubu yok")
    for g in gruplar:
        gl = hepsi(f"/subscriptionGroups/{g['id']}/subscriptionGroupLocalizations?limit=50")[0]
        print(f"grup «{g['attributes'].get('referenceName')}» ({g['id']}): diller "
              + (", ".join(f"{l['attributes']['locale']} «{l['attributes'].get('name')}»" for l in gl) or "yok"))
    for s in [i for i in inc if i["type"] == "subscriptions"]:
        a = s["attributes"]
        print(f"  {a.get('productId')} ({s['id']}): {a.get('state')}, {a.get('subscriptionPeriod')}, «{a.get('name')}», "
              f"sıra {a.get('groupLevel')}, aile paylaşımı {a.get('familySharable')}")
        sl = hepsi(f"/subscriptions/{s['id']}/subscriptionLocalizations?limit=50")[0]
        print("    diller: " + (", ".join(f"{l['attributes']['locale']} «{l['attributes'].get('name')}» / «{kisa(l['attributes'].get('description'), 40)}»" for l in sl) or "yok"))
        pr, pinc = hepsi(f"/subscriptions/{s['id']}/prices?include=subscriptionPricePoint,territory&limit=200")
        usa = [i["attributes"].get("customerPrice") for p in pr
               if (p["relationships"].get("territory", {}).get("data") or {}).get("id") == "USA"
               for i in pinc if i["type"] == "subscriptionPricePoints" and i["id"] == p["relationships"]["subscriptionPricePoint"]["data"]["id"]]
        print(f"    fiyat: {len(pr)} ülke, ABD {usa}")
        io = hepsi(f"/subscriptions/{s['id']}/introductoryOffers?limit=50")[0]
        print("    tanıtım teklifi: " + (", ".join(sorted({f"{o['attributes'].get('offerMode')} {o['attributes'].get('duration')}" for o in io})) + f" ({len(io)} ülke)" if io else "yok"))
        ek = yoksa_none(f"/subscriptions/{s['id']}/appStoreReviewScreenshot")
        print(f"    inceleme görüntüsü: {'var' if ek and ek.get('data') else 'yok'}")
        av = yoksa_none(f"/subscriptions/{s['id']}/subscriptionAvailability")
        print(f"    ülkeler: {'ayarlı' if av and av.get('data') else 'ayarlanmamış'}")


def oku_build(app):
    builds, inc = hepsi(f"/builds?filter[app]={app['id']}&sort=-uploadedDate&limit=5&include=preReleaseVersion"
                        "&fields[builds]=version,processingState,uploadedDate,expired,preReleaseVersion")
    surum = {i["id"]: i["attributes"]["version"] for i in inc if i["type"] == "preReleaseVersions"}
    for b in builds[:5]:
        a = b["attributes"]
        pv = surum.get((b["relationships"]["preReleaseVersion"]["data"] or {}).get("id"))
        print(f"  {pv} ({a['version']}): {a['processingState']}, {a['uploadedDate']}" + (", süresi doldu" if a.get("expired") else ""))


def oku(ay):
    app = uygulama(ay)
    bolum("Uygulama", oku_uygulama, app)
    bolum("Uygulama bilgisi (ad, alt başlık, kategori, yaş)", oku_bilgi, app)
    bolum("Sürümler", oku_surumler, app)
    bolum("Satış (ülkeler, fiyat)", oku_satis, app)
    bolum("Abonelikler", oku_abonelik, app)
    bolum("Son build'ler", oku_build, app)
    print("\nApp Privacy (veri toplama formu) API'de yok: App Store Connect → App Privacy'de elle (SETUP.md → App Store sayfası).")


# ---------- gonder ----------

def fark(simdi, istenen):
    return {k: v for k, v in istenen.items() if v is not None and (simdi.get(k) or "") != v}


def gonder_uygulama(app, ay):
    istenen = {"contentRightsDeclaration": ay.get("icerikHaklari")}
    d = fark(app["attributes"], istenen)
    if d:
        yaz("PATCH", f"/apps/{app['id']}", {"data": {"type": "apps", "id": app["id"], "attributes": d}}, f"uygulama: {d}")
    else:
        print("  değişiklik yok")


def gonder_bilgi(app, ay, mt):
    info, _ = app_info(app)
    kat = ay.get("kategori", {})
    rel = {}
    for anahtar, iliski in (("birincil", "primaryCategory"), ("ikincil", "secondaryCategory")):
        if anahtar in kat:
            simdi = (info.get("relationships", {}).get(iliski, {}).get("data") or {}).get("id")
            if simdi != kat[anahtar]:
                rel[iliski] = {"data": {"type": "appCategories", "id": kat[anahtar]} if kat[anahtar] else None}
    if rel:
        yaz("PATCH", f"/appInfos/{info['id']}", {"data": {"type": "appInfos", "id": info["id"], "relationships": rel}},
            f"kategori: {', '.join(f'{k} {(v['data'] or {}).get('id')}' for k, v in rel.items())}")

    mevcut = {l["attributes"]["locale"]: l for l in hepsi(f"/appInfos/{info['id']}/appInfoLocalizations?limit=50")[0]}
    for loc, m in mt.items():
        istenen = {BILGI[k]: m[k] for k in BILGI if k in m}
        istenen["privacyPolicyUrl"] = ay["adresler"].get("gizlilik")
        l = mevcut.get(loc)
        if l:
            d = fark(l["attributes"], istenen)
            if d:
                yaz("PATCH", f"/appInfoLocalizations/{l['id']}",
                    {"data": {"type": "appInfoLocalizations", "id": l["id"], "attributes": d}},
                    f"{loc} ad/alt başlık: " + ", ".join(f"{k} «{kisa(v, 60)}»" for k, v in d.items()))
        else:
            yaz("POST", "/appInfoLocalizations", {"data": {"type": "appInfoLocalizations",
                "attributes": {"locale": loc, **{k: v for k, v in istenen.items() if v}},
                "relationships": {"appInfo": {"data": {"type": "appInfos", "id": info["id"]}}}}},
                f"{loc} dili ekleniyor: ad «{istenen.get('name')}», alt «{istenen.get('subtitle')}»")

    yas = ay.get("yas") or {}
    if yas:
        dek = get(f"/appInfos/{info['id']}/ageRatingDeclaration")["data"]
        simdi = dek["attributes"]
        bilinmeyen = [k for k in yas if k not in simdi]
        if bilinmeyen:
            print(f"::warning::yaş sınırında App Store Connect'in bilmediği alanlar atlandı: {bilinmeyen}")
        d = {k: v for k, v in yas.items() if k in simdi and simdi[k] != v}
        bos = [k for k, v in simdi.items() if v is None and k not in yas]
        if bos:
            print(f"  yaş sınırında boş kalan alanlar (ayarlar.json → yas): {bos}")
        if d:
            yaz("PATCH", f"/ageRatingDeclarations/{dek['id']}",
                {"data": {"type": "ageRatingDeclarations", "id": dek["id"], "attributes": d}}, f"yaş sınırı: {d}")


def gonder_surum(app, ay):
    """Düzenlenebilir sürüm: yoksa açılır; sürüm numarası version.js'teki web sürümü."""
    hedef = web_surumu()
    v = duzenlenen_surum(app)
    istenen = {"versionString": hedef, "copyright": ay.get("telif")}
    if v is None:
        r = yaz("POST", "/appStoreVersions", {"data": {"type": "appStoreVersions",
                "attributes": {"platform": "IOS", **{k: x for k, x in istenen.items() if x}},
                "relationships": {"app": {"data": {"type": "apps", "id": app["id"]}}}}}, f"yeni sürüm {hedef} açılıyor")
        return r and r["data"]
    d = fark(v["attributes"], istenen)
    if d:
        yaz("PATCH", f"/appStoreVersions/{v['id']}", {"data": {"type": "appStoreVersions", "id": v["id"], "attributes": d}},
            f"sürüm {v['attributes']['versionString']}: {d}")
        v = {**v, "attributes": {**v["attributes"], **d}}   # kuruda da sonraki adımlar yeni numarayla baksın
    else:
        print(f"  sürüm {hedef} ({durum(v)}): değişiklik yok")
    return v


def gonder_build(app, v):
    s = v["attributes"]["versionString"]
    b = get(f"/builds?filter[app]={app['id']}&filter[preReleaseVersion.version]={s}&filter[processingState]=VALID"
            "&filter[expired]=false&sort=-uploadedDate&limit=1")["data"]
    if not b:
        print(f"::warning::{s} sürümünün geçerli build'i yok: önce TestFlight iş akışı (build seçilmeden incelemeye gönderilemez)")
        return
    simdi = yoksa_none(f"/appStoreVersions/{v['id']}/build")
    simdi = simdi and simdi.get("data")
    if simdi and simdi["id"] == b[0]["id"]:
        print(f"  build {b[0]['attributes']['version']} zaten seçili")
        return
    yaz("PATCH", f"/appStoreVersions/{v['id']}/relationships/build", {"data": {"type": "builds", "id": b[0]["id"]}},
        f"build {b[0]['attributes']['version']} seçiliyor")


def gonder_surum_metinleri(v, ay, mt):
    mevcut = {l["attributes"]["locale"]: l for l in hepsi(f"/appStoreVersions/{v['id']}/appStoreVersionLocalizations?limit=50")[0]}
    for loc, m in mt.items():
        istenen = {SURUM[k]: m[k] for k in SURUM if k in m}
        istenen["supportUrl"] = ay["adresler"].get("destek")
        istenen["marketingUrl"] = ay["adresler"].get("pazarlama")
        l = mevcut.get(loc)
        if l:
            d = fark(l["attributes"], istenen)
            if d:
                yaz("PATCH", f"/appStoreVersionLocalizations/{l['id']}",
                    {"data": {"type": "appStoreVersionLocalizations", "id": l["id"], "attributes": d}},
                    f"{loc}: " + ", ".join(f"{k} «{kisa(x, 50)}»" for k, x in d.items()))
            else:
                print(f"  {loc}: değişiklik yok")
        else:
            yaz("POST", "/appStoreVersionLocalizations", {"data": {"type": "appStoreVersionLocalizations",
                "attributes": {"locale": loc, **{k: x for k, x in istenen.items() if x}},
                "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": v["id"]}}}}},
                f"{loc} sürüm metinleri ekleniyor")


def md5(yol):
    return hashlib.md5(open(yol, "rb").read()).hexdigest()


def yukle_ekran(set_id, yol):
    veri = open(yol, "rb").read()
    r = call("POST", "/appScreenshots", {"data": {"type": "appScreenshots",
             "attributes": {"fileName": os.path.basename(yol), "fileSize": len(veri)},
             "relationships": {"appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": set_id}}}}})["data"]
    for op in r["attributes"]["uploadOperations"]:
        parca = veri[op["offset"]:op["offset"] + op["length"]]
        req = urllib.request.Request(op["url"], method=op["method"], data=parca,
                                     headers={h["name"]: h["value"] for h in op.get("requestHeaders", [])})
        urllib.request.urlopen(req, timeout=300).read()
    call("PATCH", f"/appScreenshots/{r['id']}", {"data": {"type": "appScreenshots", "id": r["id"],
         "attributes": {"uploaded": True, "sourceFileChecksum": hashlib.md5(veri).hexdigest()}}})
    return r["id"]


def gonder_ekranlar(v, ay, klasor):
    ek = ay.get("ekranlar") or {}
    tur = ek.get("tur", "APP_IPHONE_67")
    if not klasor:
        print("  --ekran verilmedi, atlandı")
        return
    mevcut = {l["attributes"]["locale"]: l for l in hepsi(f"/appStoreVersions/{v['id']}/appStoreVersionLocalizations?limit=50")[0]}
    for loc, dosyalar in ek.get("diller", {}).items():
        yollar = [os.path.join(klasor, d) for d in dosyalar]
        eksik = [d for d, y in zip(dosyalar, yollar) if not os.path.exists(y)]
        if eksik:
            raise HataAPI(0, f"{loc}: ekran-goruntuleri dalında yok: {eksik}")
        l = mevcut.get(loc)
        if not l:
            print(f"  {loc}: dil henüz yok, metinlerden sonra eklenecek ({len(yollar)} görüntü)")
            continue
        sets, inc = hepsi(f"/appStoreVersionLocalizations/{l['id']}/appScreenshotSets?include=appScreenshots&limit=50")
        s = next((x for x in sets if x["attributes"]["screenshotDisplayType"] == tur), None)
        goruntu = {i["id"]: i for i in inc if i["type"] == "appScreenshots"}
        simdi = [goruntu[x["id"]]["attributes"] for x in
                 (s or {}).get("relationships", {}).get("appScreenshots", {}).get("data", []) if x["id"] in goruntu]
        hal = lambda a: (a.get("assetDeliveryState") or {}).get("state") or "?"
        # Apple işlerken (UPLOAD_COMPLETE) özet boş gelir: o zaman dosya adı ve boyutu
        ayni = lambda a, y: hal(a) != "FAILED" and (a.get("sourceFileChecksum") == md5(y) if a.get("sourceFileChecksum")
                                                    else (a.get("fileName"), a.get("fileSize")) == (os.path.basename(y), os.path.getsize(y)))
        if len(simdi) == len(yollar) and all(ayni(a, y) for a, y in zip(simdi, yollar)):
            isleniyor = sum(hal(a) != "COMPLETE" for a in simdi)
            print(f"  {loc}: {len(yollar)} görüntü aynı" + (f" ({isleniyor} tanesini Apple hâlâ işliyor)" if isleniyor else ""))
            continue
        print(("  [kuru] " if KURU else "  → ") + f"{loc}: {len(simdi)} görüntü yerine {len(yollar)} ({', '.join(dosyalar)})"
              + " | şimdiki durum: " + " ".join(hal(a) for a in simdi))
        if KURU:
            continue
        if s is None:
            s = call("POST", "/appScreenshotSets", {"data": {"type": "appScreenshotSets", "attributes": {"screenshotDisplayType": tur},
                     "relationships": {"appStoreVersionLocalization": {"data": {"type": "appStoreVersionLocalizations", "id": l["id"]}}}}})["data"]
        for x in (s.get("relationships", {}).get("appScreenshots", {}).get("data", []) or []):
            call("DELETE", f"/appScreenshots/{x['id']}")
        ids = [yukle_ekran(s["id"], y) for y in yollar]
        call("PATCH", f"/appScreenshotSets/{s['id']}/relationships/appScreenshots",
             {"data": [{"type": "appScreenshots", "id": i} for i in ids]})
        print(f"    yüklendi; Apple birkaç dakika işler")


def gonder_ulkeler(app, ay):
    ul = ay.get("ulkeler")
    if not ul:
        print("  ayarlar.json'da yok, dokunulmadı")
        return
    haric = set(ul.get("haric", []))
    av = yoksa_none(f"/apps/{app['id']}/appAvailabilityV2")
    if not av or not av.get("data"):
        ter = hepsi("/territories?limit=200")[0]
        acik = [t["id"] for t in ter if t["id"] not in haric]
        yaz("POST", "/v2/appAvailabilities", {
            "data": {"type": "appAvailabilities", "attributes": {"availableInNewTerritories": ul.get("yeniUlkeler", True)},
                     "relationships": {"app": {"data": {"type": "apps", "id": app["id"]}},
                                       "territoryAvailabilities": {"data": [{"type": "territoryAvailabilities", "id": "${" + t["id"] + "}"} for t in ter]}}},
            "included": [{"type": "territoryAvailabilities", "id": "${" + t["id"] + "}", "attributes": {"available": t["id"] not in haric},
                          "relationships": {"territory": {"data": {"type": "territories", "id": t["id"]}}}} for t in ter]},
            f"ülkeler ilk kez: {len(acik)} açık, kapalı {sorted(haric)}")
        return
    ta, _ = hepsi(f"/v2/appAvailabilities/{av['data']['id']}/territoryAvailabilities?include=territory&limit=200")
    degisen = 0
    for t in ta:
        kod = t["relationships"]["territory"]["data"]["id"]
        istenen = kod not in haric
        if bool(t["attributes"].get("available")) != istenen:
            degisen += 1
            yaz("PATCH", f"/territoryAvailabilities/{t['id']}", {"data": {"type": "territoryAvailabilities", "id": t["id"],
                "attributes": {"available": istenen}}}, f"{kod}: {'aç' if istenen else 'kapat'}")
    if not degisen:
        print(f"  değişiklik yok (kapalı: {sorted(haric)})")


def gonder_fiyat(app, ay):
    if ay.get("fiyat") is None:
        print("  ayarlar.json'da yok, dokunulmadı")
        return
    simdi = fiyatlar(app)
    if simdi is not None:
        print(f"  fiyat zaten ayarlı ({simdi}), dokunulmadı (değiştirmek: App Store Connect → Pricing and Availability)")
        return
    hedef = float(ay["fiyat"])
    nokta, path = None, f"/apps/{app['id']}/appPricePoints?filter[territory]=USA&limit=200"
    while path and not nokta:
        r = get(path)
        nokta = next((p for p in r["data"] if float(p["attributes"]["customerPrice"]) == hedef), None)
        path = r.get("links", {}).get("next")
    if not nokta:
        raise HataAPI(0, f"ABD'de {hedef} USD fiyat noktası bulunamadı")
    yaz("POST", "/appPriceSchedules", {
        "data": {"type": "appPriceSchedules", "relationships": {
            "app": {"data": {"type": "apps", "id": app["id"]}},
            "baseTerritory": {"data": {"type": "territories", "id": "USA"}},
            "manualPrices": {"data": [{"type": "appPrices", "id": "${fiyat}"}]}}},
        "included": [{"type": "appPrices", "id": "${fiyat}", "attributes": {"startDate": None},
                      "relationships": {"appPricePoint": {"data": {"type": "appPricePoints", "id": nokta["id"]}}}}]},
        f"fiyat: {hedef} USD (temel ülke ABD)")


def satis_ulkeleri(ay):
    haric = set((ay.get("ulkeler") or {}).get("haric", []))
    return [t["id"] for t in hepsi("/territories?limit=200")[0] if t["id"] not in haric]


def gonder_abonelik(app, ay):
    """Abonelik grubu ve ürünlerin dil metinleri (ad ≤30 / grup adı ≤75, açıklama ≤55) ve satıldığı ülkeler.
    Fiyat ve ücretsiz deneme App Store Connect'te kalır (kodda fiyat yok)."""
    ab = ay.get("abonelik")
    if not ab:
        print("  ayarlar.json'da yok, dokunulmadı")
        return
    gruplar, inc = hepsi(f"/apps/{app['id']}/subscriptionGroups?include=subscriptions&limit=20")
    for g in gruplar:
        mevcut = {l["attributes"]["locale"]: l for l in hepsi(f"/subscriptionGroups/{g['id']}/subscriptionGroupLocalizations?limit=50")[0]}
        for loc, ad in ab.get("grup", {}).items():
            l = mevcut.get(loc)
            if l and l["attributes"].get("name") == ad:
                continue
            if l:
                yaz("PATCH", f"/subscriptionGroupLocalizations/{l['id']}", {"data": {"type": "subscriptionGroupLocalizations",
                    "id": l["id"], "attributes": {"name": ad}}}, f"grup {loc}: «{ad}»")
            else:
                yaz("POST", "/subscriptionGroupLocalizations", {"data": {"type": "subscriptionGroupLocalizations",
                    "attributes": {"locale": loc, "name": ad},
                    "relationships": {"subscriptionGroup": {"data": {"type": "subscriptionGroups", "id": g["id"]}}}}},
                    f"grup {loc} ekleniyor: «{ad}»")
    ulkeler = None
    for s in [i for i in inc if i["type"] == "subscriptions"]:
        pid = s["attributes"]["productId"]
        mevcut = {l["attributes"]["locale"]: l for l in hepsi(f"/subscriptions/{s['id']}/subscriptionLocalizations?limit=50")[0]}
        for loc, (ad, aciklama) in ab.get("urunler", {}).get(pid, {}).items():
            if len(ad) > 30 or len(aciklama) > 55:
                raise HataAPI(0, f"{pid} {loc}: ad ≤30, açıklama ≤55 karakter olmalı")
            istenen = {"name": ad, "description": aciklama}
            l = mevcut.get(loc)
            if l:
                d = fark(l["attributes"], istenen)
                if d:
                    yaz("PATCH", f"/subscriptionLocalizations/{l['id']}", {"data": {"type": "subscriptionLocalizations",
                        "id": l["id"], "attributes": d}}, f"{pid} {loc}: {d}")
            else:
                yaz("POST", "/subscriptionLocalizations", {"data": {"type": "subscriptionLocalizations",
                    "attributes": {"locale": loc, **istenen},
                    "relationships": {"subscription": {"data": {"type": "subscriptions", "id": s["id"]}}}}},
                    f"{pid} {loc} ekleniyor: «{ad}» / «{aciklama}»")
        av = yoksa_none(f"/subscriptions/{s['id']}/subscriptionAvailability")
        if not (av and av.get("data")) and ay.get("ulkeler"):
            ulkeler = ulkeler or satis_ulkeleri(ay)
            yaz("POST", "/subscriptionAvailabilities", {"data": {"type": "subscriptionAvailabilities",
                "attributes": {"availableInNewTerritories": ay["ulkeler"].get("yeniUlkeler", True)},
                "relationships": {"subscription": {"data": {"type": "subscriptions", "id": s["id"]}},
                                  "availableTerritories": {"data": [{"type": "territories", "id": t} for t in ulkeler]}}}},
                f"{pid}: {len(ulkeler)} ülkede satışa açılıyor")
    print("  (fiyat ve ücretsiz deneme App Store Connect'te; incelemeye gönderme elle)")


def gonder(ay, klasor):
    mt = metinler(ay)
    for loc, m in mt.items():
        print(f"{loc}: " + ", ".join(f"{k} {len(v)}/{SINIR[k]}" for k, v in m.items()))
    app = uygulama(ay)
    bolum("Uygulama", gonder_uygulama, app, ay)
    bolum("Uygulama bilgisi (ad, alt başlık, gizlilik adresi, kategori, yaş)", gonder_bilgi, app, ay, mt)
    v = bolum("Sürüm", gonder_surum, app, ay)
    if v:
        bolum("Build", gonder_build, app, v)
        bolum("Sürüm metinleri (açıklama, anahtar kelimeler, tanıtım, adresler)", gonder_surum_metinleri, v, ay, mt)
        bolum("Ekran görüntüleri", gonder_ekranlar, v, ay, klasor)
    elif KURU:
        print("\n(sürüm henüz yok: metinler ve görüntüler sürüm açıldıktan sonra yazılır)")
    bolum("Ülkeler", gonder_ulkeler, app, ay)
    bolum("Fiyat", gonder_fiyat, app, ay)
    bolum("Abonelikler (dil metinleri, ülkeler)", gonder_abonelik, app, ay)


if __name__ == "__main__":
    islem = sys.argv[1] if len(sys.argv) > 1 else ""
    klasor = sys.argv[sys.argv.index("--ekran") + 1] if "--ekran" in sys.argv else None
    if islem == "denetle":          # yalnızca magaza/ dosyaları (anahtar gerekmez)
        for loc, m in metinler(ayarlar()).items():
            print(f"{loc}: " + ", ".join(f"{k} {len(v)}/{SINIR[k]}" for k, v in m.items()))
    elif islem == "oku":
        oku(ayarlar())
    elif islem in ("kuru", "gonder"):
        KURU = islem == "kuru"
        gonder(ayarlar(), klasor)
    else:
        sys.exit(__doc__)
    if HATALAR:
        sys.exit("\n" + "\n".join(HATALAR))

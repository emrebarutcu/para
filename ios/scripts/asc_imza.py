#!/usr/bin/env python3
"""Geçici App Store imzası (TestFlight iş akışı): App Store Connect API ile bir dağıtım sertifikası ve App Store profili
oluşturur, iş bitince ikisini de siler. Özel anahtar bu makinede üretilir: uygulama codesign ile elle imzalanır.

Neden elle: dağıtım sertifikasının adı hesap sahibinin adıdır ("Apple Distribution: Emre Barutçu"). Xcode'un imzası
gereksinimine (designated requirement) bu adı ayrışmış Unicode ile ("c" + birleşen çengel) yazar, sertifikadaki ad ise
birleşik "ç"dir: imza kendi gereksinimini karşılamaz, App Store Connect ITMS-90035 ile reddeder. Elle imzada gereksinim
addan değil takım kimliğinden (subject.OU) kurulur.
Uygulamalar App Store / TestFlight'ta Apple'ın imzasıyla dağıtıldığı için sertifikanın silinmesi yüklenen build'i etkilemez.

  asc_imza.py olustur <çıktı klasörü>   → anahtar.pem, sertifika.cer, profil.mobileprovision; GITHUB_ENV'e CERT_SHA1, id'ler
  asc_imza.py sil <sertifika id> <profil id>

Ortam: KEY_ID, ISSUER_ID, KEY_PATH (.p8), BUNDLE_ID. Gerekli paketler: pyjwt, cryptography.
"""
import base64, json, os, sys, time, urllib.error, urllib.request

import jwt
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

API = "https://api.appstoreconnect.apple.com/v1"


def token():
    key = open(os.environ["KEY_PATH"]).read()
    now = int(time.time())
    return jwt.encode({"iss": os.environ["ISSUER_ID"], "iat": now, "exp": now + 900, "aud": "appstoreconnect-v1"},
                      key, algorithm="ES256", headers={"kid": os.environ["KEY_ID"], "typ": "JWT"})


def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            text = res.read().decode()
            return json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        sys.exit(f"App Store Connect {method} {path}: {e.code} {e.read().decode()[:800]}")


def env(name, value):
    with open(os.environ["GITHUB_ENV"], "a") as f:
        f.write(f"{name}={value}\n")


def olustur(out):
    os.makedirs(out, exist_ok=True)
    bundle = os.environ["BUNDLE_ID"]
    ids = [x for x in call("GET", f"/bundleIds?filter[identifier]={bundle}&limit=50")["data"]
           if x["attributes"]["identifier"] == bundle]
    if not ids:
        sys.exit(f"{bundle} App ID'si yok: developer.apple.com → Identifiers'ta kaydet (SETUP.md → TestFlight)")

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    csr = (x509.CertificateSigningRequestBuilder()
           .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "CashFollow CI")]))
           .sign(key, hashes.SHA256()))
    cert = call("POST", "/certificates", {"data": {"type": "certificates", "attributes": {
        "certificateType": "DISTRIBUTION", "csrContent": csr.public_bytes(serialization.Encoding.PEM).decode()}}})["data"]
    env("CERT_ID", cert["id"])   # hata olursa da silinsin
    der = base64.b64decode(cert["attributes"]["certificateContent"])
    c = x509.load_der_x509_certificate(der)
    name = c.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value

    profile = call("POST", "/profiles", {"data": {"type": "profiles",
        "attributes": {"name": f"CashFollow CI {os.environ.get('GITHUB_RUN_ID', int(time.time()))}", "profileType": "IOS_APP_STORE"},
        "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": ids[0]["id"]}},
                          "certificates": {"data": [{"type": "certificates", "id": cert["id"]}]}}}})["data"]
    env("PROFILE_ID", profile["id"])
    with open(os.path.join(out, "profil.mobileprovision"), "wb") as f:
        f.write(base64.b64decode(profile["attributes"]["profileContent"]))

    with open(os.path.join(out, "anahtar.pem"), "wb") as f:
        f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL,
                                  serialization.NoEncryption()))
    with open(os.path.join(out, "sertifika.cer"), "wb") as f:
        f.write(der)
    env("CERT_SHA1", c.fingerprint(hashes.SHA1()).hex().upper())
    print(f"Sertifika: {name} ({cert['id']}), profil: {profile['attributes']['name']}")


def sil(cert_id, profile_id):
    if profile_id:
        call("DELETE", f"/profiles/{profile_id}")
    if cert_id:
        call("DELETE", f"/certificates/{cert_id}")
    print("Geçici sertifika ve profil silindi")


if __name__ == "__main__":
    if sys.argv[1:2] == ["olustur"]:
        olustur(sys.argv[2])
    elif sys.argv[1:2] == ["sil"]:
        sil(*(sys.argv[2:4] + ["", ""])[:2])
    else:
        sys.exit(__doc__)

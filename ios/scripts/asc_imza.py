#!/usr/bin/env python3
"""Geçici App Store imzası (TestFlight iş akışı): App Store Connect API ile bir dağıtım sertifikası ve App Store profili
oluşturur, iş bitince ikisini de siler.

Neden: Xcode'un bulutta yönetilen dağıtım sertifikasının adı hesap sahibinin adıdır ("Apple Distribution: Emre Barutçu").
codesign imzanın gereksinimine (designated requirement) bu adı ayrışmış Unicode ile ("c" + birleşen çengel) yazar,
sertifikadaki ad ise birleşik "ç"dir: imza kendi gereksinimini karşılamaz, App Store Connect ITMS-90035 ile reddeder.
API ile oluşturulan sertifikanın adı ASCII'dir ("Apple Distribution: Created via API (TAKIM)").
Uygulamalar App Store / TestFlight'ta Apple'ın imzasıyla dağıtıldığı için sertifikanın silinmesi yüklenen build'i etkilemez.

  asc_imza.py olustur <çıktı klasörü>   → sertifika.p12, profil.mobileprovision; GITHUB_ENV'e kimlik, profil, id'ler
  asc_imza.py sil <sertifika id> <profil id>

Ortam: KEY_ID, ISSUER_ID, KEY_PATH (.p8), BUNDLE_ID. Gerekli paketler: pyjwt, cryptography.
"""
import base64, json, os, secrets, sys, time, urllib.error, urllib.request

import jwt
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
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
    if not name.isascii():
        print(f"::warning::Sertifika adı ASCII değil: {name}")

    profile = call("POST", "/profiles", {"data": {"type": "profiles",
        "attributes": {"name": f"CashFollow CI {os.environ.get('GITHUB_RUN_ID', int(time.time()))}", "profileType": "IOS_APP_STORE"},
        "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": ids[0]["id"]}},
                          "certificates": {"data": [{"type": "certificates", "id": cert["id"]}]}}}})["data"]
    env("PROFILE_ID", profile["id"])
    with open(os.path.join(out, "profil.mobileprovision"), "wb") as f:
        f.write(base64.b64decode(profile["attributes"]["profileContent"]))

    # macOS'un security import'u eski PKCS#12 şifrelemesini en güvenilir okur (3DES, SHA-1 MAC)
    password = secrets.token_hex(16)
    enc = (serialization.PrivateFormat.PKCS12.encryption_builder().kdf_rounds(50000)
           .key_cert_algorithm(pkcs12.PBES.PBESv1SHA1And3KeyTripleDESCBC).hmac_hash(hashes.SHA1())
           .build(password.encode()))
    with open(os.path.join(out, "sertifika.p12"), "wb") as f:
        f.write(pkcs12.serialize_key_and_certificates(b"CashFollow CI", key, c, None, enc))
    print(f"::add-mask::{password}")
    env("P12_PASSWORD", password)
    env("SIGN_IDENTITY", name)
    env("PROFILE_NAME", profile["attributes"]["name"])
    env("PROFILE_UUID", profile["attributes"]["uuid"])
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

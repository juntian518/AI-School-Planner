Import("env")
import certifi
import re
import ssl
import tempfile
from pathlib import Path

# Keep a bounded trust store for Vercel (Google Trust Services / Let's Encrypt).
# A full Mozilla PEM store exhausts the ESP32 internal TLS heap.
allowed = {"GTS Root R1", "GTS Root R2", "GTS Root R3", "GTS Root R4", "ISRG Root X1", "ISRG Root X2", "GlobalSign Root CA"}
pem = Path(certifi.where()).read_text(encoding="ascii")
selected = []
with tempfile.TemporaryDirectory() as directory:
    path = Path(directory) / "certificate.pem"
    for block in re.findall(r"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----", pem, re.S):
        path.write_text(block, encoding="ascii")
        decoded = ssl._ssl._test_decode_cert(str(path))
        names = {value for group in decoded["subject"] for key, value in group if key == "commonName"}
        if names & allowed:
            selected.append(block)
if not selected:
    raise RuntimeError("Required trusted roots missing from certifi")
out = Path(env.subst("$PROJECT_DIR")) / "include" / "ca_bundle.h"
out.write_text('#pragma once\nstatic const char ROOT_CA[] PROGMEM = R"PEM(' + '\n'.join(selected) + '\n)PEM";\n', encoding="ascii")
print("Embedded trusted roots: " + str(len(selected)))

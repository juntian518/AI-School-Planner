Import("env")
import certifi
from pathlib import Path
pem = Path(certifi.where()).read_text(encoding="ascii")
out = Path(env.subst("$PROJECT_DIR")) / "include" / "ca_bundle.h"
out.write_text('#pragma once\nstatic const char ROOT_CA[] PROGMEM = R"PEM(' + pem + ')PEM";\n', encoding="ascii")

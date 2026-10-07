"""Windows fallback for unavailable PlatformIO mirrors; fetch verified Espressif tools."""
from pathlib import Path
import hashlib, io, json, urllib.request, zipfile
ROOT = Path(__file__).resolve().parents[2]
index = json.load(urllib.request.urlopen("https://espressif.github.io/arduino-esp32/package_esp32_index.json", timeout=30))
specs = [
    ("xtensa-esp32s3-elf-gcc", "esp-12.2.0_20230208", "toolchain-xtensa-esp32s3", "12.2.0+20230208", "toolchain-s3-local"),
    ("xtensa-esp-elf-gdb", "11.2_20220823", "tool-xtensa-esp-elf-gdb", "11.2.0", "xtensa-esp-elf-gdb"),
    ("riscv32-esp-elf-gdb", "11.2_20220823", "tool-riscv32-esp-elf-gdb", "11.2.0", "riscv32-esp-elf-gdb"),
]
for tool, version, name, package_version, directory in specs:
    entry = next(t for t in index["packages"][0]["tools"] if t["name"] == tool and t["version"] == version)
    artifact = next(s for s in entry["systems"] if s["host"] == "x86_64-mingw32")
    data = urllib.request.urlopen(artifact["url"], timeout=60).read()
    if hashlib.sha256(data).hexdigest() != artifact["checksum"].split(":")[1]:
        raise RuntimeError("Checksum mismatch: " + name)
    target = (ROOT / "private" / directory).resolve()
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for member in archive.namelist():
            if not (target / member).resolve().is_relative_to(target):
                raise RuntimeError("Unexpected archive path")
        archive.extractall(target)
        folder = target / archive.namelist()[0].split("/")[0]
    (folder / "package.json").write_text(json.dumps({"name": name, "version": package_version, "system": ["windows_amd64"]}))
    print("Verified and prepared", name)

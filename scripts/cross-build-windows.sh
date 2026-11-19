#!/usr/bin/env bash
# Cross-compile Leafor.exe for Windows (x86_64-pc-windows-gnu) on Ubuntu 24.04 without
# downloading Microsoft SDKs: uses Ubuntu's rustc-1.89 + rust-1.89-src + MinGW and -Zbuild-std.
# Prereqs: sudo apt install mingw-w64 rustc-1.89 cargo-1.89 rust-1.89-src ; pnpm install
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=/opt/rust-1.89-src/library
if [ ! -d "$SRC" ]; then
  # Ubuntu prunes std's Windows-only dependency; restore it in a private copy.
  sudo mkdir -p /opt/rust-1.89-src && sudo cp -a /usr/src/rustc-1.89.0/library /opt/rust-1.89-src/ && sudo chown -R "$(id -u)" /opt/rust-1.89-src
  python3 - "$SRC/std/Cargo.toml" <<'PY'
import sys; p=sys.argv[1]; s=open(p).read()
s=s.replace("[dev-dependencies]","[target.'cfg(windows)'.dependencies.windows-targets]\npath = \"../windows_targets\"\n\n[dev-dependencies]",1)
s=s.replace("windows_raw_dylib = []","windows_raw_dylib = [\"windows-targets/windows_raw_dylib\"]")
open(p,'w').write(s)
PY
fi
CRT=/opt/rust-1.89-src/crt
if [ ! -f "$CRT/rsbegin.o" ]; then
  mkdir -p "$CRT"
  for f in rsbegin rsend; do RUSTC_BOOTSTRAP=1 rustc-1.89 --target x86_64-pc-windows-gnu --emit=obj -o "$CRT/$f.o" "$SRC/rtstartup/$f.rs" -C panic=abort -C opt-level=3 --crate-type=lib; done
fi
pnpm build
export RUSTC=rustc-1.89 RUSTC_BOOTSTRAP=1 __CARGO_TESTS_ONLY_SRC_ROOT="$SRC"
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUSTFLAGS="-L $CRT"
(cd src-tauri && cargo-1.89 build --release -Zbuild-std=std,panic_abort --target x86_64-pc-windows-gnu --features tauri/custom-protocol --ignore-rust-version)
OUT=release/Leafor; mkdir -p "$OUT"
cp src-tauri/target/x86_64-pc-windows-gnu/release/leafor.exe "$OUT/Leafor.exe"
cp src-tauri/target/x86_64-pc-windows-gnu/release/WebView2Loader.dll "$OUT/"
echo "Built $OUT/Leafor.exe"

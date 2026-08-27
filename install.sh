#!/usr/bin/env bash
# install.sh — Linux / macOS: deja `lampson` disponible en el PATH (symlink en ~/.local/bin).
# Requisitos: synsema (https://synsema.com — `synsema update`), bash, git; opcional: ss o lsof para ver puertos.
# (La instalación unix está escrita con cuidado pero NO probada todavía; el harness se desarrolló en Windows.)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
chmod +x "$here/lampson.sh"
mkdir -p "$HOME/.local/bin"
ln -sf "$here/lampson.sh" "$HOME/.local/bin/lampson"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "agregá a tu shell: export PATH=\"\$HOME/.local/bin:\$PATH\"" ;; esac
command -v synsema >/dev/null || echo "falta synsema en el PATH: instalalo primero"
[ -f "$here/.env" ] || { cp "$here/.env.example" "$here/.env"; echo "creado $here/.env — poné LAMPSON_PROVIDER y LAMPSON_API_KEY"; }
echo "listo: cd /tu/proyecto && lampson   (o lampson --web)"

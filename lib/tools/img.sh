#!/usr/bin/env bash
# img.sh — imágenes para el REPL (Linux/macOS). Imprime UNA línea: media_type|ancho|alto|base64
#   bash lib/tools/img.sh clip          # portapapeles: wl-paste, xclip o pbpaste (macOS)
#   bash lib/tools/img.sh file <ruta>
# Sin redimensionar (no asumimos ImageMagick); ancho/alto en 0 si no hay `identify`.
set -euo pipefail
mode="$1"; tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
if [ "$mode" = "clip" ]; then
    if command -v wl-paste >/dev/null 2>&1; then wl-paste -t image/png > "$tmp" 2>/dev/null || true
    elif command -v xclip >/dev/null 2>&1; then xclip -selection clipboard -t image/png -o > "$tmp" 2>/dev/null || true
    elif command -v osascript >/dev/null 2>&1; then osascript -e 'set f to POSIX file "'"$tmp"'"' -e 'try' -e 'set d to the clipboard as «class PNGf»' -e 'set o to open for access f with write permission' -e 'write d to o' -e 'close access o' -e 'end try' >/dev/null 2>&1 || true
    fi
    [ -s "$tmp" ] || { echo "ERROR|no hay una imagen en el portapapeles"; exit 0; }
    type="image/png"
else
    [ -f "$2" ] || { echo "ERROR|no existe $2"; exit 0; }
    cp "$2" "$tmp"
    case "${2,,}" in *.jpg|*.jpeg) type="image/jpeg";; *.gif) type="image/gif";; *.webp) type="image/webp";; *) type="image/png";; esac
fi
w=0; h=0
if command -v identify >/dev/null 2>&1; then read -r w h < <(identify -format "%w %h" "$tmp[0]" 2>/dev/null || echo "0 0"); fi
echo "$type|$w|$h|$(base64 < "$tmp" | tr -d '\n')"

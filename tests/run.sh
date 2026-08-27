#!/usr/bin/env bash
# tests/run.sh — corre los tests unitarios sobre un workspace DESCARTABLE (ver tests/run.ps1).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mount="$here/workspace"
tmp="${TMPDIR:-/tmp}/lampson-test-workspace"

previous=""
if [ -e "$mount" ]; then
    [ -L "$mount" ] || { echo "./workspace existe y no es un symlink; movelo antes de correr los tests" >&2; exit 1; }
    previous="$(readlink -f "$mount")"; rm -f "$mount"
fi
rm -rf "$tmp"; mkdir -p "$tmp"; : > "$tmp/.lampson-test-workspace"
ln -s "$tmp" "$mount"
restore() { rm -f "$mount"; [ -n "$previous" ] && [ -d "$previous" ] && ln -s "$previous" "$mount"; true; }
trap restore EXIT

cd "$here"
LAMPSON_WORKSPACE="$tmp" synsema test unit.test.syn

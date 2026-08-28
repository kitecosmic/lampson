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
restore() {
    rm -rf "$here"/memory/lampson-test-workspace-* "$here"/.lampson/sessions/test-*.json "$here"/.lampson/proc/t_demo.*
    rm -f "$mount"; [ -n "$previous" ] && [ -d "$previous" ] && ln -s "$previous" "$mount"; true
}
trap restore EXIT

cd "$here"
LAMPSON_WORKSPACE="$tmp" synsema test unit.test.syn
code=$?
# procesos gestionados: supervisor-agente + proc_spawn — corre con `run` (el swarm no existe bajo `test`)
LAMPSON_WORKSPACE="$tmp" synsema run proc_test.syn || code=1
exit "${code:-0}"

#!/usr/bin/env bash
# install.sh — Lampson one-line installer for Linux / macOS
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/kitecosmic/lampson/main/install.sh)"
#
# What it does: installs synsema if missing, clones or updates Lampson into $LAMPSON_HOME
# (default: ~/lampson), symlinks `lampson` into ~/.local/bin, creates .env (asks for provider + API key
# when run interactively). Re-running updates in place.
set -euo pipefail
HOME_DIR="${LAMPSON_HOME:-$HOME/lampson}"
REPO="https://github.com/kitecosmic/lampson.git"
say() { printf '  %s\n' "$*"; }
echo; say "Lampson installer"

for t in git bash curl; do command -v "$t" >/dev/null || { say "missing '$t' — install it and re-run"; exit 1; }; done

if ! command -v synsema >/dev/null; then
    say "installing synsema…"
    curl -fsSL https://synsema.com/install.sh | sh
    export PATH="$HOME/.local/bin:$HOME/.synsema/bin:$PATH"
    command -v synsema >/dev/null || { say "synsema installed but not on PATH yet — open a new shell and re-run"; exit 1; }
fi
say "synsema $(synsema --version | sed 's/Synsema //')"

if [ -d "$HOME_DIR/.git" ]; then
    say "updating $HOME_DIR"; git -C "$HOME_DIR" pull -q --ff-only
else
    say "cloning into $HOME_DIR"; git clone -q "$REPO" "$HOME_DIR"
fi
chmod +x "$HOME_DIR/lampson.sh"
mkdir -p "$HOME/.local/bin"
ln -sf "$HOME_DIR/lampson.sh" "$HOME/.local/bin/lampson"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) say "add to your shell profile:  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;; esac

ENVF="$HOME_DIR/.env"
if [ ! -f "$ENVF" ]; then
    cp "$HOME_DIR/.env.example" "$ENVF"
    if [ -t 0 ]; then
        echo; say "Which provider? (deepseek | anthropic | openai | glm | minimax | kimi | groq | grok | openrouter | ollama)"
        read -r -p "  provider [deepseek]: " prov; prov="${prov:-deepseek}"
        read -r -p "  API key (leave empty to fill .env later): " key
        sed -i.bak "s/^LAMPSON_PROVIDER=.*/LAMPSON_PROVIDER=$prov/" "$ENVF"
        [ -n "$key" ] && sed -i.bak "s|^LAMPSON_API_KEY=.*|LAMPSON_API_KEY=$key|" "$ENVF"
        rm -f "$ENVF.bak"
    else
        say "created $ENVF — set LAMPSON_PROVIDER and LAMPSON_API_KEY"
    fi
fi
echo; say "done. In a new shell:"; say "cd /path/to/your/project && lampson        (or: lampson --web)"; echo

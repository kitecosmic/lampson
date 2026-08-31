# install.ps1 — Lampson one-line installer for Windows
#
#   irm https://raw.githubusercontent.com/kitecosmic/lampson/main/install.ps1 | iex
#
# What it does: installs synsema if missing, installs Git for Windows if missing (asks first), clones
# or updates Lampson into $env:LAMPSON_HOME (default: ~\lampson), adds it to your user PATH, creates
# .env (asks for provider + API key when run interactively). Re-running updates in place.
$ErrorActionPreference = "Stop"
$Home_ = $env:LAMPSON_HOME; if (-not $Home_) { $Home_ = Join-Path $HOME "lampson" }
$Repo = "https://github.com/kitecosmic/lampson.git"
function Say($m) { Write-Host "  $m" }
Write-Host ""
Write-Host "  Lampson installer" -ForegroundColor Cyan

# 1. git (and Git Bash, which the tools use)
$gitBash = "C:\Program Files\Git\bin\bash.exe"
if (-not (Get-Command git -ErrorAction SilentlyContinue) -or -not (Test-Path $gitBash)) {
    Say "Git for Windows is required (it provides git and bash)."
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        $ans = Read-Host "  install it now with winget? [Y/n]"
        if ($ans -eq "" -or $ans -match '^[yYsS]') { winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements | Out-Null } else { throw "install Git for Windows from https://gitforwindows.org and re-run" }
        $env:Path = "$env:Path;C:\Program Files\Git\cmd"
    } else { throw "install Git for Windows from https://gitforwindows.org and re-run" }
}

# 2. synsema
if (-not (Get-Command synsema -ErrorAction SilentlyContinue)) {
    Say "installing synsema…"
    Invoke-Expression (Invoke-RestMethod https://synsema.com/install.ps1)
    $env:Path = "$env:Path;$env:LOCALAPPDATA\Synsema"
    if (-not (Get-Command synsema -ErrorAction SilentlyContinue)) { throw "synsema was installed but is not on PATH yet — open a new terminal and re-run this installer" }
}
Say ("synsema " + ((synsema --version) -replace 'Synsema ', ''))

# 3. clone or update
if (Test-Path (Join-Path $Home_ ".git")) {
    Say "updating $Home_"
    git -C $Home_ pull -q --ff-only
} else {
    Say "cloning into $Home_"
    git clone -q $Repo $Home_
}

# 4. PATH
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not (($userPath -split ";") -contains $Home_)) {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$Home_", "User")
    Say "added to user PATH"
}
$env:Path = "$env:Path;$Home_"

# 5. .env
$envFile = Join-Path $Home_ ".env"
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $Home_ ".env.example") $envFile
    if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
        Write-Host ""
        Say "Which provider? (deepseek | anthropic | openai | glm | minimax | kimi | groq | grok | openrouter | ollama)"
        $prov = Read-Host "  provider [deepseek]"; if ($prov -eq "") { $prov = "deepseek" }
        $key = Read-Host "  API key (leave empty to fill .env later)"
        $c = Get-Content $envFile -Raw
        $c = $c -replace '(?m)^LAMPSON_PROVIDER=.*$', "LAMPSON_PROVIDER=$prov"
        if ($key -ne "") { $c = $c -replace '(?m)^LAMPSON_API_KEY=.*$', "LAMPSON_API_KEY=$key" }
        Set-Content $envFile $c -NoNewline
    } else { Say "created $envFile — set LAMPSON_PROVIDER and LAMPSON_API_KEY" }
}

Write-Host ""
Write-Host "  done. Open a NEW terminal, then:" -ForegroundColor Green
Say "cd C:\path\to\your\project"
Say "lampson            (terminal)   |   lampson --web   (http://127.0.0.1:8080)"
Write-Host ""

#!/usr/bin/env node
// bin/lampson.js — entry point of the npm package (`npm i -g lampson`).
//
// The code ships inside node_modules, but Lampson keeps STATE next to its code: the mounted `workspace`
// junction, `.lampson/` (config, sessions, traces, spill), `memory/` and global `lamps/`. Living inside
// node_modules would lose all of that on every `npm i -g lampson@latest`. So this launcher keeps a stable
// home (LAMPSON_HOME, default ~/lampson), syncs the package's code files into it when the version changes,
// and runs the same launcher the git install uses (lampson.ps1 / lampson.sh). Everything else — synsema on
// the PATH (it is a dependency of this package), the workspace mount, the terminal/web modes — is identical.
//
// If LAMPSON_HOME already holds a git checkout (the curl/irm installer), it is used as is and nothing is
// copied: `lampson --update` there still means `git pull`.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const pkgDir = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
const home = process.env.LAMPSON_HOME || path.join(os.homedir(), 'lampson');
const marker = path.join(home, '.npm-installed');

// what gets copied into the home: the runtime, never state. Keep in sync with "files" in package.json.
const CODE = ['lib', 'public', 'skills', 'chat.syn', 'web.syn', 'lampson.ps1', 'lampson.sh', 'lampson.cmd', '.env.example', 'README.md', 'LICENSE'];

// copia un archivo; en unix, los scripts de shell y los .syn salen con LF aunque el paquete se haya armado
// en Windows (un CRLF en lampson.sh rompe bash: "set: pipefail\r: invalid option")
function copyFile(s, d) {
  if (process.platform !== 'win32' && /\.(sh|syn)$/.test(s)) fs.writeFileSync(d, fs.readFileSync(s, 'utf8').replace(/\r\n/g, '\n'), { mode: /\.sh$/.test(s) ? 0o755 : 0o644 });
  else fs.copyFileSync(s, d);
}
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else copyFile(s, d);
  }
}

function sync() {
  const isGit = fs.existsSync(path.join(home, '.git'));
  if (isGit) return 'git';
  let installed = '';
  try { installed = fs.readFileSync(marker, 'utf8').trim(); } catch (e) { /* first run */ }
  if (installed === pkg.version && fs.existsSync(path.join(home, 'chat.syn'))) return 'ok';
  fs.mkdirSync(home, { recursive: true });
  for (const item of CODE) {
    const src = path.join(pkgDir, item);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(home, item);
    if (fs.statSync(src).isDirectory()) { fs.rmSync(dst, { recursive: true, force: true }); copyDir(src, dst); }
    else copyFile(src, dst);
  }
  // global lamps are user content: seed the example once, never overwrite what the user put there
  const lampsSrc = path.join(pkgDir, 'lamps'), lampsDst = path.join(home, 'lamps');
  if (fs.existsSync(lampsSrc)) {
    for (const e of fs.readdirSync(lampsSrc, { withFileTypes: true })) {
      if (e.isDirectory() && !fs.existsSync(path.join(lampsDst, e.name))) copyDir(path.join(lampsSrc, e.name), path.join(lampsDst, e.name));
    }
  }
  fs.writeFileSync(marker, pkg.version + '\n');
  return installed ? 'updated' : 'installed';
}

const args = process.argv.slice(2);
if (args.some(a => /^--?(version|v)$/i.test(a))) { console.log('lampson ' + pkg.version); process.exit(0); }

let state;
try { state = sync(); } catch (e) { console.error('lampson: could not prepare ' + home + ': ' + e.message); process.exit(1); }
if (state === 'installed') console.log('lampson ' + pkg.version + ' → ' + home + ' (your config, sessions and lamps live there)');
if (state === 'updated') console.log('lampson updated to ' + pkg.version + ' in ' + home);

// --update under npm: the code comes from the registry, not from git
if (args.some(a => /^--?(update|u)$/i.test(a)) && state !== 'git') {
  console.log('installed with npm — update with:  npm i -g lampson@latest');
  process.exit(0);
}

let r;
if (process.platform === 'win32') {
  const shell = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { stdio: 'ignore' }).status === 0 ? 'pwsh' : 'powershell';
  r = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(home, 'lampson.ps1'), ...args], { stdio: 'inherit', cwd: process.cwd() });
} else {
  r = spawnSync('bash', [path.join(home, 'lampson.sh'), ...args], { stdio: 'inherit', cwd: process.cwd() });
}
process.exit(r.status == null ? 1 : r.status);

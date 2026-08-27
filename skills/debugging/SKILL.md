---
name: debugging
description: How to write and run throwaway scripts (sh, js/mjs/ts, py…) in the scratch dir to test, reproduce or probe something in the project — before touching real code. Load when a task needs an experiment, a repro, or a quick check of an API/library/function.
---

# Debugging with scratch scripts

You have a scratch directory inside the workspace: **`.lampson/scratch/`** (create it with `write`;
it is ignored by lampson's file tree and must never be committed — add `.lampson/` to the project's
`.gitignore` if it is a git repo and it is not there yet).

Use it to *prove* things instead of guessing:

- **Reproduce a bug** in isolation: `write .lampson/scratch/repro.mjs` that imports the real module
  (`import { f } from '../../src/lib/x.js'`) and calls it with the failing input; run with
  `bash: node .lampson/scratch/repro.mjs`. Paths in the script are relative to the workspace root
  because `bash` runs there.
- **Probe an API or a running server**: `curl -s -i http://127.0.0.1:3000/api/x` (start the server with
  the `process` tool first, then read its log with `process(logs)` after the request).
- **Check a library's behavior** before relying on it: a 5-line script beats reading docs from memory.
- **Try a data transformation** on real data: dump a sample to `.lampson/scratch/sample.json`, iterate.
- **Run one test in isolation** (`npx vitest run path -t "name"`, `pytest path::test -x`, etc.).

Pick the runtime the project already uses (look at `package.json`, `pyproject.toml`, `go.mod`,
`Cargo.toml`…): `node x.mjs` / `npx tsx x.ts` / `python x.py` / `bash x.sh` / `go run x.go` /
`synsema run x.syn`. TypeScript: prefer `npx tsx` (no build step); if it is not installed, write `.mjs`.

Rules:
1. Scripts print **evidence** (values, status codes, timings) — not just "ok". Compare expected vs actual.
2. Keep them small and single-purpose; name them by intent (`repro-login-401.mjs`, `probe-db.py`).
3. Never import secrets into a script; read config the same way the project does.
4. When done, say what the script proved. Delete scripts that are pure noise; keep repros that document a bug.
5. Anything long-running (a server you start to probe) goes through the `process` tool, never in the foreground.

---
name: synsema
description: Writing, checking, running and testing Synsema (.syn) code — syntax reflexes, capabilities, and the runtime traps that cost hours. Load before touching any .syn file.
---

# Synsema quick reference (v0.6.7)

## Dev loop
- `synsema check file.syn` (parse + validates every `use` import) · `synsema run file.syn` ·
  `synsema test file.syn` (runs `test "..."` blocks) · `synsema serve file.syn` (HTTP server).
- Errors carry `file:line` and a suggestion. Read them; they are usually right.

## Syntax reflexes (Python → Synsema)
- `let x be 5` / `set x to 6` (no `=`) · `-- comment` · `when / otherwise when / otherwise` (no colons)
- `each x in xs` (lists only; maps → `each k in keys(m)`) · `while c` · `task f(x)` … `give v`
- `nothing / true / false` · backtick strings interpolate: `` `n={n}` `` (double-quoted do NOT)
- `try` … `recover err` (recover SWALLOWS; `raise(err)` to re-throw) · `raise("msg")`
- `contains(xs, x)` (on maps checks KEYS) · `append(xs, x)` returns a NEW list → `set xs to append(xs, x)`
- `apply(f, xs)`, `where(xs, p)`, `sort_by(xs, f)`, `slice(xs, a, b)`, `split/join/trim/lower/upper`
- `json_encode / json_decode` · `length` · `text(x)` · `number(s)` (ALWAYS float → `floor()` for ints)
- Modules: `use "./m.syn" as m` (local only, never `../`), `export task/let`. A module cannot have
  top-level `require` or `serve` — the ENTRY file grants capabilities.

## Capabilities (deny-by-default)
- Declare at the top: `require net("host")`, `require file("dir")` + `require file("dir/*")`,
  `require exec`, `require env("X_*")`, `require secret("KEY")`, `require serve(8080)`, `require time`.
- A task's own top-of-body `require` lines are what `call_tool(task, args_map)` intersects
  (least-privilege). Plain calls run with the program's ambient capabilities.
- `sandbox` blocks strip everything. `secret("K")` is opaque: pass it as a header, never print it.

## Traps verified on this machine (do not fight them)
- `file("./*")` behaves like `"*"` (whole disk). Use a named dir scope: `file("workspace/*")`.
- `http_post(url, MAP)` sends `text(map)`, not JSON → `http_post(url, json_encode(body), {"Content-Type": "application/json"})`.
- Responses have `status, ok, body, headers` — no `json` key → `json_decode(body of r)`; on network error: `status 0` + `error`.
- `localhost` resolves to IPv6; use `127.0.0.1`.
- `run("bash", ...)` hangs on Windows (WSL bash) → `C:\Program Files\Git\bin\bash.exe` or `cmd /c`.
- A task named `run` shadows the builtin `run` (infinite recursion).
- Reserved words that break variable/param names: `reason task ask stop decide analyze generate show approve confirm`.
- `and`/`or` do NOT short-circuit → nest `when` before indexing.
- No `merge`: add a key with `set m["k"] to v`. No `append_file`: read + write (atomic).
- Under `serve`: resolve `secret()` inside the handler; define tasks before `serve on`; `send` only inside `stream`.
- `.env` values override shell-exported ones if set there.

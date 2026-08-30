---
name: synsema
description: Writing, checking, running and testing Synsema (.syn) code — syntax reflexes, capabilities, live processes / pseudo-terminals, and the runtime traps that cost hours. Load before touching any .syn file.
---

# Synsema quick reference (v0.6.13)

> Curated 10 KB summary for the agent (the full reference is ~450 KB and lives in the user's editor
> skill). Kept in sync by hand with each `synsema update`; if `synsema --version` is newer than the
> version above, trust the runtime's error messages over this file.

## Dev loop
- `synsema check file.syn` (parse + validates every `use` import) · `synsema run file.syn` ·
  `synsema test file.syn` (runs `test "..."` blocks) · `synsema serve file.syn` (HTTP server) ·
  `synsema update` (self-update; then refresh the AI skill with the command it prints).
- Errors carry `file:line` and a suggestion. Read them; they are usually right.
- **Read the repo without opening files (v0.6.13+)**: `synsema code outline` (project map: intent,
  symbols, imports per file), `routes [path]` (the table each `serve` publishes: method, path, auth,
  stream/socket/proxy, response kind, capabilities), `refs <name>` (every use, through module aliases),
  `symbol <name>`, `caps` (declared vs. effective vs. `missing`, with the `require` to add), `check`,
  `search <text>`, `deps`. Add `--json` for scripts. Same eight tools over MCP: `synsema code --mcp`
  (server `synsema-code`, static — it never talks to a running server). `outline` before opening a
  `.syn`, `refs` before renaming, `check` after every edit.

## Syntax reflexes (Python → Synsema)
- `let x be 5` / `set x to 6` (no `=`) · `-- comment` · `when / otherwise when / otherwise` (no colons)
- `each x in xs` (lists only; maps → `each k in keys(m)`) · `while c` · `task f(x)` … `give v`
- `nothing / true / false` · backtick strings interpolate: `` `n={n}` `` (double-quoted do NOT)
- `try` … `recover err` (recover SWALLOWS; `raise(err)` to re-throw) · `raise("msg")`
- `contains(xs, x)` (on maps checks KEYS) · `append(xs, x)` returns a NEW list → `set xs to append(xs, x)`
- `apply(f, xs)`, `where(xs, p)`, `sort_by(xs, f)`, `slice(xs, a, b)`, `split/join/trim/lower/upper`
- Text/regex: `replace_text(t, old, new)` (literal), `replace_re(t, re, rep)` (`\1` backrefs), `capture(t, re)`
  (first match; with groups → list), `find_all`, `matches` (**full match** only — not a search).
  There is NO `replace`, `regex_replace`, `chars`, `repeat`. Rust regex: no lookahead/lookbehind.
  In `"..."` strings backslashes are literal: write `"\d"`, `"\*"` (`"\\d"` is a literal `\d`).
  Anonymous functions: `(x) => expr` only (no inline `task(x)`).
- `json_encode / json_decode` · `length` · `text(x)` · `number(s)` (ALWAYS float → `floor()` for ints)
- Modules: `use "./m.syn" as m` (local only, never `../`), `export task/let`. A module cannot have
  top-level `require` or `serve` — the ENTRY file grants capabilities.

## Capabilities (deny-by-default)
- Declare at the top: `require net("host")`, `require file("dir")` + `require file("dir/*")`,
  `require exec`, `require env("X_*")`, `require secret("KEY")`, `require serve(8080)`, `require time`.
- A task's own top-of-body `require` lines are what `call_tool(task, args_map)` intersects
  (least-privilege). Plain calls run with the program's ambient capabilities.
- `sandbox` blocks strip everything. `secret("K")` is opaque: pass it as a header, never print it.

## Processes
- `run(cmd, [args], timeout?, {cwd, env, stdin})` → `{exit_code, stdout, stderr}`; captures everything,
  returns at the end; non-zero exit is DATA (only timeout / can't-launch raise).
- Live process (v0.6.7+): `let p be proc_spawn(cmd, [args], {cwd})` then `proc_recv(p, secs)` →
  `{type: "stdout"|"stderr"|"exit", data}` or `nothing`; `proc_send(p, text)`, `proc_kill(p)`, `proc_close(p)`.
  `select({"a": handle, "b": handle}, secs)` waits on processes, sockets and bus at once (`ev["name"]`).
- **Pseudo-terminal (v0.6.8+)**: `proc_spawn(cmd, args, {"pty": true, "cols": 120, "rows": 40})` for
  y/N prompts, passwords, REPLs, TUIs. One `stdout` stream of TEXT chunks with ANSI (never split inside a UTF-8 char);
  `strip_ansi(text)` shows what a human sees; keys go with `proc_send` (Enter = `"\r"`, Ctrl-C = `bytes([3])`);
  `proc_resize(p, cols, rows)`. Web terminal = `socket` route + pty in one `select` (xterm.js renders).
- **Tree kill (v0.6.9+)**: `proc_kill`/`proc_close` reach the WHOLE process tree (Job Object on Windows,
  process group on unix) — `sh -c "npm run dev"` takes its `node` with it; `proc_stats(p)["tree"]` confirms.
  `{"process_group": false}` deliberately detaches a daemon. A grandchild holding the pipe cannot hang you (1 s grace).
- Every live process dies with its interpreter — **under `serve` that means the END OF THE REQUEST**: a
  `proc_spawn` in a handler is gone when the handler returns. A process that must outlive requests lives
  inside an `agent` spawned from the handler (own lifecycle; blackboard `share/observe` + `bus_*` are shared
  with handlers). That is how lampson's `process` tool works (`lib/tools/proc.syn`).
- **Reverse proxy streams (v0.6.12+)**: `proxy to "http://127.0.0.1:N"` passes SSE in real time and tunnels
  `Upgrade: websocket`; needs `require net("<upstream host>")`; `GET /*path` does not match `/`. **Cron expressions
  (v0.6.12+)**: `cron_every("0 9 * * mon-fri", task, {"tz": "-03:00"})` — fixed offset, no DST, no persistence.
- **Own terminal / raw keys (v0.6.11+)**: `let h be term_open({"ctrl_c": "exit"})` → `nothing` without a
  TTY / under `test`/`serve` (fall back to `read_line`); `term_recv(h, secs)` → `{type: "key", key, text,
  ctrl, alt, shift}` (`key` = `"char"|"enter"|"tab"|"backspace"|"up"|…`), `paste`, `resize`, `eof`;
  draw with `term_write(h, ansi)` (**`print` stays buffered**); `term_size(h)`; `term_close(h)`. Alt+Enter
  always arrives (Shift+Enter needs kitty protocol). `ask/approve` still work while open. Lampson's line
  editor is `lib/line.syn`; drive a terminal UI in tests via `proc_spawn(…, {pty: true})` (`tty_test.syn`).
- **File watch (v0.6.9+)**: `let w be watch("src", {"interval": 0.2, "ignore": ["*.tmp"]})` → events
  `{type: "create"|"modify"|"delete", path, is_dir}` via `watch_recv(w, secs)` or `select`; polling with a
  snapshot (latency = interval), `watch_close(w)`. Gate: `file("src")` + `file("src/*")`.

## Traps verified on this machine (do not fight them)
- Agents: an `agent` body sees ONLY its `spawn X with a = …` parameters, the builtins and the TOP-LEVEL
  tasks of the entry program — not the module's `let` constants, tasks nor `c.*` imports ("Undefined
  variable"); a task passed through `spawn` arrives as text. Each agent needs its OWN `require` lines.
  `stop` only inside loops. `synsema run`/`test` join agents at the end: a `while true` supervisor must be
  told to stop (bus/signal). (≤ 0.6.9 `test` had no swarm; v0.6.10+ runs agents for real in `test`.)
- `;` between statements is a lexer error (one statement per line).
- `file("./*")` behaves like `"*"` (whole disk). Use a named dir scope: `file("workspace/*")`.
- `http_post(url, MAP)` sends `text(map)`, not JSON → `http_post(url, json_encode(body), {"Content-Type": "application/json"})`.
- Responses have `status, ok, body, headers` — no `json` key → `json_decode(body of r)`; on network error: `status 0` + `error`.
- `localhost` resolves to IPv6; use `127.0.0.1`.
- `run("bash", ...)` hangs on Windows (WSL bash) → `C:\Program Files\Git\bin\bash.exe` or `cmd /c`.
- A task named `run` shadows the builtin `run` (infinite recursion).
- Reserved words that break variable/param names: `reason task ask stop type run decide analyze generate show approve confirm`.
- Reading a MISSING map key is a runtime error (`Map has no key 'x'`), not `nothing` → `contains(m, "x")` first.
- Maps are passed by reference: `set m["k"] to v` inside a task IS visible to the caller (lists via `append` are not — it returns a new list).
- `and`/`or` do NOT short-circuit → nest `when` before indexing.
- No `merge`: add a key with `set m["k"] to v`. No `append_file`: read + write (atomic; parents created).
- Runtime error messages are Capitalized (`Not a directory: …`) and `contains` is case-sensitive → compare `lower(text(err))`.
- Under `serve`: resolve `secret()` inside the handler; define tasks before `serve on`; `send` only inside `stream`.
- `.env` values override shell-exported ones if set there.

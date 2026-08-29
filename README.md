# Lampson

**A coding agent harness written in [Synsema](https://synsema.com).** You point it at a project; it
reads, searches, edits and runs commands through tools that are confined to that project by the
language itself — and every step is visible, in the terminal or in a web UI.

- **Terminal or web**: `lampson` (REPL) or `lampson --web` (http://127.0.0.1:8080).
- **Any OpenAI- or Anthropic-compatible API** over raw HTTP: DeepSeek, Kimi, Groq, Grok, OpenRouter,
  Ollama, Anthropic, MiniMax… one `.env` line to switch.
- **Least-privilege by construction**: each tool declares its capabilities; the runtime enforces
  them. File tools can only touch the mounted workspace (absolute paths, `..`, sibling dirs → denied).
- **Permissions you control**: `ask` (approve dangerous commands, in the terminal or with a button in
  the web UI), `yolo`, `strict`. Destructive system commands are always blocked.
- **Agents**: `build` (edits), `plan` (read-only), `review` (runs tests, never edits), `explore`,
  `worker` (scoped implementation). **Sub-agents**: `delegate` runs several of them *in parallel*
  (real threads) with their own context and a restricted toolset, or in the *background* — the report
  lands in the parent's inbox when it finishes; every child has a live log (`/agents`, web panel).
- **Managed processes**: the agent starts servers with `process`, and the new log lines of every
  server are appended to each command result — it *sees its own console*. Live logs in the web UI.
- **Skills**: Markdown procedures the model loads on demand (yours in `workspace/skills/`).
- **MCP servers**: global (`lampson/.lampson/mcp.json` — one config, every project you open) or per
  project (`.lampson/mcp.json` in the repo), same JSON as Claude Code / Cursor. Their tools join the
  model's catalog as `mcp_<server>_<tool>`; calling one asks you first (yolo allows, strict denies).
- **LSP**: the agent navigates code through the project's language servers — `lsp symbols` gives a
  file's structure without reading it, `definition`/`references`/`hover` resolve what grep leaves
  ambiguous. Nothing is bundled: `/lsp add typescript|python|rust|go|css|html` (or your own command),
  global or per project; each server starts on its first query.
- **Lamps** (tool plugins): a folder with a `lamp.json` manifest plus code — a Synsema program that runs
  under a capability ceiling, or any executable (js, py, sh…). Global in `lampson/lamps/<name>/`, per
  project in `.lampson/lamps/<name>/` (the agent can write those). **Off by default**: you turn them on
  from the top bar of the web UI or `/lamps on <name>`; their tools join the catalog as `lamp_<lamp>_<tool>`.
- **Project memory**: the agent keeps its own notes per project (`memory/<project>/*.md`, outside
  the repo) — how to run it, gotchas, decisions — and rereads them in the next session. You can read
  and edit them (web panel, `/memory`).
- **`!command`**: run something yourself from the chat inside a real pseudo-terminal (prompts, passwords
  and REPLs work); the output lands in the agent's context.
- **Terminal in the browser**: the web UI opens a real shell (pty, cwd = your project) in the center pane
  — `>_ terminal` in the header. Synsema 0.6.8+.
- **Local only**: the web API (chat with tools, terminal, process control) answers loopback clients
  only; anything else gets 401. To let a script in from elsewhere, set `LAMPSON_WEB_TOKEN` in `.env`
  and send `Authorization: Bearer <token>`.
- **Sessions** persisted as JSON, including every tool call, result, error and denial — plus a
  human-readable **trace** per session (`.lampson/trace/<id>.log`: one line per step, tool call,
  result, error, denial, with elapsed time and tokens) to see where the agent does well or badly:
  `/trace [n]` in the terminal, `≡` next to a session in the web UI, or `tail -f` the file.

## Install

With npm (brings `synsema` along as a dependency):

```sh
npm i -g lampson
cd /path/to/your/project
lampson            # terminal
lampson --web      # http://127.0.0.1:8080
```

The package keeps your config, sessions, memory and global lamps in `~/lampson` (`LAMPSON_HOME` to change
it) and refreshes the code there whenever you `npm i -g lampson@latest`. On Windows it needs PowerShell
(pwsh or the built-in one) and Git for Windows (its bash is what the `bash` tool uses).

Or the git-based installer — same result, `lampson --update` then means `git pull`. One line. It installs `synsema` if missing, puts Lampson in `~/lampson`, adds it to your PATH and
asks for your provider + API key.

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/kitecosmic/lampson/main/install.ps1 | iex
```

**Linux / macOS**

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kitecosmic/lampson/main/install.sh)"
```

Then, in a new terminal:

```bash
cd /path/to/your/project
lampson            # terminal
lampson --web      # http://127.0.0.1:8080
```

**First run**: Lampson asks for a provider, a model and its API key — a short wizard in the terminal, a
welcome window in the web UI. That goes to `lampson/.lampson/config.json` (local, gitignored) and is
shared by both UIs. Change it any time: `/setup` or `/provider <name> [model]` in the terminal, or click
the `provider · model` pill in the web header (one key per provider is kept, so switching is instant).
`.env` still works for the same settings (`LAMPSON_PROVIDER`, `LAMPSON_API_KEY`, `LAMPSON_API_KEY_<PROVIDER>`).

**Images**: paste (Ctrl+V) or drop images into the web composer; they are downscaled in the browser
(≤ 1568 px) and sent inline. In the terminal, `/paste` attaches the image on the clipboard (copy a
screenshot first) and `/image <path>` a file; they go with your next message (`📎2 ❯`). If the current model does not declare image input, you are warned before
sending and the model receives a text note instead of a 400. The table is `supports_vision` in
`lib/provider.syn` (anthropic, minimax, gpt-4o/4.1/5, o-series, groq llama-4, and models named
`*vision*`/`*vl*` on openrouter/ollama/kimi/grok); set `"vision": true` in `config.json` to override
it for a model Lampson does not know — or `false` to force the text note.

**Updating**: Lampson checks `origin/main` on start and tells you when a newer version exists (terminal
banner, web header button). Run `lampson --update` (or `/update` in the REPL, or the web button) and
restart. Re-running the installer does the same. `LAMPSON_HOME` changes the install folder.
Requirements the installer handles for you: `synsema`, `git` (on Windows, Git for Windows also
provides the bash the tools use — the installer offers to install it with winget). Linux: the
`synsema` binary needs glibc ≥ 2.39 (Ubuntu 24.04+, Debian 13+, Fedora 40+).

**Docker** (the `bash` tool is then confined by the container too)

```bash
docker run --rm -p 8080:8080 -v "$PWD:/lampson/workspace" \
  -e LAMPSON_PROVIDER=deepseek -e LAMPSON_API_KEY=sk-... ghcr.io/kitecosmic/lampson
```

Or from a clone: `docker build -t lampson .` and use `lampson` as the image. `docker-compose.yml`
does the same with persistent sessions and memory.

> Status: developed and tested on Windows 11; the Docker image (Ubuntu 24.04) is built by CI. The Linux/macOS
> installer is written but not yet exercised on a real machine — issues welcome.

## Use

```bash
cd /path/to/your/project
lampson                     # terminal REPL; the current directory becomes the workspace
lampson --web               # web UI at http://127.0.0.1:8080
lampson --agent plan        # start in plan (read-only) mode
lampson --yolo              # never ask for dangerous commands (--strict: deny them; --ask: default)
lampson --workspace /other  # pick a project without cd
lampson --help
```

In the REPL, `/` lists every command (`/agent`, `/ask` `/yolo` `/strict`, `/model`, `/config`,
`/files`, `/procs`, `/logs <name>`, `/stop <name>`, `/kill <pid>`, `/skills`, `/sessions`,
`/resume <id>`, `/tokens`, `/flags`). `!cmd` runs a command yourself.

The prompt is a real line editor (Synsema ≥ 0.6.11, falls back to plain `read_line` without a TTY):
typing `/` opens the command menu (recent ones first, filtered as you type), `Tab` completes the
command and then its arguments (files for `/image`, sessions, providers, processes, lamps, MCP/LSP
servers, flags), `↑↓` browse history or the menu, `Alt+Enter` inserts a newline, `Ctrl+O` shows the
last tool result in full, `Ctrl+U`/`Ctrl+W` clear the line/word, `Esc` closes the menu. Approvals are
an arrow-key menu (`permitir`/`denegar`, or `p`/`d`).

The terminal renders the model's markdown (headings, lists, tables, code fences) and shows every tool
result: `edit`/`write` print a line diff (`- red / + green`, line numbers, 2 lines of context); other
tools are collapsed to 15 lines. `/out [n]` prints the n-th last result of the turn in full and
`/verbose` toggles full output for every tool (saved in `.lampson/config.json`).

The project is mounted as `lampson/workspace` (an NTFS junction on Windows, a symlink elsewhere)
and every tool declares `file("workspace/*")` — that literal, named scope is what makes the
confinement real. Config, sessions and process logs live in the `lampson` folder, never in your project.

### Providers

| `LAMPSON_PROVIDER` | wire | endpoint |
|---|---|---|
| `openai` `deepseek` `kimi` `groq` `grok` `openrouter` `ollama` | OpenAI | `{base_url}/chat/completions` |
| `anthropic` `minimax` | Anthropic | `{base_url}/messages` |

Any compatible endpoint: set `LAMPSON_BASE_URL` (and `LAMPSON_WIRE` if the preset can't guess).
Model names are normalized to lowercase for providers whose APIs are case-sensitive (DeepSeek, OpenAI,
Anthropic, Groq, Kimi, Grok, OpenRouter — `DeepSeek-V4-Pro` would be a 400); MiniMax and Ollama keep
theirs. `/model` with no argument (or the model window in the web UI) lists what the provider's API
actually offers (`GET /models`), so you never type a name blind.
The API key is a Synsema `secret()`: the program can pass it as a header but never read or print it.
See `.env.example` for every knob (steps, token budget, compaction threshold, shell).

### Permissions

| level | examples | ask | yolo | strict |
|---|---|---|---|---|
| hardline | `rm -rf /`, formatting disks, fork bombs, force-push to main | blocked | blocked | blocked |
| dangerous | recursive deletes, `git reset --hard`, `sudo`, `curl \| sh`, `DROP TABLE`, writing `.env` | **asks you** | allowed | blocked |
| everything else | read, edit, tests, `git status`… | allowed | allowed | allowed |

Change the mode with the web selector, `/ask` `/yolo` `/strict`, or the launch flags — `.env` only
sets the default. The `bash` child process itself is not confined by Synsema; for a public deployment,
run Lampson in a container.

## Architecture

```
lampson.ps1 / .sh    launcher: mounts ./workspace, starts terminal or web
chat.syn             terminal REPL (colors, approvals via Synsema's native `approve`)
web.syn              HTTP server: POST /api/chat → SSE events; sessions, tree, file viewer, processes, ports
public/index.html    web UI (no build step, no dependencies)
lib/
  provider.syn       config from .env · chat(cfg, messages, catalog) · retry with backoff
  loop.syn           run_turn(): LLM → tool calls → permissions → call_tool → results → repeat; doom-loop guard; compaction
  tools.syn          tool registry (allow-list) + JSON-Schema catalog + per-profile subsets
  tools/<x>.syn      one tool per file: read write edit ls find grep bash process skill
  tools/common.sh    shared shell helpers (kill process trees on Windows/unix)
  tools/proc.sh        ports, command line of a pid, kill a foreign pid tree (the managed processes are native)
  agents.syn         profiles (build / plan / review / explore / worker) + `delegate` (sub-agents: batch, background, inbox, steer/stop)
  permission.syn     evaluate(tool, args, mode) → allow | deny | ask
  prompt.syn         system prompt (rules, tools, environment, skills index, AGENTS.md of the project)
  skills.syn         SKILL.md index (harness / project / local)
  session.syn        .lampson/sessions/<id>.json
  tree.syn · git.syn workspace tree, git status
skills/              built-in skills: lampson (how the harness works), synsema, debugging
tests/mock_llm.syn   scripted fake LLM (both wires) for end-to-end runs without an API key
unit.test.syn        unit tests — run them with tests/run.ps1 · tests/run.sh (throwaway workspace)
```

### The loop

```
while steps < max_steps and tokens <= budget
    r = provider.chat(cfg, messages, catalog)        -- last step: no tools → forces a final answer
    messages += assistant(r.text, r.tool_calls)
    if no tool_calls → return
    for each call:
        doom loop (3× identical) → error back to the model
    50% of the token budget → nudge (stop exploring, act); 90% → final answer without tools
        permission.evaluate → deny | ask | allow
        out = call_tool(registry[name], args)          -- least-privilege; errors go back as text
        messages += tool(id, out)                      -- everything is kept, including failures
```

### MCP servers

`lib/mcp.syn` is a stdio MCP client. Config, in the format you already have elsewhere:

```json
{"mcpServers": {"github": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"],
                           "env": {"GITHUB_TOKEN": "…"}}}}
```

- `lampson/.lampson/mcp.json` is **global**: lampson is installed once, so a server declared there is
  available in every repo you open. `workspace/.lampson/mcp.json` is per project (a server with the same
  name overrides the global one). `"disabled": true` keeps an entry without starting it; `"cwd"` defaults
  to the workspace.
- Each server runs inside a supervisor `agent` (like managed processes): `initialize` → `tools/list`,
  then requests travel over the bus (`mcp.req.<server>` / `mcp.res.<server>.<id>`). State on the
  blackboard (`mcp:<server>`), status in `/mcp` and the web sidebar; a server that dies shows `error`.
- Tools appear to the model as `mcp_<server>_<tool>` with the server's JSON Schema. `build`/`worker` see
  all of them; `plan`/`review`/`explore` only those marked `readOnlyHint`. Every call goes through
  `permission.syn`: **ask** by default, allow in yolo, deny in strict — and lands in the session trace.
- Not yet: HTTP/SSE transports, resources/prompts, sampling.

### LSP (language servers)

`lib/lsp.syn`, same shape as the MCP client (deepseek-harness `packages/lsp` was the reference: the harness
installs nothing, the user declares a server per language, it starts lazily, and the model gets a closed
set of operations — no raw JSON-RPC). Config:

```json
{"servers": {"typescript": {"command": "npx", "args": ["--yes", "typescript-language-server", "--stdio"],
                            "languages": {".ts": "typescript", ".tsx": "typescriptreact"}}}}
```

- `lampson/.lampson/lsp.json` is global, `workspace/.lampson/lsp.json` per project. Presets (`/lsp add
  <name>`, or the sidebar): typescript, python (pyright), rust (rust-analyzer), go (gopls), css, html.
  `cwd` defaults to the workspace; `env` and `"disabled": true` as in MCP. On Windows a bare `npx`/`npm`
  command is retried as `.cmd`. The typescript preset needs `typescript` in the project's `node_modules`
  (any TS project has it) — verified against a real `typescript-language-server` via `npx`.
- One supervisor `agent` per server; stdio with `Content-Length` framing (`line_mode: false`, byte-exact
  cut); server→client requests (`workspace/configuration`, `client/registerCapability`…) are answered with
  `null`, notifications (diagnostics) ignored. `rootUri` is the real project path (`LAMPSON_WORKSPACE`),
  results come back relative to it (case-insensitive on Windows, `%3A` decoded).
- Tool `lsp(op, path, line, character)` — `symbols` (hierarchical outline with line ranges), `definition`,
  `references` (declaration included), `implementation`, `hover`. Each query opens the document
  transiently (`didOpen` → request → `didClose`), positions are 1-based like the editor. Read-only: allowed
  in every mode and profile. Test: `lsp_test.syn` against `tests/mock_lsp.js`.

### Lamps (tool plugins)

`lib/lamps.syn`. Synsema has no dynamic `use` (on purpose: no supply chain inside the process), so a lamp
never loads into lampson — every call is **one child process that ends**, the "safe runner" pattern from
the Synsema sandbox docs. `lamps/<name>/lamp.json`:

```json
{"name": "hello", "description": "greets", "kind": "syn", "entry": "lamp.syn",
 "caps": "file.read=workspace/*", "timeout": 60,
 "tools": [{"name": "greet", "description": "…", "parameters": {"type": "object", "properties": {"who": {"type": "string"}}}, "readonly": true}]}
```

- `kind: "syn"` runs `synsema run --cap-set stdout,time,env=LAMP_*[,caps] <entry>`: the ceiling is the
  manifest you approved when you turned it on; a `require` above it in the lamp's code fails with
  *above the host ceiling* — nothing escalates from inside. `kind: "exec"` runs `"command"` as is (no
  language ceiling — which is why enabling is always a human decision).
- The tool call travels by env: `LAMP_TOOL`, `LAMP_ARGS` (JSON), `LAMP_DIR`, `LAMP_WORKSPACE`; the lamp
  prints its result to stdout. Exit ≠ 0 or timeout → `ERROR:` for the model.
- Discovery: `lamps/` (global) and `workspace/.lampson/lamps/` (project; same name overrides). State in
  `.lampson/lamps.json` — **off by default**. On/off: web top bar, `/lamps on|off <name>`, or the model's
  `lamp(action=enable)` which always asks. Lamp tools: ask by default, allow in yolo, deny in strict;
  `readonly` ones also reach `plan`/`review`/`explore`. Example: `lamps/example-hello/`.
- The agent can build lamps itself: `lamp(action=create, name, manifest, files)` writes a project lamp,
  validates the manifest and runs `synsema check` on a syn entry — define-and-validate only, like dsh's
  `cordis_define`; turning it on is still yours (`cordis_run`'s approval, here `enable` → ask).

### Keeping the model aware of what it did

Borrowed from the harness that does each part best (see `notes/*.md`):

| Problem | Mechanism | From |
|---|---|---|
| A huge tool result floods the context | **Spill**: results over 10k chars are saved whole to `.lampson/spill/<call>.txt`; the model sees head + tail + the path (`read` is exempt, it pages) | deepseek |
| Old results are re-sent with every call | **Receipts**: before each model call, tool results beyond the last 40k tokens become one line — `[bash result pruned: exit code 0 · 412 lines/18k chars · Full result saved to …]` | hermes / opencode |
| Same call, same args, again and again | **Repeat reminder**: 3rd and 5th identical call (canonical JSON) still run but carry a reminder; the 8th is refused | deepseek / opencode |
| Budget runs out silently | 80 %: a notice appended to the latest tool result (no new user message, cache stays warm); 95 %: last step without tools, summary required | hermes / opencode |
| Edits a file it never read, or one that changed | **Observation gate in code**: `read` records the file hash; `edit`/`write` on an existing file are rejected without it, or if the file changed since | deepseek |
| Loses the plan | `todo` tool (whole-list replacement, one `in_progress` at a time, scoped to the session like the three references); re-injected only after context compaction, active items only | hermes, opencode |
| Reads the whole project before touching anything | **Exploration cap** (ours): after 8 read-only calls in a row (read/ls/find/grep) without an edit/write/command the result carries a warning; after 16 they are refused until it acts (`LAMPSON_EXPLORE_CAP`) | — |

### Sub-agents

`delegate(tasks=[{agent, brief, context}…], background?)` — or `action=list|steer|stop|result`.

- **Batch, in parallel**: each task runs `loop.run_turn` in its own thread (`parallel_map`, 4 at a time,
  max 6 per call) with a fresh history, the profile's toolset and *no* `delegate` (depth 1). The parent
  gets one consolidated report; every child writes `.lampson/agents/<id>.log` (tail it) and `<id>.json`.
- **Background**: returns the ids at once; the child runs inside a Synsema `agent` (own interpreter) and
  its report enters the parent's **inbox**: `loop.run_turn` checks `opts.inbox_fn` before every model call
  and appends pending reports as new `user` messages (never mutating past context — prefix cache intact);
  in the terminal an idle parent gets an automatic turn (max 3 in a row, reset by real input).
  `steer` = text the child reads before its next step; `stop` = cut and return the partial report.
- **Permissions**: a child never asks the user — it runs `strict` (dangerous → denied with the reason;
  it reports the limitation) or `yolo` if `LAMPSON_PERMISSION=yolo`. Reports are self-reports: the
  prompt tells the parent to verify (read the file, run the test) before claiming success.
- **History**: finished sub-agents are pruned (older than 30 min, or beyond the last 10) whenever a new one
  is delegated or the list is shown; the test suite cleans its own.
- **Live UI**: `GET /api/events` is an SSE stream fed by the Synsema bus — process supervisors publish every
  log line and status change (`proc.<name>`), sub-agents their start/steps/end (`subagent.*`) — so the web
  panels and open logs refresh on events, not on timers (timers stay only as a slow fallback).
- Runtime detail: a Synsema `agent` only sees its spawn parameters, the builtins and the *top-level* tasks
  of the entry program, so `chat.syn`/`web.syn` define `task lampson_subagent(spec)` as the child's door.

### Adding a tool

`lib/tools/<name>.syn` exporting `task tool(...)` (its `require` lines at the top of the body) and
`let SPEC` (JSON Schema); register it in `lib/tools.syn` and in the profiles of `lib/agents.syn`.
`synsema check chat.syn` validates the whole graph. There is deliberately no dynamic loading: the
allow-list is a file you can read.

### Skills

A folder with `SKILL.md` (`name:` + `description:` front matter) — the [Agent Skills](https://agentskills.io)
format, so anything published on [skills.sh](https://skills.sh) works as-is. The system prompt carries only
the index; the content enters the context when the model calls `skill(name)`. Search order (later wins):
`~/.agents/skills`, `~/.claude/skills` (global) < `skills/` (harness) < `.claude/skills`, `.agents/skills`,
`skills/` of the project < `.lampson/skills/` of the project (local, not committed).

**Installing external skills** — the agent can do it for you: ask *"install the frontend-design skill from
anthropics/skills"* and it calls `skill(action=install, source, name, scope=global|project)`, which runs the
standard installer below. Installing is **always human-in-the-loop** (it asks even in yolo mode; strict denies
it) because it brings third-party instructions and scripts onto your machine. Global (default) means
`~/.agents/skills`: a Go skill installed once serves every Go project. Or do it yourself:

```bash
npx skills add anthropics/skills --skill frontend-design      # → ./.agents/skills (this project)
npx skills add anthropics/skills --skill frontend-design -g   # → ~/.agents/skills (every project)
npx skills list · npx skills update · npx skills remove
```

The home folders are mounted as junctions/symlinks under `.lampson/skills-global` and
`.lampson/skills-claude` by `lampson.ps1` / `lampson.sh` (a capability cannot point at a dynamic path).

### Testing without an API key

```bash
synsema serve tests/mock_llm.syn
LAMPSON_PROVIDER=openai LAMPSON_WIRE=openai LAMPSON_BASE_URL=http://127.0.0.1:8765/v1 LAMPSON_API_KEY=x lampson
tests/run.sh          # Windows: .\tests\run.ps1
```

The unit tests write into `workspace/`, so the runner mounts a temporary folder for them and
restores your project afterwards; `unit.test.syn` refuses to run on anything else.

## Synsema runtime notes (v0.6.7)

Things that cost time and are handled in the code:

- `file("./*")` behaves like `"*"` (whole disk); `file("dir/*")` confines — hence the `workspace` mount.
- `http_post` with a map body sends `text(map)`, not JSON → always `json_encode` + `Content-Type`.
- Responses expose `status, ok, body, headers` (no `json`); on network error `status 0` + `error`.
- `number()` returns floats → `floor()` for every integer that goes on the wire.
- `run()` hangs forever if the command leaves a descendant holding stdout (Windows inherits handles)
  and its timeout only kills the direct child → the `bash` tool and the `process` tool use `proc_spawn`
  (v0.6.9): events per line, real deadline, `proc_close` kills the whole tree (Job Object / process group).
- Under `serve`, a `proc_spawn` made in a handler dies with the request. A managed process therefore lives
  inside an `agent` (own lifecycle: verified under `run` and `serve`): state on the blackboard
  (`proc:<name>`), stop via `bus_publish("proc.stop.<name>")`, output drained to `.lampson/proc/<name>.log`.
  Processes die with lampson (`/exit` publishes `proc.stop_all`; Ctrl-C under serve → `agent_stop`).
- Git Bash (MSYS) has two process trees: `bash -c "a && npm run dev"` execs its last command, so the
  MSYS pid shows as `cmd`/`node` (never trust the name to decide liveness — compare the WINPID), and native
  grandchildren (`npm.cmd → cmd → node`) are invisible to MSYS `ps` → `kill_tree` (foreign pids only) does
  `taskkill /T /F` per WINPID. The managed log ends with `[process exited with code N]`; `bash` refuses
  server-looking commands and points to `process`.
- `localhost` may resolve to IPv6 while `serve` listens on IPv4 → use `127.0.0.1`.
- Reserved words that bite: `reason task ask stop decide analyze generate show approve confirm`.
- `and`/`or` short-circuit only from Synsema v0.6.10 (before, `contains(m, "k") and m["k"]` exploded — the code still nests `when` for that); a task named `run` shadows the builtin (and a module task named `read`/`write` breaks `read_file`/`write_file` calls in sibling tasks); modules cannot import `../`; `split(s, "")` is an error; `slice` past the end errors.

## License

MIT — see `LICENSE`.

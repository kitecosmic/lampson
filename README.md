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
- **Agents**: `build` (edits), `plan` (read-only), `review` (runs tests, never edits), `explore`;
  `delegate` runs a sub-agent with its own context.
- **Managed processes**: the agent starts servers with `process`, and the new log lines of every
  server are appended to each command result — it *sees its own console*. Live logs in the web UI.
- **Skills**: Markdown procedures the model loads on demand (yours in `workspace/skills/`).
- **Project memory**: the agent keeps its own notes per project (`memory/<project>/*.md`, outside
  the repo) — how to run it, gotchas, decisions — and rereads them in the next session. You can read
  and edit them (web panel, `/memory`).
- **`!command`**: run something yourself from the chat; the output lands in the agent's context.
- **Sessions** persisted as JSON, including every tool call, result, error and denial.

## Install

One line. It installs `synsema` if missing, puts Lampson in `~/lampson`, adds it to your PATH and
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

The project is mounted as `lampson/workspace` (an NTFS junction on Windows, a symlink elsewhere)
and every tool declares `file("workspace/*")` — that literal, named scope is what makes the
confinement real. Config, sessions and process logs live in the `lampson` folder, never in your project.

### Providers

| `LAMPSON_PROVIDER` | wire | endpoint |
|---|---|---|
| `openai` `deepseek` `kimi` `groq` `grok` `openrouter` `ollama` | OpenAI | `{base_url}/chat/completions` |
| `anthropic` `minimax` | Anthropic | `{base_url}/messages` |

Any compatible endpoint: set `LAMPSON_BASE_URL` (and `LAMPSON_WIRE` if the preset can't guess).
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
  tools/bash_wrapper.sh / proc.sh   real timeouts, detached processes, ports
  agents.syn         profiles (build / plan / review / explore) + `delegate`
  permission.syn     evaluate(tool, args, mode) → allow | deny | ask
  prompt.syn         system prompt (rules, tools, environment, skills index, AGENTS.md of the project)
  skills.syn         SKILL.md index (harness / project / local)
  session.syn        .lampson/sessions/<id>.json
  tree.syn · git.syn workspace tree, git status
skills/              built-in skills: lampson (how the harness works), synsema, debugging
tests/mock_llm.syn   scripted fake LLM (both wires) for end-to-end runs without an API key
unit.test.syn        unit tests (`synsema test unit.test.syn`)
```

### The loop

```
while steps < max_steps and tokens <= budget
    r = provider.chat(cfg, messages, catalog)        -- last step: no tools → forces a final answer
    messages += assistant(r.text, r.tool_calls)
    if no tool_calls → return
    for each call:
        doom loop (3× identical) → error back to the model
        permission.evaluate → deny | ask | allow
        out = call_tool(registry[name], args)          -- least-privilege; errors go back as text
        messages += tool(id, out)                      -- everything is kept, including failures
```

### Adding a tool

`lib/tools/<name>.syn` exporting `task tool(...)` (its `require` lines at the top of the body) and
`let SPEC` (JSON Schema); register it in `lib/tools.syn` and in the profiles of `lib/agents.syn`.
`synsema check chat.syn` validates the whole graph. There is deliberately no dynamic loading: the
allow-list is a file you can read.

### Skills

A folder with `SKILL.md` (`name:` + `description:` front matter). The system prompt carries only the
index; the content enters the context when the model calls `skill(name)`. Search order:
`skills/` (harness) < `workspace/skills/` (project) < `workspace/.lampson/skills/` (local).

### Testing without an API key

```bash
synsema serve tests/mock_llm.syn
LAMPSON_PROVIDER=openai LAMPSON_WIRE=openai LAMPSON_BASE_URL=http://127.0.0.1:8765/v1 LAMPSON_API_KEY=x lampson
synsema test unit.test.syn
```

## Synsema runtime notes (v0.6.7)

Things that cost time and are handled in the code:

- `file("./*")` behaves like `"*"` (whole disk); `file("dir/*")` confines — hence the `workspace` mount.
- `http_post` with a map body sends `text(map)`, not JSON → always `json_encode` + `Content-Type`.
- Responses expose `status, ok, body, headers` (no `json`); on network error `status 0` + `error`.
- `number()` returns floats → `floor()` for every integer that goes on the wire.
- `run()` hangs forever if the command leaves a descendant holding stdout (Windows inherits handles);
  the timeout only kills the direct child → `bash_wrapper.sh` closes its stdout before spawning,
  returns output through a file and kills the whole process tree.
- `localhost` may resolve to IPv6 while `serve` listens on IPv4 → use `127.0.0.1`.
- Reserved words that bite: `reason task ask stop decide analyze generate show approve confirm`.
- `and`/`or` do not short-circuit; a task named `run` shadows the builtin (and a module task named `read`/`write` breaks `read_file`/`write_file` calls in sibling tasks); modules cannot import `../`; `split(s, "")` is an error; `slice` past the end errors.

## License

MIT — see `LICENSE`.

---
name: lampson
description: How this harness works — tools, workspace mount, permissions, agents, sessions. Load when asked about Lampson itself or when a tool behaves unexpectedly.
---

# Lampson (the harness you are running in)

## Where you are
- Your tools only reach `workspace/` — the user's project, mounted as a junction/symlink by
  `lampson.ps1 <path>` / `lampson.sh <path>`. All paths you pass are relative to that root.
- Anything outside (absolute paths, `..`, sibling dirs) fails with `Capability not granted`.
  That is by design (Synsema deny-by-default + `call_tool` least-privilege). Do not try to work
  around it; tell the user if you genuinely need something outside the workspace.
- `bash` runs with cwd = workspace root and a hard timeout (default 120 s): when it expires the command AND
  its child processes are killed. Never run servers/watchers/REPLs in `bash`; use the `process` tool:
  `process(start, name="web", command="npm run dev")`, then `process(logs, name="web")`, and
  `process(stop, name="web")` when done. New log lines of every managed process are appended to each
  `bash` result automatically — you SEE the server's console (errors, requests, crashes) without asking.
  The user sees the same logs live in the web UI ("Procesos" panel). Its child process is NOT confined by Synsema; dangerous
  commands are screened by `permission.syn` (hardline = always denied; dangerous = needs the user's
  approval in `ask` mode, denied in `strict`, allowed in `yolo`).

## Tool behavior worth knowing
- `edit` needs an exact, unique `old_string`; if it fails, `read` the region again and retry with
  more context. `replace_all=true` for intentional multi-replace.
- `read` returns up to 2000 lines; use `offset`/`limit` for big files. Outputs > 30k chars are truncated.
- `find` is a simple glob (`*.ts`, `test_*`, `*config*`), `grep` is regex by default (`regex=false` for literals).
- `lsp(op=symbols, path)` is the cheapest way to understand a big file: every function/class/variable
  with its line range — then `read` only the range you need. `definition` / `references` / `hover` /
  `implementation` take 1-based `line` + `character` ON the identifier. If no server is configured for
  that extension, propose `lsp(op=add, server=<preset>)` (typescript, python, rust, go, css, html) — it
  always asks the user and needs nothing installed (`npx` fetches it); `op=list` shows what is configured.
  Do not install language servers with bash yourself.
- Calling the same tool with identical args 3 times in a row is blocked (doom loop) — change approach.
- After 8 tool errors in a turn the harness asks you to stop and report.
- `delegate(tasks=[{agent, brief, context}…])` runs sub-agents (`explore` / `plan` / `review` /
  `worker`) IN PARALLEL, each with a fresh context and a restricted toolset, and returns their reports
  consolidated. `background=true` returns ids at once and each report arrives later as a message in
  your context (do not poll); `action=list|steer|stop|result` manages them. Give a self-contained
  brief — a child does not see this conversation, cannot ask the user and cannot delegate. Reports are
  self-reports: verify before claiming success. Live logs: `.lampson/agents/<id>.log`.

## Scheduled tasks (`schedule` tool)
- When the user says "every day at 9", "each 6 hours", "on Mondays", "periodically", "send me", propose
  `schedule(action=add, name, at, kind, …)`: `at` = `every 6h` | `daily 09:00` | `mon,wed 08:30` |
  `weekdays 09:00`; one-time: `today 15:14` | `tomorrow 09:00` | `once 2026-08-29 15:14` | `in 2h` (it turns itself off after running) — the USER'S LOCAL time: write the hour as they say it, never convert to UTC (the tool result shows the next run with its offset). Tasks belong to the current workspace. `kind=plugin` (a plugin that is ON: plugin + tool + args), `kind=bash` (one
  command that finishes on its own), `kind=prompt` (an unattended agent run: write a self-contained prompt —
  what to do, how to verify, what to report — and pick `agent` build/review/plan/explore).
- `permission` is the envelope of a `prompt` run with nobody watching: `strict` (dangerous → denied),
  `ask` (default: the user gets an approval request in the web UI and, if configured, a link on their
  phone; denied if unanswered within `approval_timeout`), `yolo`. Prefer `strict` or `review`/`plan` profiles
  for reports; `ask`/`build` only when the task must change things.
- `add` ALWAYS asks the user (it authorizes future runs). `notify` = a webhook URL that receives the result
  as JSON — the way to "search X and send it to me" without an MCP.
- Tasks are executed by Lampson's resident process. If `schedule(action=list)` says no scheduler is running,
  tell the user: `lampson --daemon start` (or keep `lampson --web` open). A `prompt` run's report lands in a NEW session named
  `⏰ <name>` (never in the current chat — say so); `action=log` shows the runs.

## When you need the USER to run something
The user can run any command themselves from the chat by prefixing it with `!` — e.g. `!npm run dev`,
`!cat .env`, `!git push`. Their command runs without the permission policy and its output is added to
your context automatically. In the terminal REPL, `!` runs inside a real pseudo-terminal: prompts
(`y/N`, passwords, `npm init`) work — the user answers them inline. In the web UI there is also a
**full interactive terminal** (header button `>_ terminal`, a shell with cwd = workspace, opens in the
center pane like a file). Offer these when: a command needs an interactive terminal (logins, TUIs,
watching a dev server), when something is denied for you (secrets, dangerous commands), or when they
should verify a result with their own eyes. Say exactly what to type, e.g. "run `!npm run dev` (or open
the terminal button and run `npm run dev`), then tell me the URL".

## Provider, model, keys, images
- Provider/model/API keys live in `lampson/.lampson/config.json` (local); the user changes them with
  `/setup`, `/provider`, or the `provider · model` pill in the web header. Never ask the user to paste a
  key into the chat; point them there. Keys are sealed secrets: you cannot read or print them.
- The user can paste images in the web UI, or in the terminal with `/paste` (clipboard) and
  `/image <path>`. If they say "look at this screenshot" in the terminal, tell them to copy it and type
  `/paste`, then send their message. If your model has no vision, the image arrives as a text
  note `[Image N WxHpx attached, but this model does not accept image input …]` — say so and suggest
  a vision model instead of guessing what the image shows.
- Sessions can be deleted (`/delete <id>`, or ✕ in the web sidebar).

## Workspaces
- Each project folder is a workspace with its own Lampson process; the user switches between them from the
  header pill or http://127.0.0.1:8080 (the hub). You only ever see this workspace. If the user asks to work on
  another project, tell them to open it as a workspace (hub screen, or `lampson` in that folder) — you cannot.

## Network exposure
- The web server listens on all interfaces but every `/api/*` route (and the terminal socket) only
  accepts loopback clients; others get 401 unless they present `LAMPSON_WEB_TOKEN`. If the user asks
  to use Lampson from another machine, point them to that token — never suggest removing the check.

## Agents / modes
- `build` (default): all tools. `plan`: read-only, produce a numbered plan. `review`: read + run
  tests, never edit. `explore`: read-only search. The user switches with `/agent <name>`.

## Project memory (persistent notes)
- `memory(write, name, content)` saves a Markdown note about THIS project in Lampson's `memory/<project>/`
  folder (outside the repo). The system prompt lists your notes; `memory(read, name)` loads one.
- That folder is OUTSIDE the workspace and outside the reach of read/ls/grep/bash (they are confined to the
  project): the `memory` tool is the only door. Never look for it with `ls`, never write notes with bash, and
  never store notes inside the repo (no `.lampson/notes/`). If the tool says the folder is unreachable, tell
  the user to run `lampson` again in the project (it repairs the link) — do not improvise.
- Save what you would otherwise rediscover: how to run/test, env quirks, decisions, where things live,
  root causes of bugs. Update notes instead of contradicting them. The user can read and edit them.

## Sessions and memory
- The whole history — including every tool result, error and DENIED message — is persisted in
  `.lampson/sessions/<id>.json` and resent to you each turn, so you know exactly what happened.
- When the context grows past the compaction threshold, older turns are replaced by a summary that
  keeps goals, files touched, current state, pending work and errors seen.

## Updating Lampson
- Lampson is installed as a git clone (`~/lampson`), so updating is a fast-forward pull. Both UIs
  check `origin/main` on start and show a notice when a newer version exists (terminal banner, web
  header button). The user updates with **`lampson --update`** in any terminal, `/update` in the REPL,
  or the header button in the web UI — then restarts Lampson. Re-running the installer does the same.
- If asked "how do I update Lampson?", answer exactly that. If the pull fails because of local edits
  in the lampson folder, suggest `git -C ~/lampson stash` first. (When the distribution changes —
  desktop app, single binary — this section is the place that gets rewritten.)

## Extending the harness (if the user asks you to)
- One tool = one file `lib/tools/<name>.syn` exporting `task tool(...)` (its `require` lines at the
  top of the body) and `let SPEC` (JSON Schema). Register it in `lib/tools.syn` (`use`, `registry()`,
  `CATALOG`) and in the profiles of `lib/agents.syn`. `synsema check chat.syn` validates everything.
- Providers are raw HTTP (`lib/provider.syn`): OpenAI wire (`/chat/completions`) and Anthropic wire
  (`/messages`). Config via `.env` (`LAMPSON_PROVIDER`, `LAMPSON_API_KEY`, `LAMPSON_MODEL`, `LAMPSON_BASE_URL`).
- Skills: `skills/<name>/SKILL.md` (harness), `workspace/skills/<name>/SKILL.md` (project),
  `workspace/.lampson/skills/<name>/SKILL.md` (local), plus external ones installed with `npx skills add`
  (`workspace/.agents/skills`, `workspace/.claude/skills`, and the global `~/.agents/skills` / `~/.claude/skills`
  mounted as `.lampson/skills-global` / `.lampson/skills-claude`). Frontmatter `name:` + `description:`.
  `skill(action=install, source=owner/repo, name=x, scope=global|project)` installs one (always asks the user).
- **Plugins** = tools you can create for this project without touching the harness (they were called
  "lamps" until 0.2.6 — the user may still say "lámpara"; a `.lampson/lamps/` folder still works):
  `plugin(action=create, name, manifest, files={"plugin.syn": "…"})` writes `workspace/.lampson/plugins/<name>/`,
  validates the manifest and runs `synsema check` on a syn entry (it does not run or enable anything —
  like dsh's cordis_define). Then `plugin(action=enable, name)` — the user must approve (a plugin is off until
  a human turns it on). Build one when a task needs a reusable project-specific tool. Manifest:
  `{"name", "description", "kind": "syn"|"exec", "entry": "plugin.syn" (syn) | "command": "python plugin.py" (exec),
  "caps": "file.read=workspace/*" (syn, optional extra ceiling over stdout,time,env=PLUGIN_*), "timeout": 60,
  "tools": [{"name", "description", "parameters": {JSON Schema}, "readonly": bool}]}`. Plugin names: letters,
  digits, `-` (no `_`). Each call runs the plugin as ONE child process: `synsema run --cap-set <ceiling> entry`
  for `syn`, the command for `exec`. Inside, read `PLUGIN_TOOL` and `PLUGIN_ARGS` (JSON) from env
  (`require env("PLUGIN_*")` in a .syn) and print the result to stdout. A syn plugin cannot use more than its
  manifest's `caps`; ask only for what the tool needs. Once on, its tools are `plugin_<name>_<tool>`.
  Not the same thing as a **lamp** from lamps.sh (a portable, ceiling-enforced capability unit for any MCP
  agent): if the user wants one of those, it is `lamp add <ref>` + `lamp mcp` as an MCP server, not a plugin.

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
- Calling the same tool with identical args 3 times in a row is blocked (doom loop) — change approach.
- After 8 tool errors in a turn the harness asks you to stop and report.
- `delegate(agent, brief)` runs a sub-agent (`explore` / `plan` / `review`) with a fresh context and
  returns only its report. Use it for broad searches or an independent review; give it a
  self-contained brief — it does not see this conversation.

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
- The user can paste images in the web UI. If your model has no vision, the image arrives as a text
  note `[Image N WxHpx attached, but this model does not accept image input …]` — say so and suggest
  a vision model instead of guessing what the image shows.
- Sessions can be deleted (`/delete <id>`, or ✕ in the web sidebar).

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
  `workspace/.lampson/skills/<name>/SKILL.md` (local). Frontmatter `name:` + `description:`.

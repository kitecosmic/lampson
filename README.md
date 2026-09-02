# Lampson

**A coding agent that lives in your project.** Open it inside a folder, say what you want in plain words,
and it reads, edits and runs — showing you every step and **asking before anything risky**. Terminal or
browser. Works with the model you already pay for.

```
❯ the login form doesn't show an error when the password is wrong. fix it

✓ grep "password" src/                    3 files
✓ read src/components/LoginForm.tsx       88 lines
✓ edit src/components/LoginForm.tsx       +6 −1
? bash npm test                           allow? ❯ yes  no
✓ bash npm test                           14 passed

The form now shows “Wrong email or password” when the API returns 401. Tests pass.
─── 5 steps · 12k tokens · 38s
```

## Install

```sh
npm i -g lampson
```

No Node.js? One line does it all (installs what's missing, including [Synsema](https://synsema.com)):

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/kitecosmic/lampson/main/install.ps1 | iex
```

```bash
# macOS / Linux
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kitecosmic/lampson/main/install.sh)"
```

Then, in any project:

```sh
cd path/to/your/project
lampson            # in the terminal
lampson --web      # in the browser → http://127.0.0.1:8080
```

The first time it asks which provider you use — DeepSeek, Anthropic, OpenAI, GLM (Z.ai), Kimi, Groq, OpenRouter,
Ollama (runs on your machine, no key)… — and for your API key. That's it. Change it any time with `/model`.

More ways (Docker, from source, updating): **[lampson.org/install](https://lampson.org/install)**.

## What it's for

- **Fix, build, refactor** — describe the change; it finds the files, edits them and runs your tests.
- **Understand a codebase** — `lampson --agent plan` is read-only: ask how things work, get a plan, nothing changes.
- **Review** — `/agent review` runs the tests and reads the diff, but never edits.
- **Run things while you're away** — "every weekday at 9, run the tests and tell me if something broke." If a
  scheduled run hits something risky, you get a link on your phone to approve or deny it.

It can only touch the folder you opened it in — not your home directory, not the project next door. That isn't
a setting: it's how the language it's written in works. Reading and editing just happen; deleting, installing,
`git reset`, `sudo` stop and wait for your *yes*; truly destructive commands are refused in every mode.

## Plugins

A **plugin** is a small folder that gives Lampson a new tool: query your database, call your company's API,
deploy, send a message. Any language. **Off by default** — you turn each one on, and only then can the agent
use it.

```
~/lampson/plugins/postgres/
  plugin.json        ← what it's called, what it does, which tools it offers
  query.py           ← the code
```

```json
{"name": "postgres", "description": "read-only queries on the dev database",
 "kind": "exec", "command": "python query.py",
 "tools": [{"name": "query", "description": "Run a SELECT, return rows as JSON",
            "parameters": {"type": "object", "properties": {"sql": {"type": "string"}}}, "readonly": true}]}
```

The script gets the call in environment variables (`PLUGIN_TOOL`, `PLUGIN_ARGS` as JSON) and prints the result.
Turn it on with `/plugins on postgres` or the **plugins** pill in the web UI. Keep plugins global (every project)
or inside a project (`.lampson/plugins/` — commit it and your team has it). The agent can *write* a plugin for you;
turning it on is always yours.

→ [How plugins work](https://lampson.org/docs/plugins) · the example ships in `plugins/example-hello/`.

Plugins are yours and local: any language, no sandbox unless you write them in Synsema. For tools with an
**enforced capability ceiling**, versioned and shared with any agent (Claude Code, Cursor, Lampson…), use
[lamps.sh](https://lamps.sh): `lamp add <ref>`, then `lamp mcp` as an MCP server in Lampson. (Until 0.2.6
plugins were called *lamps*; old `.lampson/lamps/` folders and `LAMP_*` variables still work for now.)

## Also in the box

Sub-agents that work in parallel · skills (`SKILL.md` procedures, anything on [skills.sh](https://skills.sh)
works) · MCP servers with the JSON you already have · language servers for real go-to-definition · project
memory it reads back next session · sessions with a readable trace of every step · paste a screenshot and ask.

## Learn more

- **[lampson.org/docs](https://lampson.org/docs)** — quickstart, permissions, providers, plugins, schedules…
- **[guide.md](guide.md)** — the long version: how it runs, architecture, every knob, runtime notes.

## License

MIT — see `LICENSE`.

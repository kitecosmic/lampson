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

No Node.js? One line does it all (installs what's missing, including [Synsema](https://synsema.org)):

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

The first time it asks which provider you use — DeepSeek, Anthropic, OpenAI, GLM (Z.ai, pay-as-you-go or Coding Plan), Kimi, Groq, OpenRouter,
Ollama (runs on your machine, no key)… — and for your API key. That's it. Change it any time with `/model`.

More ways (Docker, from source, updating): **[lampson.org/install](https://lampson.org/install)**.

## What it's for

- **Fix, build, refactor** — describe the change; it finds the files, edits them and runs your tests.
- **Understand a codebase** — `lampson --agent plan` is read-only: ask how things work, get a plan, nothing changes.
- **Review** — `/agent review` runs the tests and reads the diff, but never edits.
- **Run things while you're away** — "every weekday at 9, run the tests and tell me if something broke." If a
  scheduled run hits something risky, you get a link on your phone to approve or deny it.
- **From your phone** — install it as an app, sign in with a passkey (fingerprint or face) and work on your PC or
  your server from anywhere. A tunnel for a home PC, or `lampson --domain` for HTTPS on a VPS:
  **[lampson.org/docs/phone](https://lampson.org/docs/phone)**.

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

A plugin can also bring **instructions** (`INSTRUCTIONS.md` in its folder): how to use its tools — a backend
process, "read the `release` skill first", a long precise prompt. Lampson adds them to the prompt of every agent
that has the plugin's tools.

→ [How plugins work](https://lampson.org/docs/plugins) · the example ships in `plugins/example-hello/` · a complete
one, `plugins/orders/`, takes orders by chat end to end → [recipe](https://lampson.org/docs/orders).

Plugins are yours and local: any language, no sandbox unless you write them in Synsema. For tools with an
**enforced capability ceiling**, versioned and shared with any agent (Claude Code, Cursor, Lampson…), use
[lamps.sh](https://lamps.sh): `lamp add <ref>`, then `lamp mcp` as an MCP server in Lampson. (Until 0.2.6
plugins were called *lamps*; old `.lampson/lamps/` folders and `LAMP_*` variables still work for now.)

## Use it from your app

Lampson's agents also work **inside other software**, as an engine: a bot that answers your shop's customers, your
backend asking an agent something, another AI using your agents as a tool.

```sh
lampson key add --agent shop                     # an API key for your app (rate limit, allowed callbacks)
curl -X POST http://127.0.0.1:8080/w/<workspace>/v1/messages -H "Authorization: Bearer lk_…"      -d '{"to": "shop", "thread": "customer-42", "text": "do you have whole-wheat bread?"}'
lampson channel on telegram && lampson channel setup telegram     # a Telegram bot — even without a public URL
lampson mcp serve --agent shop                   # your agent as a tool for Claude, Cursor or another Lampson
lampson run --agent shop "hi"                    # one message from a script; --json streams every step
```

```js
import { Lampson } from "lampson";               // also: pip install lampson
const lampson = new Lampson({ local: { workspace: "./my-project" } });   // or { url, key } for a running Lampson
const r = await lampson.ask({ agent: "shop", thread: "customer-42", text: "do you have whole-wheat bread?" });

// an agent for your customers: only the tools you give it — no bash, read, write or fetch of Lampson's own
const shop = new Lampson({ agent: "shop", local: { workspace: "./my-project", lampsonTools: false } });
shop.tool("stock", { description: "Units in stock", inputSchema: z.object({ product: z.string() }),
  execute: async ({ product }, ctx) => db.stock(product, ctx.from.id) });   // your function; ctx comes from your app

// Lampson on another machine: the same tools; it POSTs each call to your endpoint, signed with the key's secret
const remote = new Lampson({ url, key, toolsUrl: "https://my-app.com/api/lampson/tools", toolsSecret });
export const POST = remote.toolsHandler();                  // Next/Hono/Bun; Express: app.post(path, remote.toolsHandler())
```

Or write the tool in Synsema — `.lampson/tools/stock.syn`, one file per tool — and its `require`s are everything it can
touch: a message that tricks the model into sending data elsewhere gets `Capability not granted`. It reads only
the variables it names with `env("NAME")` (never Lampson's own, never the folder's `.env`), and it runs only once
you approved that exact content (`lampson tools approve`, or *herramientas* in the web UI): if an agent rewrites
it, it stops until you look.

- **An agent is a file**: `.lampson/agents/shop.agent.json` (or `~/lampson/agents/` for every project) — its prompt,
  the exact tools it may use (optionally limited to some paths, with per-tool approval) and its model.
- **One conversation per customer** (`thread`), and a mailbox per conversation: a burst of messages gets one
  answer, and what arrives while the agent works joins the turn in progress.
- **Channels are plugins**: Telegram and Chatwoot (WhatsApp, Instagram, email…) ship with Lampson; anyone can write
  another with two actions, `receive` and `send`.
- **Agent ↔ agent**: put another Lampson's `/v1/mcp` URL in your `mcp.json` and your agent can ask theirs.

Docs: **[lampson.org/docs/engine](https://lampson.org/docs/engine)**. Design and status: [spec/engine.md](spec/engine.md).

## Objectives and teams

Give an agent an **objective** and it works on it by itself until it's done: it plans on its board, works in
rounds, reports, and asks you before anything irreversible (merge, push, buy, send). Or give it to a **team**: agents
with roles (CEO, CTO, Dev…), each in its own git worktree with its own branch and author, coordinating through
messages and a shared board — and nothing reaches `main` without your approval.

```sh
lampson objective add "Add task priorities with tests; ask me before merging" --team company
lampson objective list · objective show 2 · objective reply 2 --approve · objective cancel 2
lampson team list
```

Start at `http://127.0.0.1:8080/equipos`: every project's teams and objectives, everything waiting for you, and
**+ equipo** (in a project you have, or a new folder for a team that doesn't code). Each project has a full-screen
view at `/w/<project>/equipos` with the objectives, the team as a live graph, its board and its record — and the
editor to build the team.
→ **[lampson.org/docs/teams](https://lampson.org/docs/teams)**

The home page has a tab per product: **proyectos · equipos · tareas · plugins**. `/tareas` lists the scheduled tasks
of every project (switch them on or off, run one now) and `/plugins` shows what's installed and where it's on —
turning a plugin on is still decided project by project, inside the project.

## Also in the box

Sub-agents that work in parallel · skills (`SKILL.md` procedures, anything on [skills.sh](https://skills.sh)
works) · MCP servers with the JSON you already have · language servers for real go-to-definition · project
memory it reads back next session · sessions with a readable trace of every step · web pages fetched as
Markdown (a tenth of the tokens of raw HTML) · paste a screenshot and ask · computer use, opt-in: the agent
drives your desktop and browser in the background (one tab, no destructive keys) on a driver you install apart,
with an optional decision judge (Jev or local Laya) that picks the clicks in under a second.

## Learn more

- **[lampson.org/docs](https://lampson.org/docs)** — quickstart, permissions, providers, plugins, schedules…
- **[guide.md](guide.md)** — the long version: how it runs, architecture, every knob, runtime notes.

## License

MIT — see `LICENSE`.

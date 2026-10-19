// sdk/index.js — the Lampson SDK for JavaScript/TypeScript (Node 18+, no dependencies).
//
//   const { Lampson } = require("lampson");          // or: import { Lampson } from "lampson";
//
// Two ways to reach Lampson, the same methods for both:
//
//   SERVER  new Lampson({ url: "https://my-lampson.com/w/<workspace>", key: "lk_..." })
//           talks to a running Lampson (the hub, a VPS, Docker) over its HTTP API /v1. Messages go through each
//           conversation's mailbox (queue, quiet window, mid-turn messages), exactly like a channel.
//   LOCAL   new Lampson({ local: { workspace: "./my-project" } })
//           starts Lampson ITSELF as a child process on this machine (`lampson run --stdio`): no hub, no port, no
//           key. Lampson inside your program, like SQLite. Different conversations run in parallel; two messages of
//           the same conversation (agent + thread) are answered in order. `home` and `workspace` resolve against
//           process.cwd().
//           An agent that lists a tool it will not have (typo, plugin off) is reported through onWarning
//           (default console.warn) and in lampson.warnings.
//           `lampsonTools: false` → no tool of Lampson's own exists in that process (bash, read, write, fetch…),
//           not even for the built-in agents: your agents get only the tools you give them.
//           Your own tools in Synsema: one file per tool in <workspace>/.lampson/tools/ (or `tools: "./tools"`,
//           inside the workspace) — `export task <file name>(…)`, an `intent:` line and its `require`s, which are
//           all it can touch. List the name in the agent's "tools". See lampson.org/docs/sdk.
//
//   lampson.tool("order_status", { description, inputSchema, execute: async (args, ctx) => … })   local mode
//           a function of YOUR app as a tool (the AI SDK shape: zod, a JSON Schema or jsonSchema()). It runs in your
//           process; Lampson asks for it over stdio. `ctx` = {from, thread, agent, session, meta, channel} of the
//           message — set by your app, never seen or written by the model. List the name in the agent's "tools".
//           lampson.tools({ order_status: tool({...}), ... }) registers several (an AI SDK tools object as is).
//           Server mode too: new Lampson({ url, key, toolsUrl: "https://my-app/api/lampson/tools", toolsSecret })
//           sends the tools with each message; Lampson POSTs each call there, signed (RFC 9421) with the key's
//           secret, and lampson.toolsHandler() answers it: export const POST = lampson.toolsHandler().
//
//   new Lampson({ agent: "support", ... })   the agent that answers when a message does not say `agent`
//           (without it, the workspace default: "build", Lampson's coding agent, with all of Lampson's tools)
//
//   await lampson.ask({ agent: "shop", thread: "customer-42", text: "do you have whole-wheat bread?" })
//     → { agent, thread, session, text, steps, usage, stopped }      (throws LampsonError if the turn failed)
//   for await (const ev of lampson.stream({ ... })) { ... }          the agent's steps live, last one kind "done"
//   await lampson.agents()                                           [{ id, description }]
//   await lampson.close()                                            local mode: stops the child process (and its own)
//   Lampson.verifySignature(rawBody, req.headers["x-lampson-signature"], secret)   for callbacks / webhooks
//
// Contracts behind it: spec/engine.md (envelope, events), lib/api.syn (HTTP), run.syn (--stdio).
'use strict';
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const readline = require('readline');

class LampsonError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'LampsonError';
    Object.assign(this, details || {});
  }
}

// a message, in the envelope Lampson speaks (spec/engine.md): `agent` is an alias of `to`, `sentAt` of `sent_at`
function envelope(msg) {
  if (msg == null || typeof msg !== 'object') throw new TypeError('ask/stream take an object: { agent, thread, text }');
  if (typeof msg.text !== 'string' || msg.text.trim() === '') throw new TypeError('text is required');
  const env = { text: msg.text };
  const to = msg.agent || msg.to;
  if (to) env.to = to;
  for (const k of ['thread', 'session', 'images', 'meta', 'from', 'callback', 'mode']) if (msg[k] != null) env[k] = msg[k];
  if (msg.sentAt != null) env.sent_at = msg.sentAt;
  return env;
}

function failed(result) {
  return typeof result.stopped === 'string' && result.stopped.startsWith('error');
}

// ---------- server mode: HTTP API /v1 ----------

class HttpTransport {
  constructor({ url, key, fetch: fetchImpl, timeout }) {
    if (!url) throw new TypeError('url is required (e.g. "http://127.0.0.1:8080/w/<workspace>")');
    if (!key) throw new TypeError('key is required (create one with `lampson key add`)');
    this.base = String(url).replace(/\/+$/, '').replace(/\/v1$/, '');
    this.key = key;
    this.fetch = fetchImpl || globalThis.fetch;
    if (!this.fetch) throw new Error('this Node has no fetch: use Node 18+ or pass { fetch }');
    this.timeout = timeout || 15 * 60 * 1000;
  }
  headers(extra) {
    return Object.assign({ Authorization: 'Bearer ' + this.key, 'Content-Type': 'application/json' }, extra || {});
  }
  async request(method, p, body, extraHeaders) {
    const res = await this.fetch(this.base + '/v1' + p, {
      method, headers: this.headers(extraHeaders), body: body == null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });
    return res;
  }
  async json(method, p, body) {
    const res = await this.request(method, p, body);
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    if (!res.ok) throw new LampsonError((data && data.error) || ('HTTP ' + res.status), { status: res.status, body: data });
    return data;
  }
  async agents() { return (await this.json('GET', '/agents')).agents; }
  async ask(env) { return this.json('POST', '/messages', env); }
  async job(id) { return this.json('GET', '/jobs/' + encodeURIComponent(id)); }
  async *stream(env) {
    const res = await this.request('POST', '/messages/stream', env, { Accept: 'text/event-stream' });
    if (!res.ok) {
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = { error: text }; }
      throw new LampsonError(data.error || ('HTTP ' + res.status), { status: res.status, body: data });
    }
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let cut;
      // SSE: events separated by a blank line; the payload is in the "data:" lines
      while ((cut = buf.search(/\r?\n\r?\n/)) !== -1) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut).replace(/^\r?\n\r?\n/, '');
        const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (!data) continue;
        let ev; try { ev = JSON.parse(data); } catch { continue; }
        yield ev;
        if (ev.kind === 'done') return;
      }
    }
  }
  async close() {}
}

// ---------- local mode: `lampson run --stdio` as a child process ----------

// ---------- your app's functions as tools (local mode) ----------

const TOOL_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const TAKEN = ['read', 'write', 'edit', 'ls', 'find', 'grep', 'lsp', 'fetch', 'bash', 'process', 'memory', 'todo', 'skill', 'mcp', 'plugin', 'schedule', 'computer_use', 'delegate', 'send', 'board', 'objective'];

// a JSON Schema from what the AI SDK world passes: jsonSchema(...) wrappers, zod (v4: z.toJSONSchema, v3 needs
// zod-to-json-schema in the app) or a plain JSON Schema object
function toJsonSchema(s, name) {
  if (s == null) return { type: 'object', properties: {} };
  if (s.jsonSchema && typeof s.jsonSchema === 'object') return s.jsonSchema;
  if (typeof s.toJSONSchema === 'function') return s.toJSONSchema();
  if (s._zod || s._def) {
    const { createRequire } = require('module');
    const req = createRequire(path.join(process.cwd(), 'noop.js'));
    try { const z = req('zod'); if (typeof z.toJSONSchema === 'function') return z.toJSONSchema(s); } catch {}
    try { return req('zod-to-json-schema').zodToJsonSchema(s); } catch {}
    throw new TypeError('tool ' + name + ': cannot turn this zod schema into JSON Schema (zod 4 has z.toJSONSchema; with zod 3 install zod-to-json-schema), or pass `parameters` as a JSON Schema');
  }
  if (typeof s === 'object') return s;
  throw new TypeError('tool ' + name + ': inputSchema/parameters must be a zod schema or a JSON Schema object');
}

function toolSpec(name, def) {
  if (!TOOL_NAME.test(name || '')) throw new TypeError('tool name "' + name + '": lowercase letters, digits and _ (max 40), starting with a letter');
  if (TAKEN.includes(name)) throw new TypeError('tool name "' + name + '" is a name Lampson already uses');
  if (!def || typeof def.execute !== 'function') throw new TypeError('tool ' + name + ': needs execute(args, ctx)');
  const schema = def.inputSchema || def.parameters;
  return {
    wire: { name, description: String(def.description || ''), parameters: toJsonSchema(schema, name), timeout: def.timeout },
    schema, execute: def.execute,
  };
}

// run one of your tools: what the model wrote is validated by a zod inputSchema before your code sees it; the
// answer is {output} or {error}, the same over stdio (local) and over HTTP (server)
async function executeTool(t, name, args, ctx) {
  if (!t) return { error: 'the app has no tool ' + name };
  try {
    let input = args || {};
    if (t.schema && typeof t.schema.safeParse === 'function') {
      const v = t.schema.safeParse(input);
      if (!v.success) return { error: 'invalid arguments for ' + name + ': ' + ((v.error && v.error.message) || 'schema mismatch') };
      input = v.data;
    }
    const out = await t.execute(input, Object.freeze(Object.assign({}, ctx || {})));
    return { output: out === undefined ? null : out };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
}

// the RFC 9421 profile Synsema's http_sign uses: @method, @target-uri, content-digest; created, keyid, alg=hmac-sha256
function headerOf(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  for (const k of Object.keys(headers)) if (k.toLowerCase() === name) return String(headers[k]);
  return '';
}
function verifyToolRequest({ method, url, headers, body }, secret, opts = {}) {
  if (!secret) return null;
  const input = headerOf(headers, 'signature-input'), sigh = headerOf(headers, 'signature'), dig = headerOf(headers, 'content-digest');
  const mi = /^sig1=(\("@method" "@target-uri" "content-digest"\);created=(\d+);keyid="([^"]*)";alg="hmac-sha256")$/.exec(input);
  const ms = /^sig1=:([A-Za-z0-9+/=]+):$/.exec(sigh);
  if (!mi || !ms) return null;
  const created = Number(mi[2]);
  const now = opts.now != null ? opts.now : Math.floor(Date.now() / 1000);
  if (Math.abs(now - created) > 300) return null;                       // ±300 s, like http_signature_verify
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(String(body == null ? '' : body), 'utf8');
  const wantDigest = 'sha-256=:' + crypto.createHash('sha256').update(raw).digest('base64') + ':';
  if (dig !== wantDigest) return null;
  const base = ['"@method": ' + String(method || 'POST').toUpperCase(), '"@target-uri": ' + url, '"content-digest": ' + dig, '"@signature-params": ' + mi[1]].join('\n');
  const want = crypto.createHmac('sha256', secret).update(base).digest();
  const got = Buffer.from(ms[1], 'base64');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  return { keyid: mi[3], created };
}

async function readNodeBody(req) {
  if (req.body != null && (typeof req.body === 'string' || Buffer.isBuffer(req.body))) return req.body;
  if (req.body != null && typeof req.body === 'object' && req.readableEnded) throw new Error('the body was already parsed as JSON: mount toolsHandler() before express.json(), or use express.raw()');
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

function killTree(child) {
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else child.kill('SIGKILL');
  } catch {}
}

class LocalTransport {
  constructor({ workspace, home, env, lampsonTools, tools, spawn: spawnSpec }, onWarning) {
    if (!workspace && !spawnSpec) throw new TypeError('local.workspace is required (the project folder the agents work in)');
    let command, args, cwd;
    if (spawnSpec) {
      // advanced / tests: run an exact command that speaks the --stdio protocol
      ({ command, args = [], cwd } = spawnSpec);
    } else {
      // this package's own launcher: same Lampson the CLI runs (lampson.ps1 / lampson.sh), no PATH needed
      command = process.execPath;
      args = [path.join(__dirname, '..', 'bin', 'lampson.js'), 'run', '--stdio', '--workspace', path.resolve(workspace)];
      cwd = path.resolve(workspace);
    }
    const childEnv = Object.assign({}, process.env, env || {});
    // relative to the app, not to the workspace (the launcher runs with cwd = workspace): a relative home ended up
    // inside the project (2026-10-18)
    if (home) childEnv.LAMPSON_HOME = path.resolve(home);
    if (lampsonTools === false) childEnv.LAMPSON_BUILTIN_TOOLS = 'off';
    if (tools) {
      // the tools folder lives in the project (Lampson only reads inside it): pass it relative to the workspace
      const rel = path.relative(path.resolve(workspace || '.'), path.resolve(tools)).split(path.sep).join('/');
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new TypeError('local.tools must be a folder inside local.workspace, got ' + tools);
      childEnv.LAMPSON_TOOLS_DIR = rel;
    }
    this.warnings = [];
    this.onWarning = onWarning;
    this.tools = new Map();     // name → { wire, schema, execute }
    this.child = spawn(command, args, { cwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.pending = new Map();   // id → { onEvent, done }
    this.seq = 0;
    this.stderr = [];
    this.exited = null;
    this.ready = new Promise((resolve, reject) => { this._ready = resolve; this._fail = reject; });
    readline.createInterface({ input: this.child.stdout }).on('line', line => this.onLine(line));
    readline.createInterface({ input: this.child.stderr }).on('line', line => {
      this.stderr.push(line);
      if (this.stderr.length > 40) this.stderr.shift();
    });
    this.child.on('error', err => this.onExit(null, err));
    this.child.on('exit', code => this.onExit(code));
  }
  onLine(line) {
    const t = line.trim();
    if (!t.startsWith('{')) return;            // launcher notices ("lampson updated…") are not protocol
    let m; try { m = JSON.parse(t); } catch { return; }
    if (m.kind === 'ready') {
      this.readyInfo = m.data;
      for (const w of (m.data && m.data.warnings) || []) this.warn(w);
      this._ready(m.data);
      return;
    }
    if (m.kind === 'warning') this.warn(m.data);
    if (m.kind === 'tool_request') { this.runTool(m.data || {}); return; }
    if (m.kind === 'tools') { for (const e of (m.data && m.data.errors) || []) this.warn(e); return; }
    const p = this.pending.get(m.id);
    if (!p) return;
    p.onEvent(m);
    // an "error" inside a turn (it carries agent) is one more step: "done" still follows. Only the protocol's own
    // error (bad line, unknown op) closes the request
    if (m.kind === 'done' || m.kind === 'agents' || m.kind === 'pong' || (m.kind === 'error' && !('agent' in m))) {
      this.pending.delete(m.id);
      p.done(m);
    }
  }
  warn(w) {
    if (this.warnings.includes(w)) return;      // ready lists them all; each ask repeats its agent's
    // "tool 'x' is not available" for a tool this app registers (ready can come before lampson.tool()) is not real
    const mt = /tool '([a-z0-9_]+)' is not available: no Lampson tool/.exec(w);
    if (mt && this.tools.has(mt[1])) return;
    this.warnings.push(w);
    if (this.onWarning) this.onWarning(w);
  }
  setTools(list) {
    for (const t of list) this.tools.set(t.wire.name, t);
    // a warning about a tool that now exists is no longer true
    this.warnings = this.warnings.filter(w => { const mt = /tool '([a-z0-9_]+)' is not available: no Lampson tool/.exec(w); return !(mt && this.tools.has(mt[1])); });
    if (this.exited) throw new LampsonError('lampson is not running');
    // no pending entry: the answer ("tools") only carries errors, handled in onLine
    this.child.stdin.write(JSON.stringify({ id: 't' + (++this.seq), op: 'tools', tools: [...this.tools.values()].map(t => t.wire) }) + '\n');
  }
  async runTool({ call_id, name, args, ctx }) {
    const reply = r => { if (!this.exited) this.child.stdin.write(JSON.stringify(Object.assign({ op: 'tool_result', call_id }, r)) + '\n'); };
    reply(await executeTool(this.tools.get(name), name, args, ctx));
  }
  onExit(code, err) {
    this.exited = { code, err };
    const why = new LampsonError('lampson exited' + (code != null ? ' with code ' + code : '') + (err ? ': ' + err.message : '') +
      (this.stderr.length ? '\n' + this.stderr.slice(-8).join('\n') : ''), { code, stderr: this.stderr.slice() });
    this._fail(why);
    for (const p of this.pending.values()) p.done(null, why);
    this.pending.clear();
  }
  async send(req, onEvent) {
    await this.ready;
    if (this.exited) throw new LampsonError('lampson is not running');
    const id = 'r' + (++this.seq);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { onEvent: onEvent || (() => {}), done: (m, err) => err ? reject(err) : resolve(m) });
      this.child.stdin.write(JSON.stringify(Object.assign({ id }, req)) + '\n');
    });
  }
  async agents() { return (await this.send({ op: 'agents' })).data; }
  async ask(env) { return (await this.send(Object.assign({ op: 'ask' }, env))).data; }
  async job() { throw new LampsonError('jobs exist only in server mode (callbacks)'); }
  async *stream(env) {
    const queue = [];
    let wake = null;
    let finished = false;
    let error = null;
    this.send(Object.assign({ op: 'ask' }, env), ev => { queue.push(ev); if (wake) wake(); })
      .then(() => { finished = true; if (wake) wake(); }, err => { error = err; finished = true; if (wake) wake(); });
    while (true) {
      if (queue.length) {
        const ev = queue.shift();
        const out = Object.assign({}, ev); delete out.id;
        yield out;
        if (ev.kind === 'done') return;
        continue;
      }
      if (error) throw error;
      if (finished) return;
      await new Promise(r => { wake = r; });
      wake = null;
    }
  }
  async close() {
    if (this.exited) return;
    this.child.stdin.end();
    await new Promise(resolve => {
      if (this.exited) return resolve();
      // the child is a launcher (node → shell → synsema): kill the whole tree, or synsema outlives it
      const t = setTimeout(() => { killTree(this.child); resolve(); }, 5000);
      this.child.once('exit', () => { clearTimeout(t); resolve(); });
    });
  }
}

class Lampson {
  /**
   * @param {object} opts  { url, key, toolsUrl?, toolsSecret? } for server mode, or
   *                        { local: { workspace, home?, env?, lampsonTools?, tools?, spawn? } };
   *                        agent? — the default agent; onWarning?(message) — default console.warn
   */
  constructor(opts = {}) {
    const onWarning = opts.onWarning === undefined ? (w => console.warn('lampson: ' + w)) : opts.onWarning;
    this.transport = opts.local ? new LocalTransport(opts.local, onWarning) : new HttpTransport(opts);
    this.mode = opts.local ? 'local' : 'server';
    this.agent = opts.agent || '';
    // server mode: your tools travel with each message and Lampson POSTs the calls to toolsUrl (the PUBLIC URL of
    // toolsHandler(), the one Lampson signs); toolsSecret = the key's signing secret from `lampson key add`
    this.toolsUrl = opts.toolsUrl || '';
    this.toolsSecret = opts.toolsSecret || '';
    this.serverTools = new Map();
    this.seenCalls = new Map();   // call_id → ms until it can be forgotten (toolsHandler: replays answer 409)
  }
  withAgent(msg) {
    return this.agent && msg && typeof msg === 'object' && !msg.agent && !msg.to ? Object.assign({}, msg, { agent: this.agent }) : msg;
  }
  withTools(env) {
    if (this.mode !== 'server' || this.serverTools.size === 0) return env;
    return Object.assign({}, env, { tools: [...this.serverTools.values()].map(t => t.wire), tools_url: this.toolsUrl });
  }
  addTools(specs) {
    if (this.mode === 'local') return this.transport.setTools(specs);
    if (!this.toolsUrl) throw new LampsonError('server mode: pass toolsUrl (the public URL of lampson.toolsHandler()) to register tools, or write them in Synsema: .lampson/tools/<name>.syn');
    for (const t of specs) this.serverTools.set(t.wire.name, t);
  }
  /**
   * Server mode: the endpoint Lampson POSTs your tool calls to. Verifies the signature (RFC 9421, the key's
   * toolsSecret, ±300 s), runs the tool and answers {output} | {error}. Web standard (Next route handler, Hono, Bun,
   * Deno: POST = lampson.toolsHandler()) or Node (Express: app.post(path, lampson.toolsHandler()); http.createServer).
   */
  toolsHandler() {
    const answer = async (method, headers, body) => {
      const v = verifyToolRequest({ method, url: this.toolsUrl, headers, body }, this.toolsSecret);
      if (!v) return [401, { error: 'invalid or missing Lampson signature' }];
      let msg;
      try { msg = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body)); } catch { return [400, { error: 'body must be JSON' }]; }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return [400, { error: 'body must be a JSON object' }];
      // the signature is valid for ±300 s: a captured request replayed in that window would run the tool again
      // (the one that charges). Each call_id runs once per process — serverless instances each keep their own
      const now = Date.now();
      for (const [id, until] of this.seenCalls) if (until < now) this.seenCalls.delete(id);
      if (msg.call_id != null) {
        if (this.seenCalls.has(String(msg.call_id))) return [409, { error: 'call_id ' + msg.call_id + ' already ran' }];
        this.seenCalls.set(String(msg.call_id), now + 600000);
      }
      return [200, await executeTool(this.serverTools.get(msg.name), msg.name, msg.args, msg.ctx)];
    };
    return async (req, res) => {
      if (res && typeof res.setHeader === 'function') {                 // Node: Express, http.createServer
        let status, out;
        try { [status, out] = await answer(req.method, req.headers, await readNodeBody(req)); } catch (e) { [status, out] = [400, { error: e.message }]; }
        res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(out));
        return;
      }
      const [status, out] = await answer(req.method, req.headers, Buffer.from(await req.arrayBuffer()));
      return new Response(JSON.stringify(out), { status, headers: { 'Content-Type': 'application/json' } });
    };
  }
  /** Send a message to an agent and wait for its answer. Throws LampsonError if the turn ended in an error. */
  async ask(msg) {
    const result = await this.transport.ask(this.withTools(envelope(this.withAgent(msg))));
    if (result && result.status === 'queued') return result;     // server mode with callback: { job, status }
    if (failed(result)) throw new LampsonError(result.stopped, { result });
    return result;
  }
  /** The agent's steps as they happen: session, assistant, tool_call, tool_result…, and "done" last. */
  async *stream(msg) {
    const env = this.withTools(envelope(this.withAgent(msg)));
    if (env.callback) throw new TypeError('stream does not take a callback (use ask)');
    yield* this.transport.stream(env);
  }
  /**
   * Local mode: a function of your app as a tool. The AI SDK shape: { description, inputSchema (zod or JSON Schema)
   * or parameters, execute(args, ctx), timeout? (s, default 60) }. List its name in the agent's "tools".
   */
  tool(name, def) {
    this.addTools([toolSpec(name, def)]);
    return this;
  }
  /** Several at once: { name: { description, inputSchema, execute } } — an AI SDK tools object works as is. */
  tools(map) {
    this.addTools(Object.entries(map || {}).map(([n, d]) => toolSpec(n, d)));
    return this;
  }
  /** Local mode: tools some agent lists but will not have (plugin off, typo), one message each. */
  get warnings() { return this.transport.warnings || []; }
  /** The agents this key (server) or this workspace (local) can use. */
  async agents() { return this.transport.agents(); }
  /** Server mode: status and result of a message sent with a callback. */
  async job(id) { return this.transport.job(id); }
  /** Local mode: stops the Lampson child process. Harmless in server mode. */
  async close() { return this.transport.close(); }

  /**
   * Checks the X-Lampson-Signature of a callback (or approval webhook): "sha256=" + HMAC-SHA256(rawBody, secret),
   * secret = LAMPSON_WEBHOOK_SECRET of that Lampson. Pass the raw body exactly as received (string or Buffer).
   */
  /** Checks a tool request's RFC 9421 signature by hand (toolsHandler() does it for you) → {keyid, created} | null. */
  static verifyToolRequest(req, secret, opts) { return verifyToolRequest(req, secret, opts); }

  static verifySignature(rawBody, signature, secret) {
    if (!signature || !secret) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(String(signature)), b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}

module.exports = { Lampson, LampsonError };
module.exports.default = Lampson;

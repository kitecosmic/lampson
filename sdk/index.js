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
//           key. Lampson inside your program, like SQLite. Requests are answered one at a time, in order.
//
//   await lampson.ask({ agent: "shop", thread: "customer-42", text: "do you have whole-wheat bread?" })
//     → { agent, thread, session, text, steps, usage, stopped }      (throws LampsonError if the turn failed)
//   for await (const ev of lampson.stream({ ... })) { ... }          the agent's steps live, last one kind "done"
//   await lampson.agents()                                           [{ id, description }]
//   await lampson.close()                                            local mode: stops the child process
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

class LocalTransport {
  constructor({ workspace, home, env, spawn: spawnSpec }) {
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
    if (home) childEnv.LAMPSON_HOME = home;
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
    if (m.kind === 'ready') { this.readyInfo = m.data; this._ready(m.data); return; }
    const p = this.pending.get(m.id);
    if (!p) return;
    p.onEvent(m);
    if (m.kind === 'done' || m.kind === 'agents' || m.kind === 'pong' || m.kind === 'error') {
      this.pending.delete(m.id);
      p.done(m);
    }
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
      const t = setTimeout(() => { try { this.child.kill(); } catch {} resolve(); }, 5000);
      this.child.once('exit', () => { clearTimeout(t); resolve(); });
    });
  }
}

class Lampson {
  /**
   * @param {object} opts  { url, key } for server mode, or { local: { workspace, home?, env?, spawn? } }
   */
  constructor(opts = {}) {
    this.transport = opts.local ? new LocalTransport(opts.local) : new HttpTransport(opts);
    this.mode = opts.local ? 'local' : 'server';
  }
  /** Send a message to an agent and wait for its answer. Throws LampsonError if the turn ended in an error. */
  async ask(msg) {
    const result = await this.transport.ask(envelope(msg));
    if (result && result.status === 'queued') return result;     // server mode with callback: { job, status }
    if (failed(result)) throw new LampsonError(result.stopped, { result });
    return result;
  }
  /** The agent's steps as they happen: session, assistant, tool_call, tool_result…, and "done" last. */
  async *stream(msg) {
    const env = envelope(msg);
    if (env.callback) throw new TypeError('stream does not take a callback (use ask)');
    yield* this.transport.stream(env);
  }
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
  static verifySignature(rawBody, signature, secret) {
    if (!signature || !secret) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(String(signature)), b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}

module.exports = { Lampson, LampsonError };
module.exports.default = Lampson;

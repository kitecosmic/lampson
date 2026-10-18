// tests/sdk_test.mjs — the JavaScript SDK (sdk/index.js) in both modes, against the mock LLM (tests/mock_llm.syn):
//   local  : Lampson as a child process speaking `run.syn --stdio`
//   server : a real `synsema serve web.syn` on :47996, with an API key made by `lampson key add` (run.syn)
// Run by tests/run.ps1 / run.sh with the provider pointing at the mock (same env as run_test / api_test).
import { spawn, spawnSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lampson, LampsonError } from '../sdk/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const failures = [];
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures.push(msg); console.log('  ✗ ' + msg); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitUp(url) {
  for (let i = 0; i < 80; i++) { try { const r = await fetch(url); if (r.status > 0) return true; } catch {} await sleep(250); }
  return false;
}
const threadKey = (agent, thread) => createHash('sha256').update(agent + '\n' + thread).digest('hex').slice(0, 32);
const rm = f => { try { fs.unlinkSync(f); } catch {} };
function forget(agent, thread) {
  const idx = path.join('.lampson', 'threads', threadKey(agent, thread) + '.json');
  try { const sid = JSON.parse(fs.readFileSync(idx, 'utf8')).session; for (const f of [`.lampson/sessions/${sid}.json`, `.lampson/trace/${sid}.log`, `.lampson/trace/${sid}.last`]) rm(f); } catch {}
  rm(idx);
}

const AGENTS = 'workspace/.lampson/agents';
fs.mkdirSync(AGENTS, { recursive: true });
fs.writeFileSync(`${AGENTS}/rt-sdk.agent.json`, JSON.stringify({ id: 'rt-sdk', description: 'agente del SDK', system: 'Bot del SDK.', tools: ['ls'], buffer: false }));
const THREADS = [['rt-sdk', 'sdk-js-1'], ['rt-sdk', 'sdk-js-2'], ['rt-sdk', 'sdk-js-3'], ['rt-sdk', 'sdk-js-4']];
THREADS.forEach(([a, t]) => forget(a, t));

const procs = [];
const mock = spawn('synsema', ['serve', 'tests/mock_llm.syn'], { stdio: 'ignore' }); procs.push(mock);
check(await waitUp('http://127.0.0.1:8765/v1/models'), 'mock LLM arriba');

// ---------- local ----------
console.log('SDK modo local: Lampson como proceso hijo (run.syn --stdio)');
const local = new Lampson({ local: { spawn: { command: 'synsema', args: ['run', 'run.syn'], cwd: root }, env: { LAMPSON_RUN_STDIO: '1' } } });
check(local.mode === 'local', 'mode = local');
const la = await local.agents();
check(la.some(a => a.id === 'rt-sdk' && a.description === 'agente del SDK'), 'agents() incluye el agente del proyecto');
const l1 = await local.ask({ agent: 'rt-sdk', thread: 'sdk-js-1', text: 'ls' });
check(l1.text.startsWith('final ls') && l1.agent === 'rt-sdk' && l1.thread === 'sdk-js-1', 'ask() → respuesta: ' + l1.text.slice(0, 40));
const l2 = await local.ask({ agent: 'rt-sdk', thread: 'sdk-js-1', text: 'hola' });
check(l2.session === l1.session && l2.text.includes('msgs=6'), 'mismo thread → la conversación sigue');
const kinds = [];
for await (const ev of local.stream({ agent: 'rt-sdk', thread: 'sdk-js-2', text: 'ls' })) kinds.push(ev.kind);
check(kinds[0] === 'session' && kinds.includes('tool_call') && kinds[kinds.length - 1] === 'done', 'stream() → session … tool_call … done: ' + kinds.join(','));
let lerr = null;
try { await local.ask({ agent: 'nadie', text: 'hola' }); } catch (e) { lerr = e; }
check(lerr instanceof LampsonError && /no agent named/.test(lerr.message), 'agente inexistente → LampsonError');
const [p1, p2] = await Promise.all([local.ask({ agent: 'rt-sdk', thread: 'sdk-js-3', text: 'hola' }), local.ask({ agent: 'rt-sdk', thread: 'sdk-js-4', text: 'hola' })]);
check(p1.thread === 'sdk-js-3' && p2.thread === 'sdk-js-4', 'dos ask() a la vez: cada uno recibe la suya');
await local.close();
let after = null;
try { await local.ask({ agent: 'rt-sdk', text: 'hola' }); } catch (e) { after = e; }
check(after instanceof LampsonError, 'después de close(), ask() falla con LampsonError');

// ---------- server ----------
console.log('SDK modo servidor: API /v1 de un web.syn real');
const web = spawn('synsema', ['serve', 'web.syn', '--port', '47996', '--bind', '127.0.0.1'], { stdio: 'ignore' }); procs.push(web);
check(await waitUp('http://127.0.0.1:47996/w/test/api/health'), 'web.syn arriba en :47996');
const made = spawnSync('synsema', ['run', 'run.syn'], { env: Object.assign({}, process.env, { LAMPSON_KEY_CMD: 'add', LAMPSON_KEY_AGENTS: 'rt-sdk', LAMPSON_KEY_NAME: 'sdk-test', LAMPSON_KEY_CALLBACKS: 'http://127.0.0.1:9/' }), encoding: 'utf8' });
const key = (made.stdout.match(/lk_[A-Za-z0-9_-]+/) || [])[0];
const keyId = (made.stdout.match(/\((k[A-Za-z0-9_-]+)\)/) || [])[1];
check(!!key && !!keyId, 'lampson key add → key ' + (keyId || '(ninguna)'));
const srv = new Lampson({ url: 'http://127.0.0.1:47996/w/test/', key });
check(srv.mode === 'server', 'mode = server');
const sa = await srv.agents();
check(sa.length === 1 && sa[0].id === 'rt-sdk', 'agents() → solo los de la key');
const s1 = await srv.ask({ agent: 'rt-sdk', thread: 'sdk-js-1', text: 'ls' });
check(s1.text.startsWith('final ls') && Array.isArray(s1.batch), 'ask() → respuesta (con batch del buzón): ' + s1.text.slice(0, 40));
const skinds = [];
for await (const ev of srv.stream({ agent: 'rt-sdk', thread: 'sdk-js-2', text: 'ls' })) skinds.push(ev.kind);
check(skinds[0] === 'session' && skinds.includes('tool_call') && skinds[skinds.length - 1] === 'done', 'stream() por SSE → session … done: ' + skinds.join(','));
const q = await srv.ask({ agent: 'rt-sdk', thread: 'sdk-js-3', text: 'hola', callback: 'http://127.0.0.1:9/nadie' });
check(q.status === 'queued' && typeof q.job === 'string', 'ask() con callback → { job, status: queued }');
let jobState = null;
for (let i = 0; i < 40 && !(jobState && jobState.status !== 'queued'); i++) { await sleep(250); jobState = await srv.job(q.job); }
check(jobState && jobState.status === 'done', 'job(id) → done');
let e401 = null;
try { await new Lampson({ url: 'http://127.0.0.1:47996/w/test', key: 'lk_nope' }).agents(); } catch (e) { e401 = e; }
check(e401 instanceof LampsonError && e401.status === 401, 'key inválida → LampsonError status 401');
let e403 = null;
try { await srv.ask({ agent: 'build', text: 'hola' }); } catch (e) { e403 = e; }
check(e403 instanceof LampsonError && e403.status === 403, 'agente fuera de la key → LampsonError status 403');
let etype = null;
try { await srv.ask({ agent: 'rt-sdk' }); } catch (e) { etype = e; }
check(etype instanceof TypeError, 'sin text → TypeError antes de mandar nada');

// ---------- verifySignature ----------
const body = '{"job":"m1","text":"hola"}';
const sig = 'sha256=' + createHmac('sha256', 's3cret').update(body).digest('hex');
check(Lampson.verifySignature(body, sig, 's3cret') && Lampson.verifySignature(Buffer.from(body), sig, 's3cret'), 'verifySignature acepta la firma correcta (string o Buffer)');
check(!Lampson.verifySignature(body + ' ', sig, 's3cret') && !Lampson.verifySignature(body, sig, 'otro') && !Lampson.verifySignature(body, undefined, 's3cret'), 'y rechaza body alterado, otro secreto o sin firma');

// ---------- limpieza ----------
if (keyId) spawnSync('synsema', ['run', 'run.syn'], { env: Object.assign({}, process.env, { LAMPSON_KEY_CMD: 'remove', LAMPSON_KEY_ID: keyId }) });
THREADS.forEach(([a, t]) => forget(a, t));
if (q && q.job) rm(`.lampson/api/jobs/${q.job}.json`);
rm(`${AGENTS}/rt-sdk.agent.json`);
procs.forEach(p => { try { p.kill(); } catch {} });

if (failures.length) { console.log('sdk_test: ' + failures.length + ' fallas'); process.exit(1); }
console.log('sdk_test: todo OK');
process.exit(0);

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
fs.writeFileSync(`${AGENTS}/rt-sdk.agent.json`, JSON.stringify({ id: 'rt-sdk', description: 'agente del SDK', system: 'Bot del SDK.', tools: ['ls', 'sdk_eco', 'sdk_falla'], buffer: false }));
const THREADS = [['rt-sdk', 'sdk-js-1'], ['rt-sdk', 'sdk-js-2'], ['rt-sdk', 'sdk-js-3'], ['rt-sdk', 'sdk-js-4'], ['rt-sdk', 'sdk-js-5'], ['rt-sdk', 'sdk-js-6'], ['rt-sdk', 'sdk-js-7'], ['rt-sdk', 'sdk-js-8']];
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
for await (const ev of local.stream({ agent: 'rt-sdk', thread: 'sdk-js-2', text: 'ls' })) if (ev.kind !== 'warning') kinds.push(ev.kind);
check(kinds[0] === 'session' && kinds.includes('tool_call') && kinds[kinds.length - 1] === 'done', 'stream() → session … tool_call … done: ' + kinds.join(','));
let lerr = null;
try { await local.ask({ agent: 'nadie', text: 'hola' }); } catch (e) { lerr = e; }
check(lerr instanceof LampsonError && /no agent named/.test(lerr.message), 'agente inexistente → LampsonError');
const [p1, p2] = await Promise.all([local.ask({ agent: 'rt-sdk', thread: 'sdk-js-3', text: 'hola' }), local.ask({ agent: 'rt-sdk', thread: 'sdk-js-4', text: 'hola' })]);
check(p1.thread === 'sdk-js-3' && p2.thread === 'sdk-js-4', 'dos ask() a la vez: cada uno recibe la suya');
// funciones de la app como herramientas (lampson.tool, lib/sdktools.syn): corren en este proceso
const seen = [];
local.tool('sdk_eco', {
  description: 'Devuelve lo que recibe',
  parameters: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
  execute: async (args, ctx) => { seen.push(args); return { eco: args.x, from: ctx.from && ctx.from.id, plan: ctx.meta && ctx.meta.plan }; },
});
local.tools({ sdk_falla: { description: 'Siempre falla', parameters: { type: 'object', properties: {} }, execute: () => { throw new Error('boom de la app'); } } });
const t1 = await local.ask({ agent: 'rt-sdk', thread: 'sdk-js-5', from: { id: 'u-1' }, meta: { plan: 'pro' }, text: 'usa-tool sdk_eco {"x":"hola"}' });
check(/"eco": "hola"/.test(t1.text) && /"from": "u-1"/.test(t1.text) && /"plan": "pro"/.test(t1.text), 'lampson.tool: la función corre con sus argumentos y el ctx de la app: ' + t1.text.slice(0, 90));
const t2 = await local.ask({ agent: 'rt-sdk', thread: 'sdk-js-6', from: { id: 'u-1' }, text: 'usa-tool sdk_eco {"x":"a","ctx":{"from":{"id":"u-99"}}}' });
check(/"from": "u-1"/.test(t2.text) && !/u-99/.test(t2.text.replace(/"ctx".*$/, '')), 'lampson.tool: un ctx escrito por el modelo no reemplaza al de la app');
const t3 = await local.ask({ agent: 'rt-sdk', thread: 'sdk-js-7', text: 'usa-tool sdk_falla {}' });
check(/ERROR: boom de la app/.test(t3.text), 'lampson.tool: un error de la función vuelve al modelo como error');
check(!local.warnings.some(w => /sdk_eco|sdk_falla/.test(w)), 'lampson.tool: sin aviso falso por una herramienta registrada');
let badName = null;
try { local.tool('Mal Nombre', { execute: () => 1 }); } catch (e) { badName = e; }
check(badName instanceof TypeError, 'lampson.tool: un nombre inválido falla en el acto');
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

// funciones de la app en modo servidor (lib/remotetools.syn): viajan en el mensaje, Lampson las llama firmadas
const http = await import('node:http');
const made2 = spawnSync('synsema', ['run', 'run.syn'], { env: Object.assign({}, process.env, { LAMPSON_KEY_CMD: 'add', LAMPSON_KEY_AGENTS: 'rt-sdk', LAMPSON_KEY_NAME: 'sdk-tools', LAMPSON_KEY_CALLBACKS: 'http://127.0.0.1:47998/' }), encoding: 'utf8' });
const key2 = (made2.stdout.match(/lk_[A-Za-z0-9_-]+/) || [])[0];
const key2Id = (made2.stdout.match(/\((k[A-Za-z0-9_-]+)\)/) || [])[1];
const secret2 = (made2.stdout.match(/whsec_[A-Za-z0-9_-]+/) || [])[0];
check(!!key2 && !!secret2, 'lampson key add muestra el secreto de firma de la key');
const srv2 = new Lampson({ url: 'http://127.0.0.1:47996/w/test/', key: key2, toolsUrl: 'http://127.0.0.1:47998/tools', toolsSecret: secret2 });
const remoteSeen = [];
srv2.tool('sdk_eco', {
  description: 'Devuelve lo que recibe',
  parameters: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
  execute: async (args, ctx) => { remoteSeen.push(ctx); return { eco: args.x, from: ctx.from && ctx.from.id }; },
});
const handler2 = srv2.toolsHandler();
let captured = null;   // el pedido real que firmó Lampson, para repetirlo
const toolsServer = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  req.body = Buffer.concat(chunks);
  if (!captured) captured = { headers: Object.assign({}, req.headers), body: req.body };
  return handler2(req, res);
}).listen(47998, '127.0.0.1');
await sleep(200);
const r1 = await srv2.ask({ agent: 'rt-sdk', thread: 'sdk-js-8', from: { id: 'u-5' }, text: 'usa-tool sdk_eco {"x":"remoto"}' });
check(/"eco": "remoto"/.test(r1.text) && /"from": "u-5"/.test(r1.text), 'servidor: Lampson llamó a la función de la app, firmada, con el ctx: ' + r1.text.slice(0, 80));
const forged = await fetch('http://127.0.0.1:47998/tools', { method: 'POST', body: JSON.stringify({ call_id: 'x', name: 'sdk_eco', args: { x: 'a' }, ctx: { from: { id: 'u-99' } } }) });
check(forged.status === 401 && !remoteSeen.some(c => c.from && c.from.id === 'u-99'), 'servidor: un pedido sin la firma de Lampson → 401 y la función no corre');
const ranBefore = remoteSeen.length;
const replay = await fetch('http://127.0.0.1:47998/tools', { method: 'POST', headers: { 'signature-input': captured.headers['signature-input'], 'signature': captured.headers['signature'], 'content-digest': captured.headers['content-digest'] }, body: captured.body });
check(replay.status === 409 && remoteSeen.length === ranBefore, 'servidor: el mismo pedido firmado, repetido → 409 y la función no corre de nuevo');
const sharedSeen = [];
const h3 = srv2.toolsHandler({ seen: async id => { sharedSeen.push(id); return true; } });
const r3 = await h3(new Request('http://127.0.0.1:47998/tools', { method: 'POST', headers: { 'signature-input': captured.headers['signature-input'], 'signature': captured.headers['signature'], 'content-digest': captured.headers['content-digest'] }, body: captured.body }));
check(r3.status === 409 && sharedSeen.length === 1 && remoteSeen.length === ranBefore, 'servidor: toolsHandler({ seen }) usa el almacén de la app (Redis, KV) para el call_id');
const h4 = srv2.toolsHandler({ seen: async () => { throw new Error('redis caído'); } });
const r4 = await h4(new Request('http://127.0.0.1:47998/tools', { method: 'POST', headers: { 'signature-input': captured.headers['signature-input'], 'signature': captured.headers['signature'], 'content-digest': captured.headers['content-digest'] }, body: captured.body }));
check(r4.status === 503 && remoteSeen.length === ranBefore, 'servidor: si seen falla → 503 y la función no corre');
const srvBad = new Lampson({ url: 'http://127.0.0.1:47996/w/test/', key, toolsUrl: 'http://127.0.0.1:47998/tools', toolsSecret: secret2 });
srvBad.tool('sdk_eco', { execute: () => 1 });
let e403t = null;
try { await srvBad.ask({ agent: 'rt-sdk', thread: 'sdk-js-8', text: 'hola' }); } catch (e) { e403t = e; }
check(e403t instanceof LampsonError && e403t.status === 403, 'servidor: tools_url fuera de la lista de la key → 403');
toolsServer.close();
if (key2Id) spawnSync('synsema', ['run', 'run.syn'], { env: Object.assign({}, process.env, { LAMPSON_KEY_CMD: 'remove', LAMPSON_KEY_ID: key2Id }) });

// ---------- verifySignature ----------
// ---------- fricciones de 0.5.1 ----------
console.log('SDK: avisos una vez por proceso y zod 3');
// un `run --stdio` mínimo que avisa al arrancar: dos Lampson en el mismo proceso → el aviso por defecto sale una vez
const FAKE = "console.log(JSON.stringify({kind:'ready',data:{agents:[],protocol:2,warnings:['aviso de prueba']}}));process.stdin.resume()";
const warned = [], prevWarn = console.warn;
console.warn = (...a) => warned.push(a.join(' '));
const f1 = new Lampson({ local: { spawn: { command: process.execPath, args: ['-e', FAKE] } } });
await f1.transport.ready;
const f2 = new Lampson({ local: { spawn: { command: process.execPath, args: ['-e', FAKE] } } });
await f2.transport.ready;
console.warn = prevWarn;
check(warned.filter(w => w.includes('aviso de prueba')).length === 1 && f2.warnings.includes('aviso de prueba'), 'onWarning por defecto: cada aviso una vez por proceso (lampson.warnings lo sigue teniendo)');
// zod 3 sin zod-to-json-schema: la forma de su _def (typeName), lo común
const z3 = (typeName, extra = {}) => ({ _def: Object.assign({ typeName }, extra) });
const z3obj = z3('ZodObject', { shape: () => ({
  pedido: z3('ZodString', { description: 'el id' }),
  monto: z3('ZodNumber', { checks: [{ kind: 'int' }] }),
  urgente: z3('ZodOptional', { innerType: z3('ZodBoolean') }),
  canal: z3('ZodEnum', { values: ['web', 'tel'] }),
  items: z3('ZodArray', { type: z3('ZodString') }),
  nota: z3('ZodNullable', { innerType: z3('ZodString') }),
}) });
f1.tool('z3_tool', { description: 'zod 3', inputSchema: z3obj, execute: async () => 'ok' });
const z3s = f1.transport.tools.get('z3_tool').wire.parameters;
check(z3s.type === 'object' && z3s.properties.pedido.description === 'el id' && z3s.properties.monto.type === 'integer'
  && z3s.properties.canal.enum.join() === 'web,tel' && z3s.properties.items.items.type === 'string'
  && z3s.properties.nota.anyOf.length === 2 && z3s.required.join() === 'pedido,monto,canal,items,nota', 'zod 3: object, string, number, boolean, enum, array, optional, nullable y describe sin zod-to-json-schema');
let z3err = null;
try { f1.tool('z3_union', { inputSchema: z3('ZodObject', { shape: () => ({ x: z3('ZodUnion', { options: [] }) }) }), execute: async () => 1 }); } catch (e) { z3err = e; }
check(z3err && /zod 4|zod-to-json-schema/.test(z3err.message), 'zod 3 con algo que no cubre (union): el error dice cómo seguir');
await f1.close(); await f2.close();
// Linux/Mac: close() mata el árbol entero (launcher → npx → synsema), no solo el primer proceso
if (process.platform !== 'win32') {
  const mark = 'lampson_treejs_' + process.pid;
  const tree = new Lampson({ onWarning: null, local: { spawn: { command: 'bash', args: ['-c', `(exec -a ${mark} sleep 300) & echo '{"kind":"ready","data":{}}'; trap "" TERM HUP; while true; do sleep 1; done`] } } });
  await tree.transport.ready; await new Promise(r => setTimeout(r, 500));
  const alive = () => spawnSync('pgrep', ['-f', mark]).stdout.toString().trim().split(/\s+/).filter(Boolean).length;
  const had = alive(); await tree.close(); await new Promise(r => setTimeout(r, 500));
  check(had > 0 && alive() === 0, 'close() en Linux/Mac: no quedan hijos ni nietos vivos');
}

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

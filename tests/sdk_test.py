"""tests/sdk_test.py — the Python SDK (sdk/python/lampson) in both modes, against the mock LLM (tests/mock_llm.syn):
  local  : Lampson as a child process speaking `run.syn --stdio`
  server : a real `synsema serve web.syn` on :47997, with an API key made by `lampson key add` (run.syn)
Run by tests/run.ps1 / run.sh with the provider pointing at the mock (same env as run_test / api_test / sdk_test.mjs).
"""
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
os.chdir(ROOT)
sys.path.insert(0, os.path.join(ROOT, "sdk", "python"))
from lampson import Lampson, LampsonError  # noqa: E402

failures = []


def check(cond, msg):
    if cond:
        print("  ✓ " + msg)
    else:
        failures.append(msg)
        print("  ✗ " + msg)


def wait_up(url):
    for _ in range(80):
        try:
            urllib.request.urlopen(url, timeout=2)
            return True
        except urllib.error.HTTPError:
            return True
        except Exception:
            time.sleep(0.25)
    return False


def rm(f):
    try:
        os.remove(f)
    except OSError:
        pass


def forget(agent, thread):
    idx = os.path.join(".lampson", "threads", hashlib.sha256((agent + "\n" + thread).encode()).hexdigest()[:32] + ".json")
    try:
        sid = json.load(open(idx, encoding="utf-8"))["session"]
        for f in (".lampson/sessions/%s.json" % sid, ".lampson/trace/%s.log" % sid, ".lampson/trace/%s.last" % sid):
            rm(f)
    except Exception:
        pass
    rm(idx)


AGENTS = "workspace/.lampson/agents"
os.makedirs(AGENTS, exist_ok=True)
with open(AGENTS + "/rt-sdkpy.agent.json", "w", encoding="utf-8") as f:
    json.dump({"id": "rt-sdkpy", "description": "agente del SDK de Python", "system": "Bot del SDK.", "tools": ["ls", "py_eco"], "buffer": False}, f)
THREADS = [("rt-sdkpy", t) for t in ("py-1", "py-2", "py-3", "py-4", "py-5")]
for a, t in THREADS:
    forget(a, t)
procs = []
procs.append(subprocess.Popen(["synsema", "serve", "tests/mock_llm.syn"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
check(wait_up("http://127.0.0.1:8765/v1/models"), "mock LLM arriba")

print("SDK Python, modo local: Lampson como proceso hijo (run.syn --stdio)")
with Lampson(local={"spawn": {"command": "synsema", "args": ["run", "run.syn"], "cwd": ROOT}, "env": {"LAMPSON_RUN_STDIO": "1"}}) as local:
    check(local.mode == "local", "mode = local")
    check(any(a["id"] == "rt-sdkpy" for a in local.agents()), "agents() incluye el agente del proyecto")
    l1 = local.ask(agent="rt-sdkpy", thread="py-1", text="ls")
    check(l1["text"].startswith("final ls") and l1["thread"] == "py-1", "ask() → respuesta: " + l1["text"][:40])
    l2 = local.ask(agent="rt-sdkpy", thread="py-1", text="hola")
    check(l2["session"] == l1["session"] and "msgs=6" in l2["text"], "mismo thread → la conversación sigue")
    kinds = [ev["kind"] for ev in local.stream(agent="rt-sdkpy", thread="py-2", text="ls") if ev["kind"] != "warning"]
    check(kinds[0] == "session" and "tool_call" in kinds and kinds[-1] == "done", "stream() → session … tool_call … done: " + ",".join(kinds))
    try:
        local.ask(agent="nadie", text="hola")
        err = None
    except LampsonError as e:
        err = e
    check(err is not None and "no agent named" in str(err), "agente inexistente → LampsonError")
    # funciones de la app como herramientas (@lampson.tool, lib/sdktools.syn): corren en este proceso

    @local.tool
    def py_eco(x: str, veces: int = 1, ctx: dict = None) -> dict:
        """Devuelve lo que recibe."""
        return {"eco": x * veces, "from": (ctx or {}).get("from", {}).get("id")}
    t1 = local.ask(agent="rt-sdkpy", thread="py-4", text='usa-tool py_eco {"x":"ja","veces":2}', **{"from": {"id": "u-7"}})
    check('"eco": "jaja"' in t1["text"] and '"from": "u-7"' in t1["text"], "@lampson.tool: la función corre con sus argumentos y el ctx de la app: " + t1["text"][:80])
    check(not any("py_eco" in w for w in local.warnings), "@lampson.tool: sin aviso por una herramienta registrada")
    t2 = local.ask(agent="rt-sdkpy", thread="py-4", text='usa-tool py_eco {"x":"je"}', from_={"id": "u-9"})
    check('"from": "u-9"' in t2["text"], "from_= (from es palabra reservada) llega como ctx.from: " + t2["text"][:80])
try:
    local.ask(agent="rt-sdkpy", text="hola")
    after = None
except LampsonError as e:
    after = e
check(after is not None, "después de cerrar (with), ask() falla con LampsonError")

print("SDK Python, modo servidor: API /v1 de un web.syn real")
procs.append(subprocess.Popen(["synsema", "serve", "web.syn", "--port", "47997", "--bind", "127.0.0.1"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
check(wait_up("http://127.0.0.1:47997/w/test/api/health"), "web.syn arriba en :47997")
made = subprocess.run(["synsema", "run", "run.syn"], env=dict(os.environ, LAMPSON_KEY_CMD="add", LAMPSON_KEY_AGENTS="rt-sdkpy", LAMPSON_KEY_NAME="sdk-py-test", LAMPSON_KEY_CALLBACKS="http://127.0.0.1:9/"), capture_output=True, text=True, encoding="utf-8")
key = (re.search(r"lk_[A-Za-z0-9_-]+", made.stdout) or [None])[0] if re.search(r"lk_[A-Za-z0-9_-]+", made.stdout) else None
kid = re.search(r"\((k[A-Za-z0-9_-]+)\)", made.stdout)
kid = kid.group(1) if kid else None
check(bool(key) and bool(kid), "lampson key add → key %s" % kid)
srv = Lampson(url="http://127.0.0.1:47997/w/test/v1", key=key)
check([a["id"] for a in srv.agents()] == ["rt-sdkpy"], "agents() → solo los de la key")
s1 = srv.ask(agent="rt-sdkpy", thread="py-3", text="ls")
check(s1["text"].startswith("final ls") and isinstance(s1.get("batch"), list), "ask() → respuesta (con batch del buzón)")
skinds = [ev["kind"] for ev in srv.stream(agent="rt-sdkpy", thread="py-3", text="ls")]
check(skinds[0] == "session" and skinds[-1] == "done", "stream() por SSE → session … done: " + ",".join(skinds))
q = srv.ask(agent="rt-sdkpy", thread="py-3", text="hola", callback="http://127.0.0.1:9/nadie")
check(q.get("status") == "queued" and q.get("job"), "ask(callback=…) → {job, status: queued}")
state = None
for _ in range(40):
    time.sleep(0.25)
    state = srv.job(q["job"])
    if state.get("status") != "queued":
        break
check(state and state.get("status") == "done", "job(id) → done")
try:
    Lampson(url="http://127.0.0.1:47997/w/test", key="lk_nope").agents()
    e401 = None
except LampsonError as e:
    e401 = e
check(e401 is not None and e401.status == 401, "key inválida → LampsonError status 401")
try:
    srv.ask(agent="build", text="hola")
    e403 = None
except LampsonError as e:
    e403 = e
check(e403 is not None and e403.status == 403, "agente fuera de la key → LampsonError status 403")

# funciones de la app en modo servidor (lib/remotetools.syn): Lampson las llama firmadas a tools_url
import http.server  # noqa: E402
import threading  # noqa: E402
made2 = subprocess.run(["synsema", "run", "run.syn"], env=dict(os.environ, LAMPSON_KEY_CMD="add", LAMPSON_KEY_AGENTS="rt-sdkpy", LAMPSON_KEY_NAME="sdk-py-tools", LAMPSON_KEY_CALLBACKS="http://127.0.0.1:47999/"), capture_output=True, text=True, encoding="utf-8")
key2 = re.search(r"lk_[A-Za-z0-9_-]+", made2.stdout).group(0)
kid2 = re.search(r"\((k[A-Za-z0-9_-]+)\)", made2.stdout).group(1)
secret2 = re.search(r"whsec_[A-Za-z0-9_-]+", made2.stdout).group(0)
srv2 = Lampson(url="http://127.0.0.1:47997/w/test/v1", key=key2, tools_url="http://127.0.0.1:47999/tools", tools_secret=secret2)


@srv2.tool
def py_eco(x: str, ctx: dict = None) -> dict:
    """Devuelve lo que recibe."""
    return {"eco": x, "from": (ctx or {}).get("from", {}).get("id")}


captured = []


class ToolsHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        captured.append((dict(self.headers), raw))   # el pedido real que firmó Lampson, para repetirlo
        status, out = srv2.handle_tool_request("POST", dict(self.headers), raw)
        data = json.dumps(out).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


tools_srv = http.server.ThreadingHTTPServer(("127.0.0.1", 47999), ToolsHandler)
threading.Thread(target=tools_srv.serve_forever, daemon=True).start()
r1 = srv2.ask(agent="rt-sdkpy", thread="py-5", text='usa-tool py_eco {"x":"remoto"}', from_={"id": "u-8"})
check('"eco": "remoto"' in r1["text"] and '"from": "u-8"' in r1["text"], "servidor: Lampson llamó a la función de la app, firmada, con el ctx: " + r1["text"][:80])
forged = urllib.request.Request("http://127.0.0.1:47999/tools", data=b'{"name":"py_eco","args":{"x":"a"}}', method="POST")
try:
    urllib.request.urlopen(forged)
    fstatus = 200
except urllib.error.HTTPError as e:
    fstatus = e.code
check(fstatus == 401, "servidor: un pedido sin la firma de Lampson → 401")
rstatus, rout = srv2.handle_tool_request("POST", captured[0][0], captured[0][1])
check(rstatus == 409, "servidor: el mismo pedido firmado, repetido → 409: " + json.dumps(rout))
shared = []
sstatus, _ = srv2.handle_tool_request("POST", captured[0][0], captured[0][1], seen=lambda cid: shared.append(cid) or True)
check(sstatus == 409 and len(shared) == 1, "servidor: handle_tool_request(seen=...) usa el almacén de la app para el call_id")


def _caido(cid):
    raise RuntimeError("redis caído")


fstatus2, _ = srv2.handle_tool_request("POST", captured[0][0], captured[0][1], seen=_caido)
check(fstatus2 == 503, "servidor: si seen falla → 503 y no corre")


async def _seen_async(cid):
    return False


try:
    srv2.handle_tool_request("POST", captured[0][0], captured[0][1], seen=_seen_async)
    async_err = None
except TypeError as e:
    async_err = e
check(async_err is not None and "tools_asgi" in str(async_err), "servidor: un seen async en handle_tool_request → error claro (no 409 siempre)")
tools_srv.shutdown()
subprocess.run(["synsema", "run", "run.syn"], env=dict(os.environ, LAMPSON_KEY_CMD="remove", LAMPSON_KEY_ID=kid2), capture_output=True)

import lampson as _L  # noqa: E402

try:
    _L._envelope({"text": "x", "from": {"id": "a"}, "from_": {"id": "b"}})
    both = None
except TypeError as e:
    both = e
check(both is not None and _L._envelope({"text": "x", "from_": {"id": "b"}})["from"] == {"id": "b"} and "from_" not in _L._envelope({"text": "x", "from_": {"id": "b"}}),
      "from_ y from juntos → TypeError; from_ solo → el campo from del mensaje")
# sin `lampson` en el PATH: npx con la versión de este paquete; sin npx tampoco: el error dice que falta Node
_which = _L.shutil.which
try:
    _L.shutil.which = lambda n: "C:/node/npx.cmd" if n == "npx" else None
    via_npx = _L._lampson_command()
    _L.shutil.which = lambda n: None
    try:
        _L._lampson_command()
        no_node = None
    except LampsonError as e:
        no_node = e
finally:
    _L.shutil.which = _which
check(via_npx == ["C:/node/npx.cmd", "-y", "lampson@" + _L.__version__], "sin lampson en el PATH: npx -y lampson@<esta versión>")
check(no_node is not None and "Node" in str(no_node), "sin lampson ni npx: el error dice que hace falta Node")
# un command relativo es de la app, no del workspace (el launcher corre con cwd = workspace)
try:
    fake = Lampson(local={"workspace": "workspace", "command": [sys.executable, "tests/fake_stdio.py"]})
    rel_ok = fake._t.info is not None and os.path.isabs(fake._t.proc.args[1])
    fake.close()
except Exception as e:
    rel_ok = False
    print("    " + str(e))
check(rel_ok, "local['command'] relativo se resuelve contra el directorio de la app")

body = '{"job":"m1","text":"hola"}'
sig = "sha256=" + hmac.new(b"s3cret", body.encode(), hashlib.sha256).hexdigest()
check(Lampson.verify_signature(body, sig, "s3cret") and Lampson.verify_signature(body.encode(), sig, "s3cret"), "verify_signature acepta la firma correcta (str o bytes)")
check(not Lampson.verify_signature(body + " ", sig, "s3cret") and not Lampson.verify_signature(body, None, "s3cret"), "y rechaza body alterado o sin firma")

if kid:
    subprocess.run(["synsema", "run", "run.syn"], env=dict(os.environ, LAMPSON_KEY_CMD="remove", LAMPSON_KEY_ID=kid), capture_output=True)
for a, t in THREADS:
    forget(a, t)
if q and q.get("job"):
    rm(".lampson/api/jobs/%s.json" % q["job"])
rm(AGENTS + "/rt-sdkpy.agent.json")
for p in procs:
    p.kill()

if failures:
    print("sdk_test.py: %d fallas" % len(failures))
    sys.exit(1)
print("sdk_test.py: todo OK")

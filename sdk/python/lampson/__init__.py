"""lampson — the Lampson SDK for Python (3.9+, standard library only).

    from lampson import Lampson

Two ways to reach Lampson, the same methods for both:

  SERVER  Lampson(url="https://my-lampson.com/w/<workspace>", key="lk_...")
          talks to a running Lampson (the hub, a VPS, Docker) over its HTTP API /v1. Messages go through each
          conversation's mailbox (queue, quiet window, mid-turn messages), exactly like a channel.
  LOCAL   Lampson(local={"workspace": "./my-project"})
          starts Lampson ITSELF as a child process on this machine (`lampson run --stdio`): no hub, no port, no key.
          Needs the `lampson` command (npm i -g lampson, or the installer). This client sends one request at a time
          (use one Lampson per thread for parallel conversations; the process itself runs conversations in parallel).
          `home` and `workspace` are relative to the current directory. An agent that lists a tool it will not have
          (typo, plugin off) is reported through on_warning (default: a line on stderr) and in lampson.warnings.
          local={"lampson_tools": False} -> no tool of Lampson's own exists in that process (bash, read, write,
          fetch...), not even for the built-in agents: your agents get only the tools you give them.
          Your own tools in Synsema: one file per tool in <workspace>/.lampson/tools/ (or local={"tools": "./tools"},
          inside the workspace): `export task <file name>(...)`, an `intent:` line and its `require`s.

  @lampson.tool                                       # local mode: a function of YOUR app as a tool
  def order_status(id: str, ctx: dict) -> dict:       # its docstring is the description the model sees
      ...
          The schema comes from the type hints (str, int, float, bool, list, dict, Optional, Literal, a Pydantic
          model) and defaults; a parameter named `ctx` receives {from, thread, agent, session, meta, channel} of
          the message — set by your app, never seen or written by the model. List the name in the agent's "tools".

  Lampson(agent="support", ...)  the agent that answers when a message does not say `agent` (without it, the
          workspace default: "build", Lampson's coding agent, with all of Lampson's tools)

    lampson.ask(agent="shop", thread="customer-42", text="do you have whole-wheat bread?")
      -> {"agent", "thread", "session", "text", "steps", "usage", "stopped"}   (raises LampsonError if the turn failed)
    for ev in lampson.stream(agent="shop", thread="customer-42", text="and the price?"): ...   # last one: kind "done"
    lampson.agents()                                             -> [{"id", "description"}]
    lampson.close()                                              # local mode: stops the child process
    Lampson.verify_signature(raw_body, headers["X-Lampson-Signature"], secret)   # for callbacks / webhooks

It is also a context manager:  with Lampson(local={...}) as lampson: ...
Contracts behind it: spec/engine.md (envelope, events), lib/api.syn (HTTP), run.syn (--stdio).
"""
import hashlib
import hmac
import inspect
import json
import re
import typing
import os
import shutil
import subprocess
import sys
import threading
import urllib.error
import urllib.request

__all__ = ["Lampson", "LampsonError"]
__version__ = "0.5.0"


class LampsonError(Exception):
    """A failed turn, an HTTP error (status, body) or a local process that died (stderr)."""

    def __init__(self, message, status=None, body=None, result=None, stderr=None):
        super().__init__(message)
        self.status = status
        self.body = body
        self.result = result
        self.stderr = stderr


def _envelope(msg):
    text = msg.get("text")
    if not isinstance(text, str) or not text.strip():
        raise TypeError("text is required")
    env = {"text": text}
    to = msg.get("agent") or msg.get("to")
    if to:
        env["to"] = to
    for k in ("thread", "session", "images", "meta", "from", "callback", "mode"):
        if msg.get(k) is not None:
            env[k] = msg[k]
    if msg.get("sent_at") is not None:
        env["sent_at"] = msg["sent_at"]
    return env


def _failed(result):
    return isinstance(result.get("stopped"), str) and result["stopped"].startswith("error")


# ---------- server mode: HTTP API /v1 ----------

class _Http:
    def __init__(self, url, key, timeout):
        if not url:
            raise TypeError('url is required (e.g. "http://127.0.0.1:8080/w/<workspace>")')
        if not key:
            raise TypeError("key is required (create one with `lampson key add`)")
        base = url.rstrip("/")
        if base.endswith("/v1"):
            base = base[:-3]
        self.base = base
        self.key = key
        self.timeout = timeout or 15 * 60

    def _open(self, method, path, body=None, accept="application/json"):
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(self.base + "/v1" + path, data=data, method=method, headers={
            "Authorization": "Bearer " + self.key, "Content-Type": "application/json", "Accept": accept})
        try:
            return urllib.request.urlopen(req, timeout=self.timeout)
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", "replace")
            try:
                parsed = json.loads(raw)
            except ValueError:
                parsed = {"error": raw}
            raise LampsonError(parsed.get("error") or "HTTP %d" % e.code, status=e.code, body=parsed) from None

    def _json(self, method, path, body=None):
        with self._open(method, path, body) as r:
            raw = r.read().decode("utf-8")
        return json.loads(raw) if raw else {}

    def agents(self):
        return self._json("GET", "/agents")["agents"]

    def ask(self, env):
        return self._json("POST", "/messages", env)

    def job(self, job_id):
        return self._json("GET", "/jobs/" + urllib.request.quote(job_id, safe=""))

    def stream(self, env):
        with self._open("POST", "/messages/stream", env, accept="text/event-stream") as r:
            data_lines = []
            for raw in r:
                line = raw.decode("utf-8").rstrip("\r\n")
                if line.startswith("data:"):
                    data_lines.append(line[5:].lstrip())
                elif line == "" and data_lines:
                    try:
                        ev = json.loads("\n".join(data_lines))
                    except ValueError:
                        ev = None
                    data_lines = []
                    if ev is not None:
                        yield ev
                        if ev.get("kind") == "done":
                            return

    def close(self):
        pass


# ---------- local mode: `lampson run --stdio` as a child process ----------

def _lampson_command():
    for name in ("lampson", "lampson.cmd"):
        found = shutil.which(name)
        if found:
            return [found]
    raise LampsonError("local mode needs the `lampson` command: npm i -g lampson (or pass local={'command': [...]})")


# ---------- your app's functions as tools (local mode) ----------

_TOOL_NAME = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
_TAKEN = {"read", "write", "edit", "ls", "find", "grep", "lsp", "fetch", "bash", "process", "memory", "todo", "skill",
          "mcp", "plugin", "schedule", "computer_use", "delegate", "send", "board", "objective"}


def _about_tool(w):
    """The tool a "tool 'x' is not available: no Lampson tool…" warning is about, or None."""
    m = re.search(r"tool '([a-z0-9_]+)' is not available: no Lampson tool", w or "")
    return m.group(1) if m else None


def _is_model(t):
    return inspect.isclass(t) and hasattr(t, "model_json_schema") and hasattr(t, "model_validate")


def _json_type(t):
    """A type hint -> a JSON Schema fragment."""
    if t is inspect.Parameter.empty or t is typing.Any:
        return {}
    if _is_model(t):
        return t.model_json_schema()
    origin = typing.get_origin(t)
    args = typing.get_args(t)
    if origin is typing.Union:
        rest = [a for a in args if a is not type(None)]
        return _json_type(rest[0]) if len(rest) == 1 else {"anyOf": [_json_type(a) for a in rest]}
    if origin is typing.Literal:
        return {"enum": list(args)}
    if t is str:
        return {"type": "string"}
    if t is bool:
        return {"type": "boolean"}
    if t is int:
        return {"type": "integer"}
    if t is float:
        return {"type": "number"}
    if t is list or origin is list:
        return {"type": "array", "items": _json_type(args[0])} if args else {"type": "array"}
    if t is dict or origin is dict:
        return {"type": "object"}
    return {}


def _tool_spec(fn, name=None, description=None, timeout=None):
    name = name or fn.__name__
    if not _TOOL_NAME.match(name):
        raise TypeError("tool name %r: lowercase letters, digits and _ (max 40), starting with a letter" % name)
    if name in _TAKEN:
        raise TypeError("tool name %r is a name Lampson already uses" % name)
    try:
        hints = typing.get_type_hints(fn)
    except Exception:
        hints = {}
    props, required, models, wants_ctx = {}, [], {}, False
    for p in inspect.signature(fn).parameters.values():
        if p.name == "ctx":
            wants_ctx = True   # never in the schema: the model cannot write it
            continue
        if p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
            continue
        t = hints.get(p.name, p.annotation)
        props[p.name] = _json_type(t)
        if _is_model(t):
            models[p.name] = t
        if p.default is p.empty:
            required.append(p.name)
    desc = description if description is not None else inspect.cleandoc(fn.__doc__ or "").split("\n\n")[0]
    wire = {"name": name, "description": desc, "parameters": {"type": "object", "properties": props, "required": required}}
    if timeout:
        wire["timeout"] = timeout
    return {"wire": wire, "fn": fn, "ctx": wants_ctx, "models": models}


class _Local:
    def __init__(self, workspace=None, home=None, env=None, command=None, spawn=None, on_warning=None, lampson_tools=True,
                 tools=None):
        child_env = dict(os.environ)
        child_env.update(env or {})
        # relative to the app, not to the workspace (the launcher runs with cwd = workspace)
        if home:
            child_env["LAMPSON_HOME"] = os.path.abspath(home)
        if lampson_tools is False:
            child_env["LAMPSON_BUILTIN_TOOLS"] = "off"
        if tools:
            # the tools folder lives in the project (Lampson only reads inside it): relative to the workspace
            try:
                rel = os.path.relpath(os.path.abspath(tools), os.path.abspath(workspace or ".")).replace(os.sep, "/")
            except ValueError:   # another drive (Windows)
                rel = ".."
            if rel == "." or rel.startswith(".."):
                raise TypeError("local['tools'] must be a folder inside local['workspace'], got %r" % tools)
            child_env["LAMPSON_TOOLS_DIR"] = rel
        self.warnings = []
        self.on_warning = on_warning
        self.tools = {}               # name -> spec (_tool_spec)
        self._ready_warnings = []     # shown at the first request, once the app had the chance to register its tools
        if spawn:
            # advanced / tests: an exact command that speaks the --stdio protocol
            argv = [spawn["command"]] + list(spawn.get("args", []))
            cwd = spawn.get("cwd")
        else:
            if not workspace:
                raise TypeError("local['workspace'] is required (the project folder the agents work in)")
            ws = os.path.abspath(workspace)
            argv = (command or _lampson_command()) + ["run", "--stdio", "--workspace", ws]
            cwd = ws
        self.proc = subprocess.Popen(argv, cwd=cwd, env=child_env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1)
        self.stderr = []
        threading.Thread(target=self._drain_stderr, daemon=True).start()
        self.lock = threading.Lock()   # one request at a time: the protocol answers in order
        self.seq = 0
        self.info = None
        while True:
            m = self._read()
            if m.get("kind") == "ready":
                self.info = m.get("data")
                self._ready_warnings = list((self.info or {}).get("warnings") or [])
                break

    def _warn(self, w):
        if w in self.warnings:
            return   # ready lists them all; each ask repeats its agent's
        if _about_tool(w) in self.tools:
            return   # a tool this app registers with lampson.tool()
        self.warnings.append(w)
        if self.on_warning:
            self.on_warning(w)

    def flush_warnings(self):
        pending, self._ready_warnings = self._ready_warnings, []
        for w in pending:
            self._warn(w)

    def set_tools(self, specs):
        for s in specs:
            self.tools[s["wire"]["name"]] = s
        # a warning about a tool that now exists is no longer true
        self.warnings = [w for w in self.warnings if _about_tool(w) not in self.tools]
        if self.proc.poll() is not None:
            raise LampsonError("lampson is not running")
        with self.lock:
            self.seq += 1
            # no answer awaited: the "tools" reply only carries errors (names are checked here first)
            self.proc.stdin.write(json.dumps({"id": "t%d" % self.seq, "op": "tools", "tools": [s["wire"] for s in self.tools.values()]}) + "\n")
            self.proc.stdin.flush()

    def _run_tool(self, data):
        """A tool_request: run the app's function and answer with tool_result."""
        call_id, name = data.get("call_id"), data.get("name")
        spec = self.tools.get(name)
        reply = {"op": "tool_result", "call_id": call_id}
        if spec is None:
            reply["error"] = "the app has no tool %s" % name
        else:
            try:
                args = dict(data.get("args") or {})
                for k, model in spec["models"].items():
                    if k in args:
                        args[k] = model.model_validate(args[k])
                if spec["ctx"]:
                    args["ctx"] = dict(data.get("ctx") or {})
                out = spec["fn"](**args)
                if hasattr(out, "model_dump"):
                    out = out.model_dump()
                reply["output"] = out
            except Exception as e:   # the error goes back to the model, the app keeps running
                reply["error"] = "%s: %s" % (type(e).__name__, e)
        self.proc.stdin.write(json.dumps(reply, default=str) + "\n")
        self.proc.stdin.flush()

    def _drain_stderr(self):
        for line in self.proc.stderr:
            self.stderr.append(line.rstrip("\n"))
            del self.stderr[:-40]

    def _read(self):
        while True:
            line = self.proc.stdout.readline()
            if line == "":
                code = self.proc.wait()
                raise LampsonError("lampson exited with code %s\n%s" % (code, "\n".join(self.stderr[-8:])), stderr=list(self.stderr))
            t = line.strip()
            if not t.startswith("{"):
                continue   # launcher notices ("lampson updated…") are not protocol
            try:
                return json.loads(t)
            except ValueError:
                continue

    def _requests(self, req):
        """Sends one request and yields its events until the closing one."""
        self.flush_warnings()
        if self.proc.poll() is not None:
            raise LampsonError("lampson is not running")
        with self.lock:
            self.seq += 1
            rid = "r%d" % self.seq
            self.proc.stdin.write(json.dumps(dict(req, id=rid)) + "\n")
            self.proc.stdin.flush()
            while True:
                m = self._read()
                if m.get("kind") == "tool_request":
                    self._run_tool(m.get("data") or {})
                    continue
                if m.get("kind") == "tools":
                    for e in (m.get("data") or {}).get("errors") or []:
                        self._warn(e)
                    continue
                if m.get("id") != rid:
                    continue
                if m.get("kind") == "warning":
                    self._warn(m.get("data"))
                yield m
                # an "error" inside a turn (it carries agent) is one more step: "done" still follows
                if m.get("kind") in ("done", "agents", "pong") or (m.get("kind") == "error" and "agent" not in m):
                    return

    def _final(self, req):
        last = None
        for m in self._requests(req):
            last = m
        return last

    def agents(self):
        return self._final({"op": "agents"})["data"]

    def ask(self, env):
        return self._final(dict(env, op="ask"))["data"]

    def job(self, job_id):
        raise LampsonError("jobs exist only in server mode (callbacks)")

    def stream(self, env):
        for m in self._requests(dict(env, op="ask")):
            m = dict(m)
            m.pop("id", None)
            yield m

    def close(self):
        if self.proc.poll() is None:
            try:
                self.proc.stdin.close()
                self.proc.wait(timeout=5)
            except Exception:
                # the child is a launcher (shell → synsema): kill the whole tree, or synsema outlives it
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(self.proc.pid), "/T", "/F"], capture_output=True)
                else:
                    self.proc.kill()


class Lampson:
    """Server mode: Lampson(url=..., key=...).  Local mode: Lampson(local={"workspace": ...})."""

    def __init__(self, url=None, key=None, local=None, timeout=None, on_warning=False, agent=None):
        self.agent = agent or ""
        if local is not None:
            if on_warning is False:
                on_warning = lambda w: print("lampson: " + w, file=sys.stderr)
            self._t = _Local(**dict(local, on_warning=on_warning))
            self.mode = "local"
        else:
            self._t = _Http(url, key, timeout)
            self.mode = "server"

    def ask(self, agent=None, text=None, **msg):
        """Send a message to an agent and wait for its answer. Raises LampsonError if the turn ended in an error."""
        result = self._t.ask(_envelope(dict(msg, agent=agent or (None if msg.get("to") else self.agent) or None, text=text)))
        if result.get("status") == "queued":
            return result   # server mode with callback: {"job", "status"}
        if _failed(result):
            raise LampsonError(result["stopped"], result=result)
        return result

    def stream(self, agent=None, text=None, **msg):
        """The agent's steps as they happen: session, assistant, tool_call, tool_result…, and "done" last."""
        env = _envelope(dict(msg, agent=agent or (None if msg.get("to") else self.agent) or None, text=text))
        if "callback" in env:
            raise TypeError("stream does not take a callback (use ask)")
        return self._t.stream(env)

    def tool(self, fn=None, *, name=None, description=None, timeout=None):
        """Local mode: a function of your app as a tool. Use as @lampson.tool or @lampson.tool(name=..., timeout=...).
        The schema comes from its type hints and defaults; a `ctx` parameter gets the message's context."""
        if self.mode != "local":
            raise LampsonError("lampson.tool needs local mode for now (in server mode, write the tool in Synsema: .lampson/tools/<name>.syn)")

        def register(f):
            self._t.set_tools([_tool_spec(f, name, description, timeout)])
            return f
        return register(fn) if fn is not None else register

    @property
    def warnings(self):
        """Local mode: tools some agent lists but will not have (plugin off, typo), one message each."""
        if hasattr(self._t, "flush_warnings"):
            self._t.flush_warnings()
        return getattr(self._t, "warnings", [])

    def agents(self):
        """The agents this key (server) or this workspace (local) can use."""
        return self._t.agents()

    def job(self, job_id):
        """Server mode: status and result of a message sent with a callback."""
        return self._t.job(job_id)

    def close(self):
        """Local mode: stops the Lampson child process. Harmless in server mode."""
        self._t.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False

    @staticmethod
    def verify_signature(raw_body, signature, secret):
        """Checks X-Lampson-Signature: "sha256=" + HMAC-SHA256(raw_body, secret). Pass the raw body (str or bytes)."""
        if not signature or not secret:
            return False
        body = raw_body.encode("utf-8") if isinstance(raw_body, str) else raw_body
        expected = "sha256=" + hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, str(signature))

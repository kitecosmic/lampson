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
import json
import os
import shutil
import subprocess
import threading
import urllib.error
import urllib.request

__all__ = ["Lampson", "LampsonError"]
__version__ = "0.2.10"


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


class _Local:
    def __init__(self, workspace=None, home=None, env=None, command=None, spawn=None):
        child_env = dict(os.environ)
        child_env.update(env or {})
        if home:
            child_env["LAMPSON_HOME"] = home
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
                break

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
        if self.proc.poll() is not None:
            raise LampsonError("lampson is not running")
        with self.lock:
            self.seq += 1
            rid = "r%d" % self.seq
            self.proc.stdin.write(json.dumps(dict(req, id=rid)) + "\n")
            self.proc.stdin.flush()
            while True:
                m = self._read()
                if m.get("id") != rid:
                    continue
                yield m
                if m.get("kind") in ("done", "agents", "pong", "error"):
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
                self.proc.kill()


class Lampson:
    """Server mode: Lampson(url=..., key=...).  Local mode: Lampson(local={"workspace": ...})."""

    def __init__(self, url=None, key=None, local=None, timeout=None):
        if local is not None:
            self._t = _Local(**local)
            self.mode = "local"
        else:
            self._t = _Http(url, key, timeout)
            self.mode = "server"

    def ask(self, agent=None, text=None, **msg):
        """Send a message to an agent and wait for its answer. Raises LampsonError if the turn ended in an error."""
        result = self._t.ask(_envelope(dict(msg, agent=agent, text=text)))
        if result.get("status") == "queued":
            return result   # server mode with callback: {"job", "status"}
        if _failed(result):
            raise LampsonError(result["stopped"], result=result)
        return result

    def stream(self, agent=None, text=None, **msg):
        """The agent's steps as they happen: session, assistant, tool_call, tool_result…, and "done" last."""
        env = _envelope(dict(msg, agent=agent, text=text))
        if "callback" in env:
            raise TypeError("stream does not take a callback (use ask)")
        return self._t.stream(env)

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

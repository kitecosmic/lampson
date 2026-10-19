# lampson (Python SDK)

Talk to [Lampson](https://github.com/kitecosmic/lampson) agents from Python. Standard library only.

```python
from lampson import Lampson

# server mode: a running Lampson, an API key from `lampson key add`
lampson = Lampson(url="https://my-lampson.com/w/<workspace>", key="lk_...")

# or local mode: Lampson as a child process on this machine. It needs Node.js: it uses the `lampson` command if
# installed, else `npx lampson@<this version>` (fetched once)
lampson = Lampson(local={"workspace": "./my-project"})

r = lampson.ask(agent="shop", thread="customer-42", text="do you have whole-wheat bread?")
print(r["text"])

for ev in lampson.stream(agent="shop", thread="customer-42", text="and the price?"):
    if ev["kind"] == "assistant":
        print(ev["data"])

lampson.close()
```

Another Lampson for local mode: `local={"workspace": ..., "command": ["node", "node_modules/lampson/bin/lampson.js"]}`.
A relative path there is resolved against your app's directory, not the workspace.

An agent for your customers should have only the tools you give it. In local mode, `lampson_tools: False` removes
every tool of Lampson's own (bash, read, write, fetch…) from that process, and `agent=` sets the agent that answers
when a message does not name one:

```python
lampson = Lampson(agent="shop", local={"workspace": "./my-project", "lampson_tools": False})
lampson.ask(thread="customer-42", text="where is my order?")
```

Your app's functions as tools: the schema comes from the type hints, the docstring is the description,
and `ctx` (who is writing, the thread, your `meta`) comes from your app, never from the model:

```python
@lampson.tool
def stock(product: str, ctx: dict) -> dict:
    """Units in stock of a product."""
    return db.stock(product, customer=ctx["from"]["id"])

lampson.ask(thread="customer-42", text="do you have bread?", from_={"id": "c-42"})   # from_: `from` is a keyword
```

With Lampson on another machine the tool code is the same: pass `tools_url` (the public URL of your endpoint, in the
key's `--callback` list) and `tools_secret` (the `whsec_…` that `lampson key add` shows), and mount the endpoint.
Lampson POSTs each call there, signed (RFC 9421); it is verified, run, and a repeated `call_id` gets 409:

```python
lampson = Lampson(url=..., key=..., tools_url="https://my-app.com/lampson/tools", tools_secret=os.environ["LAMPSON_TOOLS_SECRET"])
app.mount("/lampson/tools", lampson.tools_asgi())     # FastAPI / Starlette; any other: lampson.handle_tool_request(...)
```

With several workers, give it a shared store for the `call_id`s: `tools_asgi(seen=...)`.

Or write the tool in Synsema (`.lampson/tools/stock.syn`, one file per tool): its `require`s are everything it can
touch, and it runs only once a person approved that exact content (`lampson tools approve` or the web UI; for development,
`local={"approve_tools": True}`). See [lampson.org/docs/sdk](https://lampson.org/docs/sdk).

If an agent lists a tool it will not have (a plugin that is off, a typo), you get a line on stderr at start
(`on_warning=` to change it, `None` to silence it) and the list in `lampson.warnings`.

The same methods in both modes: `ask`, `stream`, `agents`, `job` (server), `close`, and
`Lampson.verify_signature(raw_body, signature, secret)` for callbacks and `verify_tool_request(...)` for tool calls.

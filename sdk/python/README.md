# lampson (Python SDK)

Talk to [Lampson](https://github.com/kitecosmic/lampson) agents from Python. Standard library only.

```python
from lampson import Lampson

# server mode: a running Lampson, an API key from `lampson key add`
lampson = Lampson(url="https://my-lampson.com/w/<workspace>", key="lk_...")

# or local mode: Lampson as a child process on this machine (needs the `lampson` command)
lampson = Lampson(local={"workspace": "./my-project"})

r = lampson.ask(agent="shop", thread="customer-42", text="do you have whole-wheat bread?")
print(r["text"])

for ev in lampson.stream(agent="shop", thread="customer-42", text="and the price?"):
    if ev["kind"] == "assistant":
        print(ev["data"])

lampson.close()
```

An agent for your customers should have only the tools you give it. In local mode, `lampson_tools: False` removes
every tool of Lampson's own (bash, read, write, fetch…) from that process, and `agent=` sets the agent that answers
when a message does not name one:

```python
lampson = Lampson(agent="shop", local={"workspace": "./my-project", "lampson_tools": False})
lampson.ask(thread="customer-42", text="where is my order?")
```

Your app's functions as tools (local mode): the schema comes from the type hints, the docstring is the description,
and `ctx` (who is writing, the thread, your `meta`) comes from your app, never from the model:

```python
@lampson.tool
def stock(product: str, ctx: dict) -> dict:
    """Units in stock of a product."""
    return db.stock(product, customer=ctx["from"]["id"])

lampson.ask(thread="customer-42", text="do you have bread?", **{"from": {"id": "c-42"}})
```

Or write the tool in Synsema (`.lampson/tools/stock.syn`, one file per tool): its `require`s are everything it can
touch. See [lampson.org/docs/sdk](https://lampson.org/docs/sdk).

If an agent lists a tool it will not have (a plugin that is off, a typo), you get a line on stderr at start
(`on_warning=` to change it, `None` to silence it) and the list in `lampson.warnings`.

The same methods in both modes: `ask`, `stream`, `agents`, `job` (server), `close`, and
`Lampson.verify_signature(raw_body, signature, secret)` for callbacks.

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

If an agent lists a tool it will not have (a plugin that is off, a typo), you get a line on stderr at start
(`on_warning=` to change it, `None` to silence it) and the list in `lampson.warnings`.

The same methods in both modes: `ask`, `stream`, `agents`, `job` (server), `close`, and
`Lampson.verify_signature(raw_body, signature, secret)` for callbacks.

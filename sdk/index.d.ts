// sdk/index.d.ts — types for the Lampson SDK (sdk/index.js)

export interface ServerOptions {
  /** The workspace base: "https://my-lampson.com/w/<workspace>" (a trailing /v1 is fine too). */
  url: string;
  /** An API key from `lampson key add`. */
  key: string;
  /** A fetch implementation (default: the global one, Node 18+). */
  fetch?: typeof fetch;
  /** Per-request timeout in ms (default 15 min: an agent can take a while). */
  timeout?: number;
  /** Your tools in server mode: the PUBLIC URL of toolsHandler(), where Lampson POSTs each call (in the key's list). */
  toolsUrl?: string;
  /** The key's signing secret (whsec_…, shown by `lampson key add`): toolsHandler() verifies Lampson's calls with it. */
  toolsSecret?: string;
}

export interface LocalOptions {
  local: {
    /** The project folder the agents work in. */
    workspace: string;
    /** LAMPSON_HOME: where Lampson keeps its config, sessions and plugins (default ~/lampson). Relative to process.cwd(). */
    home?: string;
    /** false: no tool of Lampson's own (bash, read, write, fetch…) exists in this process, not even for the built-in
     *  agents — your agents get only the tools you give them. Default true. */
    lampsonTools?: boolean;
    /** Your tools in Synsema: a folder inside `workspace` with one `<name>.syn` per tool (default `<workspace>/.lampson/tools`).
     *  Each file has an `intent:` line (its description), its `require`s (all it can touch) and `export task <name>(…)`. */
    tools?: string;
    /** Extra environment for the Lampson process (e.g. provider keys). */
    env?: Record<string, string>;
    /** Advanced / tests: an exact command that speaks the `lampson run --stdio` protocol. */
    spawn?: { command: string; args?: string[]; cwd?: string };
  };
}

export interface CommonOptions {
  /** The agent that answers when a message does not say `agent`. Without it: the workspace default ("build"). */
  agent?: string;
  /** Local mode: called once per tool an agent lists but will not have (plugin off, typo). Default console.warn; null = silent. */
  onWarning?: ((message: string) => void) | null;
}

export interface Message {
  /** The agent that answers (alias: `to`). Default: the workspace's default agent. */
  agent?: string;
  to?: string;
  /** Who/what this conversation is (a customer, a ticket, "cto:task-17"): same thread = same conversation. */
  thread?: string;
  /** Or continue a known session id. */
  session?: string;
  text: string;
  images?: { media_type: string; data: string }[];
  meta?: Record<string, unknown>;
  from?: { id?: string; name?: string; kind?: 'human' | 'agent' | 'system' };
  /** When the user wrote it (unix seconds): orders a burst that arrived out of order (server mode). */
  sentAt?: number;
  /** Server mode: answer now with { job, status: "queued" } and POST the result here later. */
  callback?: string;
  /** Local mode: "strict" | "yolo" for this request (default: the agent's, else strict). */
  mode?: 'strict' | 'yolo';
}

export interface Usage { input: number; output: number; cached: number }

export interface Result {
  agent: string;
  thread: string;
  session: string;
  text: string;
  steps: number;
  usage: Usage;
  /** "done" | "max_steps" | "budget" | "error: …" */
  stopped: string;
  /** Server mode: ids of the messages answered together (a burst), and the one that leads it. */
  batch?: string[];
  lead?: string;
}

export interface Queued { job: string; status: 'queued' }

export interface LampsonEvent {
  kind: 'session' | 'assistant' | 'tool_call' | 'tool_result' | 'tool_denied' | 'usage' | 'inbox' | 'error' | 'compact' | 'warning' | 'done' | string;
  data: any;
  tag?: string;
  agent?: string;
  thread?: string;
}

export interface AgentInfo { id: string; description: string }

export class LampsonError extends Error {
  status?: number;
  body?: unknown;
  result?: Result;
  code?: number | null;
  stderr?: string[];
}

/** What your app's tool receives besides its arguments: set by your app (the message), never by the model. */
export interface ToolContext {
  from?: { id?: string; name?: string; kind?: string };
  thread?: string;
  agent?: string;
  session?: string;
  meta?: Record<string, unknown>;
  channel?: string;
}

/** A function of your app as a tool — the AI SDK shape. */
export interface ToolDefinition<A = any> {
  description?: string;
  /** A zod schema (validated before execute) or a JSON Schema. */
  inputSchema?: unknown;
  /** A JSON Schema (alias of inputSchema). */
  parameters?: unknown;
  execute: (args: A, ctx: Readonly<ToolContext>) => unknown | Promise<unknown>;
  /** Seconds Lampson waits for the answer (default 60, max 600). */
  timeout?: number;
}

export class Lampson {
  constructor(opts: (ServerOptions | LocalOptions) & CommonOptions);
  readonly mode: 'server' | 'local';
  /** A function of your app as a tool (server mode needs toolsUrl); list its name in the agent's "tools". */
  tool<A = any>(name: string, def: ToolDefinition<A>): this;
  /** Several tools at once — an AI SDK tools object works as is. */
  tools(map: Record<string, ToolDefinition>): this;
  /**
   * Server mode: the endpoint for Lampson's tool calls — verifies the signature, runs the tool, answers.
   * Web standard (Next route handler, Hono, Bun, Deno) or Node (Express, http.createServer).
   */
  toolsHandler(): (req: any, res?: any) => Promise<Response | void>;
  /** The default agent given in the options ("" = the workspace default). */
  readonly agent: string;
  /** Local mode: tools some agent lists but will not have, one message each (filled once the process is ready). */
  readonly warnings: string[];
  ask(msg: Message): Promise<Result | Queued>;
  stream(msg: Omit<Message, 'callback'>): AsyncGenerator<LampsonEvent, void, unknown>;
  agents(): Promise<AgentInfo[]>;
  job(id: string): Promise<unknown>;
  close(): Promise<void>;
  /** Checks a tool call's RFC 9421 signature by hand (toolsHandler() does it) → {keyid, created} or null. */
  static verifyToolRequest(req: { method: string; url: string; headers: Record<string, string> | Headers; body: string | Buffer }, secret: string, opts?: { now?: number }): { keyid: string; created: number } | null;
  static verifySignature(rawBody: string | Buffer, signature: string | undefined, secret: string): boolean;
}

export default Lampson;

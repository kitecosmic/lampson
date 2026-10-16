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
}

export interface LocalOptions {
  local: {
    /** The project folder the agents work in. */
    workspace: string;
    /** LAMPSON_HOME: where Lampson keeps its config, sessions and plugins (default ~/lampson). */
    home?: string;
    /** Extra environment for the Lampson process (e.g. provider keys). */
    env?: Record<string, string>;
    /** Advanced / tests: an exact command that speaks the `lampson run --stdio` protocol. */
    spawn?: { command: string; args?: string[]; cwd?: string };
  };
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
  kind: 'session' | 'assistant' | 'tool_call' | 'tool_result' | 'tool_denied' | 'usage' | 'inbox' | 'error' | 'compact' | 'done' | string;
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

export class Lampson {
  constructor(opts: ServerOptions | LocalOptions);
  readonly mode: 'server' | 'local';
  ask(msg: Message): Promise<Result | Queued>;
  stream(msg: Omit<Message, 'callback'>): AsyncGenerator<LampsonEvent, void, unknown>;
  agents(): Promise<AgentInfo[]>;
  job(id: string): Promise<unknown>;
  close(): Promise<void>;
  static verifySignature(rawBody: string | Buffer, signature: string | undefined, secret: string): boolean;
}

export default Lampson;

// tests/mock_mcp.js — servidor MCP mínimo por stdio (JSON-RPC 2.0, una línea por mensaje) para probar
// lib/mcp.syn sin depender de un server real. Tools: echo (readOnly), add, fail, slow.
//   node tests/mock_mcp.js
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
const out = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const TOOLS = [
  { name: 'echo', description: 'Returns the text you send', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, annotations: { readOnlyHint: true } },
  { name: 'add', description: 'Adds two numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
  { name: 'fail', description: 'Always fails', inputSchema: { type: 'object', properties: {} } },
  { name: 'slow', description: 'Answers after ms milliseconds', inputSchema: { type: 'object', properties: { ms: { type: 'number' } } } },
];
rl.on('line', (line) => {
  let req; try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;
  if (method === 'initialize') return out({ jsonrpc: '2.0', id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'mock-mcp', version: '0.1' } } });
  if (method === 'notifications/initialized') return; // notificación, sin respuesta
  if (method === 'ping') return out({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return out({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params || {};
    if (name === 'echo') return out({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'echo: ' + args.text }] } });
    if (name === 'add') return out({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(Number(args.a) + Number(args.b)) }], structuredContent: { sum: Number(args.a) + Number(args.b) } } });
    if (name === 'fail') return out({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: 'boom: this tool always fails' }] } });
    if (name === 'slow') return setTimeout(() => out({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'done after ' + args.ms } ] } }), Number(args.ms || 100));
    return out({ jsonrpc: '2.0', id, error: { code: -32602, message: 'unknown tool ' + name } });
  }
  if (id !== undefined) out({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found: ' + method } });
});
process.stdin.on('end', () => process.exit(0));

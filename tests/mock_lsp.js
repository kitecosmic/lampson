// tests/mock_lsp.js — language server mínimo por stdio (JSON-RPC con framing Content-Length) para probar
// lib/lsp.syn sin instalar un server real. Responde initialize, definition, references, hover,
// documentSymbol; además manda un request server→cliente (workspace/configuration) y una notificación
// (publishDiagnostics) para probar que el cliente los atiende sin trabarse.
//   node tests/mock_lsp.js
let buf = Buffer.alloc(0);
const send = (m) => { const body = Buffer.from(JSON.stringify(m), 'utf8'); process.stdout.write('Content-Length: ' + body.length + '\r\n\r\n'); process.stdout.write(body); };
let root = '';
const uriOf = (rel) => root.replace(/\/$/, '') + '/' + rel;
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const sep = buf.indexOf('\r\n\r\n');
    if (sep < 0) return;
    const header = buf.slice(0, sep).toString('utf8');
    const m = /content-length:\s*(\d+)/i.exec(header);
    if (!m) { buf = buf.slice(sep + 4); continue; }
    const n = Number(m[1]);
    if (buf.length < sep + 4 + n) return;
    const body = buf.slice(sep + 4, sep + 4 + n).toString('utf8');
    buf = buf.slice(sep + 4 + n);
    let req; try { req = JSON.parse(body); } catch { continue; }
    handle(req);
  }
});
function handle(req) {
  const { id, method, params } = req;
  if (method === 'initialize') {
    root = params.rootUri;
    send({ jsonrpc: '2.0', id, result: { capabilities: { definitionProvider: true, referencesProvider: true, hoverProvider: true, documentSymbolProvider: true }, serverInfo: { name: 'mock-lsp' } } });
    // request del server al cliente: el cliente debe contestar (aunque sea null) y seguir
    send({ jsonrpc: '2.0', id: 'srv-1', method: 'workspace/configuration', params: { items: [{ section: 'mock' }] } });
    return;
  }
  if (method === 'initialized' || method === 'textDocument/didClose' || method === 'exit') return;
  if (method === 'textDocument/didOpen') {
    send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: params.textDocument.uri, diagnostics: [] } });
    return;
  }
  if (id === 'srv-1') return; // respuesta a nuestro request
  if (method === 'textDocument/definition') {
    // "ñ" en la respuesta: Content-Length en bytes ≠ chars, el cliente tiene que recortar bien
    return send({ jsonrpc: '2.0', id, result: [{ uri: uriOf('src/b.ts'), range: { start: { line: 1, character: 9 }, end: { line: 1, character: 12 } } }], señal: 'ñ' });
  }
  if (method === 'textDocument/references') {
    return send({ jsonrpc: '2.0', id, result: [
      { uri: uriOf('src/b.ts'), range: { start: { line: 1, character: 9 }, end: { line: 1, character: 12 } } },
      { uri: uriOf('src/a.ts'), range: { start: { line: 0, character: 16 }, end: { line: 0, character: 19 } } },
    ] });
  }
  if (method === 'textDocument/hover') return send({ jsonrpc: '2.0', id, result: { contents: { kind: 'markdown', value: '```ts\nfunction foo(): number\n```' } } });
  if (method === 'textDocument/documentSymbol') {
    return send({ jsonrpc: '2.0', id, result: [
      { name: 'foo', kind: 12, detail: '(): number', range: { start: { line: 1, character: 0 }, end: { line: 3, character: 1 } }, selectionRange: { start: { line: 1, character: 9 }, end: { line: 1, character: 12 } },
        children: [{ name: 'inner', kind: 13, range: { start: { line: 2, character: 2 }, end: { line: 2, character: 20 } }, selectionRange: { start: { line: 2, character: 8 }, end: { line: 2, character: 13 } } }] },
      { name: 'Bar', kind: 5, range: { start: { line: 4, character: 0 }, end: { line: 6, character: 1 } }, selectionRange: { start: { line: 4, character: 6 }, end: { line: 4, character: 9 } } },
    ] });
  }
  if (method === 'shutdown') return send({ jsonrpc: '2.0', id, result: null });
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found: ' + method } });
}
process.stdin.on('end', () => process.exit(0));

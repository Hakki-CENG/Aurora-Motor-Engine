#!/usr/bin/env node
// Minimal LSP server over stdio used by code-intelligence tests. It exercises
// the framing, initialize, notifications, pull requests, push diagnostics and
// shutdown paths without requiring a real language server installation.
import { readFileSync } from "node:fs";

let buffer = "";
const send = (message) => {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
};
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const errorReply = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

const pathOf = (uri) => decodeURIComponent(uri.slice("file://".length));

function handle(message) {
  const { id, method, params } = message;
  if (id !== undefined && method === "initialize") {
    return void reply(id, {
      capabilities: {
        textDocument: {
          publishDiagnostics: { versionSupport: true },
          definition: { linkSupport: true },
          references: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        },
      },
    });
  }
  if (method === "initialized") return;
  if (method === "textDocument/didOpen") {
    const doc = params.textDocument;
    let content = "";
    try {
      content = readFileSync(pathOf(doc.uri), "utf8");
    } catch {
      // File vanished; publish nothing.
    }
    // One publishDiagnostics per document replaces the full set (LSP semantics).
    const diagnostics = [];
    if (content.includes("TYPE_ERROR_MARKER")) {
      diagnostics.push({
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } },
        severity: 1,
        code: "TS9999",
        source: "fake-server",
        message: `Marker found\ninjected note ${"x".repeat(400)}`,
      });
    }
    if (content.includes("WARNING_MARKER")) {
      diagnostics.push({
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 4 } },
        severity: 2,
        code: "W1000",
        source: "fake-server",
        message: "A warning marker was found",
      });
    }
    if (diagnostics.length > 0) {
      send({
        jsonrpc: "2.0",
        method: "textDocument/publishDiagnostics",
        params: { uri: doc.uri, version: doc.version, diagnostics },
      });
    }
    return;
  }
  if (method === "textDocument/definition") {
    const doc = params.textDocument;
    return void reply(id, {
      uri: doc.uri,
      range: { start: { line: 2, character: 5 }, end: { line: 2, character: 9 } },
    });
  }
  if (method === "textDocument/references") {
    const doc = params.textDocument;
    return void reply(id, [
      { uri: doc.uri, range: { start: { line: 0, character: 3 }, end: { line: 0, character: 6 } } },
      { uri: doc.uri, range: { start: { line: 2, character: 5 }, end: { line: 2, character: 8 } } },
    ]);
  }
  if (method === "textDocument/documentSymbol") {
    const doc = params.textDocument;
    return void reply(id, [
      {
        name: "say",
        kind: 12,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
        detail: "Greets callers",
        children: [],
      },
    ]);
  }
  if (method === "workspace/symbol") {
    return void reply(id, [{ name: "say", kind: 12, location: { uri: "file:///nowhere.ts", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } } }]);
  }
  if (method === "shutdown") return void reply(id, null);
  if (method === "exit") process.exit(0);
  if (id !== undefined) return void errorReply(id, -32601, `method not found: ${method}`);
}

process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) break;
    const headers = buffer.slice(0, headerEnd);
    const match = /Content-Length:\s*(\d+)/i.exec(headers);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) break;
    const body = buffer.slice(start, start + length);
    buffer = buffer.slice(start + length);
    try {
      handle(JSON.parse(body));
    } catch {
      // Tests must not hang on a malformed client frame.
    }
  }
});

// A tiny stdio MCP server with a made-up name, `example-notes`, for the `mcp-live` scenario of
// probe.ts (ticket worfy-mcp-live/01). No dependencies: newline-delimited JSON-RPC with
// `initialize`, `tools/list` and `tools/call`. One tool, `notes_list`, that returns a fixed text.
// The scenario writes this server into the sandbox config with `claude mcp add` while a query runs,
// to see which control call makes the running query pick it up.
import { createInterface } from 'node:readline'
import process from 'node:process'

const tool = { name: 'notes_list', description: 'Spike tool of the example-notes server. Returns a fixed list.', inputSchema: { type: 'object', properties: {} } }

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`)

createInterface({ input: process.stdin }).on('line', (line) => {
  let req
  try {
    req = JSON.parse(line)
  } catch {
    return
  }
  if (req.id === undefined || req.id === null) return // a notification
  if (req.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: req.id,
      result: { protocolVersion: req.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'example-notes', version: '0.0.1' } },
    })
  } else if (req.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: req.id, result: { tools: [tool] } })
  } else if (req.method === 'tools/call') {
    send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: 'note 1, note 2' }] } })
  } else {
    send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `unknown method ${req.method}` } })
  }
})

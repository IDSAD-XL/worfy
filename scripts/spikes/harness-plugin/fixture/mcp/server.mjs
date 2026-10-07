// A tiny stdio MCP server for the spike (ticket worfy-harness/01), no dependencies: newline-
// delimited JSON-RPC with `initialize`, `tools/list` and `tools/call`. One tool,
// `<flavor>_ping`, where the flavor is the first argument (`plugin` by default). The spike also
// registers this file as the user's own `qmd` with the flavor `user`, so the tool names show
// which of the two servers a session reached.
import { createInterface } from 'node:readline'
import process from 'node:process'

const flavor = process.argv[2] ?? 'plugin'
const tool = { name: `${flavor}_ping`, description: `Spike tool of the ${flavor} qmd server. Returns pong.`, inputSchema: { type: 'object', properties: {} } }

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
      result: { protocolVersion: req.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: `worfy-spike-qmd-${flavor}`, version: '0.0.1' } },
    })
  } else if (req.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: req.id, result: { tools: [tool] } })
  } else if (req.method === 'tools/call') {
    send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: `pong from ${flavor}` }] } })
  } else {
    send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `unknown method ${req.method}` } })
  }
})

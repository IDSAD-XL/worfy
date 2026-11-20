// A stand-in of a stdio MCP server for the proxy tests of the worfy-integrations Epic (ticket 06). It reads its secret
// from the environment variable STUB_API_KEY, as a real server reads its API key, and answers newline-delimited
// JSON-RPC on stdin: `initialize`, `tools/list` with one tool, `whoami`, and its call, which names the dataset the key
// opens (`alpha` for `stdio-alpha-key`, `none` otherwise), whether the key came in its arguments, which it never
// should, and the first folder of its PATH. It prints no secret.
import { delimiter } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'

const DATASETS = { 'stdio-alpha-key': 'alpha' }
const key = process.env.STUB_API_KEY
const dataset = (key !== undefined && DATASETS[key]) || 'none'
const keyInArgs = key !== undefined && process.argv.some((arg) => arg.includes(key))

const answer = (message) => {
  switch (message.method) {
    case 'initialize':
      return { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: `stdio-stub-${dataset}`, version: '1.0.0' } }
    case 'tools/list':
      return { tools: [{ name: 'whoami', description: 'The dataset of this key', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] }
    case 'tools/call':
      return { content: [{ type: 'text', text: `dataset ${dataset}; keyInArgs=${keyInArgs}; args=${process.argv.length - 2}; firstPath=${(process.env.PATH ?? '').split(delimiter)[0]}` }] }
    default:
      return {}
  }
}

const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: answer(message) })}\n`)
})
lines.on('close', () => process.exit(0))

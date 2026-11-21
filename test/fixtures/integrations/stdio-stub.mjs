// A stand-in of a stdio MCP server for the tests of the worfy-integrations Epic (ticket 04). It reads its secret
// from the environment variable STUB_API_KEY, as a real server reads its API key, and answers newline-delimited
// JSON-RPC on stdin: `initialize` names the dataset the key opens (`alpha` for `stdio-alpha-key`) or `none`, and
// whether the key came in its arguments, which it never should. It prints no secret.
import process from 'node:process'
import { createInterface } from 'node:readline'

const DATASETS = { 'stdio-alpha-key': 'alpha' }
const key = process.env.STUB_API_KEY
const dataset = (key !== undefined && DATASETS[key]) || 'none'
const keyInArgs = key !== undefined && process.argv.some((arg) => arg.includes(key))

const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  const result =
    message.method === 'initialize'
      ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: `stub-${dataset}`, version: '1.0.0' }, instructions: `keyInArgs=${keyInArgs}` }
      : {}
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`)
})
lines.on('close', () => process.exit(0))

// A stand-in of a stdio MCP server for the proxy tests of the worfy-integrations Epic (ticket 06). It reads its secret
// from the environment variable STUB_API_KEY, as a real server reads its API key, and answers newline-delimited
// JSON-RPC on stdin: `initialize`, `tools/list` with two tools, and their calls. `whoami` names the dataset the key
// opens (`alpha` for `stdio-alpha-key`, `none` otherwise), whether the key came in its arguments, which it never
// should, and the first folder of its PATH. `slow` answers after `ms` milliseconds with the process id, so a test
// tells whether the same process answered. With STUB_SPAWN_LOG set, each start appends its process id to that file —
// a test counts the processes worfy started — and each `slow` call `slow <pid>`. It prints no secret.
import { appendFileSync } from 'node:fs'
import { delimiter } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { setTimeout } from 'node:timers'

const DATASETS = { 'stdio-alpha-key': 'alpha' }
const key = process.env.STUB_API_KEY
const dataset = (key !== undefined && DATASETS[key]) || 'none'
const keyInArgs = key !== undefined && process.argv.some((arg) => arg.includes(key))
if (process.env.STUB_SPAWN_LOG) appendFileSync(process.env.STUB_SPAWN_LOG, `${process.pid}\n`)

const TOOLS = [
  { name: 'whoami', description: 'The dataset of this key', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
  { name: 'slow', description: 'Answers after ms milliseconds', inputSchema: { type: 'object', properties: { ms: { type: 'number' } } }, annotations: { readOnlyHint: true } },
]

const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
const text = (value) => ({ content: [{ type: 'text', text: value }] })

const answer = (message) => {
  switch (message.method) {
    case 'initialize':
      return reply(message.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: `stdio-stub-${dataset}`, version: '1.0.0' } })
    case 'tools/list':
      return reply(message.id, { tools: TOOLS })
    case 'tools/call':
      if (message.params?.name === 'slow') {
        if (process.env.STUB_SPAWN_LOG) appendFileSync(process.env.STUB_SPAWN_LOG, `slow ${process.pid}\n`)
        setTimeout(() => reply(message.id, text(`slow done pid=${process.pid}`)), Number(message.params.arguments?.ms ?? 0))
        return undefined
      }
      return reply(message.id, text(`dataset ${dataset}; keyInArgs=${keyInArgs}; args=${process.argv.length - 2}; firstPath=${(process.env.PATH ?? '').split(delimiter)[0]}; pid=${process.pid}`))
    default:
      return reply(message.id, {})
  }
}

const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  answer(message)
})
lines.on('close', () => process.exit(0))

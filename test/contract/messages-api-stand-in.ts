// A local stand-in of the Anthropic Messages API for running the real Claude Code (the Agent SDK's
// own binary) without a model: the first request that offers the tool gets a scripted tool_use of
// it, the request that carries that tool's result is recorded and gets a short text answer, every
// other request (a title, a count of tokens) a short text. Nothing leaves the machine:
// ANTHROPIC_BASE_URL points Claude Code here, and the environment it gets (claudeEnv) has no key
// of the user, a HOME of its own and no non-essential traffic.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

const MODEL = 'claude-sonnet-4-5'

/** The tool call the stand-in makes the "model" write. */
export interface ScriptedToolUse {
  id: string
  name: string
  input: Record<string, unknown>
}

/** The tool_result block Claude Code sent back for the scripted call. */
export interface RecordedToolResult {
  content: unknown
  is_error?: boolean
}

export interface MessagesApiStandIn {
  url: string
  /** The tool's result as Claude Code reported it to the model; null until it came. */
  toolResult(): RecordedToolResult | null
  /** Whether a request offered the scripted tool at all. */
  offered(): boolean
  close(): Promise<void>
}

type Block = Record<string, unknown>

function sse(res: ServerResponse, events: Block[]): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const event of events) res.write(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
  res.end()
}

const messageStart = (id: string): Block => ({
  type: 'message_start',
  message: { id, type: 'message', role: 'assistant', model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } },
})

function text(res: ServerResponse, stream: boolean, said: string): void {
  if (!stream) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({ id: 'msg_text', type: 'message', role: 'assistant', model: MODEL, content: [{ type: 'text', text: said }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 3 } }),
    )
    return
  }
  sse(res, [
    messageStart('msg_text'),
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: said } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } },
    { type: 'message_stop' },
  ])
}

function toolUse(res: ServerResponse, call: ScriptedToolUse): void {
  sse(res, [
    messageStart('msg_tool'),
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: call.id, name: call.name, input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.input) } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
  ])
}

async function body(req: IncomingMessage): Promise<Block> {
  let raw = ''
  for await (const chunk of req) raw += String(chunk)
  try {
    return JSON.parse(raw) as Block
  } catch {
    return {}
  }
}

export async function startMessagesApiStandIn(call: ScriptedToolUse): Promise<MessagesApiStandIn> {
  let recorded: RecordedToolResult | null = null
  let offered = false
  const server: Server = createServer((req, res) => {
    void body(req).then((json) => {
      const url = req.url ?? ''
      if (!url.startsWith('/v1/messages') || url.includes('count_tokens')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ input_tokens: 10 }))
        return
      }
      const stream = json.stream === true
      const messages = Array.isArray(json.messages) ? (json.messages as Block[]) : []
      const last = messages.at(-1)
      const content = Array.isArray(last?.content) ? (last.content as Block[]) : []
      const result = content.find((block) => block.type === 'tool_result' && block.tool_use_id === call.id)
      if (result !== undefined) {
        recorded = { content: result.content, ...(result.is_error === true ? { is_error: true } : {}) }
        text(res, stream, 'done')
        return
      }
      const tools = Array.isArray(json.tools) ? (json.tools as Block[]).map((tool) => tool.name) : []
      if (tools.includes(call.name) && recorded === null) {
        offered = true
        toolUse(res, call)
        return
      }
      text(res, stream, 'ok')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    toolResult: () => recorded,
    offered: () => offered,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/**
 * The whole environment Claude Code gets: the stand-in as its API, a key that is no key, `home` as
 * its HOME and config folder (its transcripts go there, not to ~/.claude), and no telemetry, update
 * check or other traffic of its own.
 */
export function claudeEnv(standIn: MessagesApiStandIn, home: string): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: home,
    USERPROFILE: home,
    CLAUDE_CONFIG_DIR: `${home}/.claude`,
    ANTHROPIC_BASE_URL: standIn.url,
    ANTHROPIC_API_KEY: 'sk-ant-stand-in-not-a-key',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_AUTOUPDATER: '1',
  }
  // Windows needs these to start a process at all.
  for (const name of ['SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'ComSpec']) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }
  return env
}

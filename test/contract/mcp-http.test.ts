// worfy's MCP servers over streamable HTTP (src/main/mcp/http-server.ts, worfy-multi-vendor ticket 33): the
// endpoint Codex Sessions reach `worfy-canvas` and `worfy-browser` through. It listens on 127.0.0.1 only;
// each Session has a token of its own, and a request without one, with a foreign one or with one revoked
// is answered 401 before anything runs; the token goes into no log; close() ends it all. The tools are the
// same descriptions the Claude driver serves in process (canvasServer of src/main/mcp/canvas-server.ts),
// so tools/list gives what Claude Code's server lists, and a call writes through the same LayoutStore.
//
// Requests go as an MCP client of the streamable-HTTP transport sends them: one JSON-RPC message per POST,
// with `Accept: application/json, text/event-stream`.
import { mkdirSync, mkdtempSync, realpathSync, statSync } from 'node:fs'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LayoutStore } from '../../src/main/layout/store'
import { canvasServer, createCanvasServer, type CanvasContext } from '../../src/main/mcp/canvas-server'
import { MAX_BODY_BYTES, MCP_HTTP_HOST, startMcpHttpEndpoint, type McpHttpEndpoint } from '../../src/main/mcp/http-server'
import type { McpServer } from '../../src/main/vendors/mcp'
import { CANVAS_SERVER_NAME, CANVAS_TOOL_NAMES } from '../../src/shared/canvas/tools'
import { removeTestTree } from '../remove'

const PROJECT = 'demo-0a1b2c3d'
const OTHER = 'other-11223344'

let scratch: string
let store: LayoutStore
const endpoints: McpHttpEndpoint[] = []

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-mcp-http-')))
  store = new LayoutStore((projectId) => join(scratch, 'data', projectId), { write: () => undefined })
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const endpoint of endpoints.splice(0)) await endpoint.close()
  removeTestTree(scratch)
})

const context = (projectId: string = PROJECT): CanvasContext => {
  const cardsDir = join(scratch, 'data', projectId, 'cards')
  mkdirSync(cardsDir, { recursive: true })
  return { projectId, cardsDir, layout: store, workflow: () => Promise.resolve({ epics: [], tickets: [], error: null }), sessionId: () => null }
}

async function endpoint(): Promise<McpHttpEndpoint> {
  const started = await startMcpHttpEndpoint()
  endpoints.push(started)
  return started
}

interface Answer {
  status: number
  headers: Headers
  body: { jsonrpc?: string; id?: unknown; result?: Record<string, unknown>; error?: { code: number; message: string } } | null
}

let nextId = 0

/** One POST of the transport; `token` null sends no Authorization header. */
async function post(url: string, token: string | null, message: unknown, headers: Record<string, string> = {}): Promise<Answer> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      ...headers,
    },
    body: typeof message === 'string' ? message : JSON.stringify(message),
  })
  const text = await response.text()
  return { status: response.status, headers: response.headers, body: text === '' ? null : (JSON.parse(text) as Answer['body']) }
}

const request = (url: string, token: string | null, method: string, params: unknown = {}): Promise<Answer> => post(url, token, { jsonrpc: '2.0', id: ++nextId, method, params })

const toolText = (answer: Answer): string => ((answer.body?.result?.content as { text: string }[] | undefined) ?? [])[0]?.text ?? ''

const nodesOf = (projectId: string) => store.get(projectId).layout.nodes

describe('the MCP endpoint over HTTP', () => {
  it('listens on 127.0.0.1 only, at a port it picked, and names that address in every URL', async () => {
    const at = await endpoint()
    expect(at.port).toBeGreaterThan(0)
    const grant = at.grant([canvasServer(context())])
    expect(grant.urls).toEqual({ [CANVAS_SERVER_NAME]: `http://127.0.0.1:${at.port}/mcp/${CANVAS_SERVER_NAME}` })
    expect(MCP_HTTP_HOST).toBe('127.0.0.1')
    // The IPv6 loopback and the machine's own IPv4 addresses do not answer on that port: a connection
    // to an address of this machine is refused at once. (Link-local IPv6 addresses are left out: some
    // of them never answer at all, which proves nothing.)
    const others = Object.values(networkInterfaces())
      .flat()
      .filter((each) => each !== undefined && each.family === 'IPv4' && each.address !== '127.0.0.1')
      .map((each) => each!.address)
    for (const address of ['[::1]', ...new Set(others)]) {
      await expect(fetch(`http://${address}:${at.port}/mcp/${CANVAS_SERVER_NAME}`, { method: 'POST', headers: { Authorization: `Bearer ${grant.token}` }, body: '{}' }), address).rejects.toThrow()
    }
  })

  it('with the Session\'s token: initialize, then tools/list gives the Canvas tools', async () => {
    const at = await endpoint()
    const grant = at.grant([canvasServer(context())])
    const url = grant.urls[CANVAS_SERVER_NAME]!
    const init = await request(url, grant.token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex', version: '0.166.0' } })
    expect(init.status).toBe(200)
    expect(init.headers.get('content-type')).toBe('application/json')
    expect(init.body).toEqual({
      jsonrpc: '2.0',
      id: nextId,
      result: { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: CANVAS_SERVER_NAME, version: '1.0.0' } },
    })
    expect((await post(url, grant.token, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)
    const list = await request(url, grant.token, 'tools/list')
    expect(list.status).toBe(200)
    const tools = list.body?.result?.tools as { name: string; inputSchema: { type: string } }[]
    expect(tools.map((tool) => tool.name).sort()).toEqual([...CANVAS_TOOL_NAMES].sort())
    for (const tool of tools) expect(tool.inputSchema.type).toBe('object')
    expect((await request(url, grant.token, 'ping')).body?.result).toEqual({})
  })

  it('answers a version it does not know with its newest', async () => {
    const at = await endpoint()
    const grant = at.grant([canvasServer(context())])
    const init = await request(grant.urls[CANVAS_SERVER_NAME]!, grant.token, 'initialize', { protocolVersion: '1999-01-01', capabilities: {}, clientInfo: { name: 'x', version: '1' } })
    expect(init.body?.result?.protocolVersion).toBe('2025-11-25')
  })

  it('lists the same tools, descriptions and input schemas as Claude Code\'s server in process', async () => {
    const at = await endpoint()
    const ctx = context()
    const grant = at.grant([canvasServer(ctx)])
    const overHttp = (await request(grant.urls[CANVAS_SERVER_NAME]!, grant.token, 'tools/list')).body?.result?.tools as { name: string; description: string; inputSchema: Record<string, unknown> }[]
    const inProcess = (await inProcessTools(await createCanvasServer(ctx))) as typeof overHttp
    const comparable = (tools: typeof overHttp) =>
      tools
        // The JSON Schema draft named in `$schema` may differ; what the agent sees of the arguments may not.
        .map(({ name, description, inputSchema }) => ({ name, description, properties: inputSchema.properties, required: inputSchema.required ?? [] }))
        .sort((a, b) => a.name.localeCompare(b.name))
    expect(comparable(overHttp)).toEqual(comparable(inProcess))
  })

  it('without a token, with another scheme, with a token never given or one revoked: 401, and nothing runs', async () => {
    const at = await endpoint()
    const grant = at.grant([canvasServer(context())])
    const url = grant.urls[CANVAS_SERVER_NAME]!
    const create = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_card', arguments: { title: 'Nope' } } }
    const refused = [
      await post(url, null, create),
      await post(url, null, create, { Authorization: `Basic ${grant.token}` }),
      await post(url, null, create, { Authorization: 'Bearer ' }),
      await post(url, 'a-token-never-given', create),
      await post(url, `${grant.token}x`, create),
      await post(url, grant.token.toUpperCase() === grant.token ? grant.token.toLowerCase() : grant.token.toUpperCase(), create),
    ]
    grant.revoke()
    refused.push(await post(url, grant.token, create))
    for (const answer of refused) {
      expect(answer.status).toBe(401)
      expect(answer.headers.get('www-authenticate')).toBe('Bearer')
      expect(answer.body?.result).toBeUndefined()
    }
    // A GET without a token is refused the same way, before the method is looked at.
    expect((await fetch(url)).status).toBe(401)
    expect(nodesOf(PROJECT)).toEqual([])
    grant.revoke()
  })

  it('a token reaches only its own Session\'s servers: each creates its Card in its own Project', async () => {
    const at = await endpoint()
    const a = at.grant([canvasServer(context(PROJECT))])
    const b = at.grant([canvasServer(context(OTHER))])
    expect(a.token).not.toBe(b.token)
    // The URL is the same for both: the token, not the path, says whose servers answer.
    expect(a.urls).toEqual(b.urls)
    const url = a.urls[CANVAS_SERVER_NAME]!
    expect(JSON.parse(toolText(await request(url, a.token, 'tools/call', { name: 'create_card', arguments: { title: 'Of A' } })))).toMatchObject({ title: 'Of A' })
    expect(JSON.parse(toolText(await request(url, b.token, 'tools/call', { name: 'create_card', arguments: { title: 'Of B' } })))).toMatchObject({ title: 'Of B' })
    expect(nodesOf(PROJECT).map((node) => node.data.title)).toEqual(['Of A'])
    expect(nodesOf(OTHER).map((node) => node.data.title)).toEqual(['Of B'])
    a.revoke()
    expect((await request(url, a.token, 'tools/list')).status).toBe(401)
    expect((await request(url, b.token, 'tools/list')).status).toBe(200)
  })

  it('create_card makes the Card folder and its Node, as the server in process does; a refusal is a tool error', async () => {
    const at = await endpoint()
    const ctx = context()
    const grant = at.grant([canvasServer(ctx)])
    const url = grant.urls[CANVAS_SERVER_NAME]!
    const created = await request(url, grant.token, 'tools/call', { name: 'create_card', arguments: { title: 'Clock' } })
    expect(created.status).toBe(200)
    expect(created.body?.result?.isError).toBeUndefined()
    const card = JSON.parse(toolText(created)) as { id: string; folder: string; title: string }
    expect(card.title).toBe('Clock')
    expect(card.folder).toBe(join(ctx.cardsDir, card.id))
    expect(statSync(card.folder).isDirectory()).toBe(true)
    expect(nodesOf(PROJECT)).toEqual([expect.objectContaining({ id: card.id, kind: 'card', data: expect.objectContaining({ title: 'Clock' }) })])
    const refused = await request(url, grant.token, 'tools/call', { name: 'move_node', arguments: { id: 'no-such-node', x: 0, y: 0 } })
    expect(refused.status).toBe(200)
    expect(refused.body?.result?.isError).toBe(true)
    const invalid = await request(url, grant.token, 'tools/call', { name: 'create_card', arguments: { title: 42 } })
    expect(invalid.body?.result?.isError).toBe(true)
    expect(toolText(invalid)).toMatch(/^Invalid arguments for create_card/)
  })

  it('the edges of the transport: GET 405, an unknown server 404, bad JSON 400, a batch, an unknown method or tool, a body too large 413', async () => {
    const at = await endpoint()
    const grant = at.grant([canvasServer(context())])
    const url = grant.urls[CANVAS_SERVER_NAME]!
    const auth = { Authorization: `Bearer ${grant.token}` }
    const get = await fetch(url, { headers: { ...auth, Accept: 'text/event-stream' } })
    expect(get.status).toBe(405)
    expect(get.headers.get('allow')).toBe('POST')
    expect((await fetch(url, { method: 'DELETE', headers: auth })).status).toBe(405)
    expect((await request(`http://127.0.0.1:${at.port}/mcp/worfy-browser`, grant.token, 'tools/list')).status).toBe(404)
    expect((await request(`http://127.0.0.1:${at.port}/`, grant.token, 'tools/list')).status).toBe(404)
    const bad = await post(url, grant.token, '{not json')
    expect(bad.status).toBe(400)
    expect(bad.body?.error?.code).toBe(-32700)
    expect((await request(url, grant.token, 'resources/list')).body?.error?.code).toBe(-32601)
    expect((await request(url, grant.token, 'tools/call', { name: 'no_such_tool', arguments: {} })).body?.error?.code).toBe(-32602)
    // An answer of the client is taken and not answered.
    expect((await post(url, grant.token, { jsonrpc: '2.0', id: 7, result: {} })).status).toBe(202)
    expect((await post(url, grant.token, { jsonrpc: '2.0', id: 8 })).body?.error?.code).toBe(-32600)
    const batch = await post(url, grant.token, [
      { jsonrpc: '2.0', id: 'a', method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 'b', method: 'tools/list' },
    ])
    expect(batch.status).toBe(200)
    expect((batch.body as unknown as { id: string }[]).map((each) => each.id)).toEqual(['a', 'b'])
    const large = await post(url, grant.token, JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'create_note', arguments: { text: 'x'.repeat(MAX_BODY_BYTES) } } }))
    expect(large.status).toBe(413)
    expect(nodesOf(PROJECT)).toEqual([])
  })

  it('a request with an Origin header — a web page\'s — is answered 403, with the token or without, and nothing runs', async () => {
    const at = await endpoint()
    const grant = at.grant([canvasServer(context())])
    const url = grant.urls[CANVAS_SERVER_NAME]!
    for (const origin of ['http://evil.example', 'http://127.0.0.1:5173', 'null']) {
      const created = await post(url, grant.token, { jsonrpc: '2.0', id: ++nextId, method: 'tools/call', params: { name: 'create_card', arguments: { title: 'From a page' } } }, { Origin: origin })
      expect(created.status, origin).toBe(403)
      expect(created.body?.result, origin).toBeUndefined()
      expect((await post(url, null, { jsonrpc: '2.0', id: ++nextId, method: 'tools/list' }, { Origin: origin })).status, origin).toBe(403)
    }
    expect(nodesOf(PROJECT)).toEqual([])
    // The same request without Origin, as Codex sends it, goes through.
    expect((await request(url, grant.token, 'tools/call', { name: 'create_card', arguments: { title: 'From Codex' } })).status).toBe(200)
    expect(nodesOf(PROJECT)).toHaveLength(1)
  })

  it('close() ends every token and stops listening', async () => {
    const at = await endpoint()
    const grant = at.grant([canvasServer(context())])
    const url = grant.urls[CANVAS_SERVER_NAME]!
    expect((await request(url, grant.token, 'tools/list')).status).toBe(200)
    await at.close()
    await expect(request(url, grant.token, 'tools/list')).rejects.toThrow()
  })

  it('puts the token in no log, whatever the requests', async () => {
    const lines: string[] = []
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' ')))
    const throwing: McpServer = {
      name: CANVAS_SERVER_NAME,
      version: '1.0.0',
      tools: [
        { name: 'boom', description: 'Throws', shape: {}, call: () => Promise.reject(new Error('it broke')) },
        // A result JSON cannot carry: the request fails past the tool, the one path that writes a log line.
        { name: 'bigint', description: 'Answers what does not serialize', shape: {}, call: () => Promise.resolve({ content: [{ type: 'text', text: 'big' }], size: 1n }) },
      ],
    }
    const at = await endpoint()
    const grant = at.grant([throwing])
    const url = grant.urls[CANVAS_SERVER_NAME]!
    const thrown = await request(url, grant.token, 'tools/call', { name: 'boom', arguments: {} })
    expect(thrown.body?.result).toEqual({ content: [{ type: 'text', text: 'it broke' }], isError: true })
    const failed = await request(url, grant.token, 'tools/call', { name: 'bigint', arguments: {} })
    expect(failed.status).toBe(500)
    expect(failed.body?.error?.message).toBe('Internal error')
    expect(lines.filter((line) => line.startsWith('[mcp-http] a request failed'))).toHaveLength(1)
    await request(url, `${grant.token}-wrong`, 'tools/list')
    await post(url, grant.token, '{not json')
    await post(url, grant.token, 'x'.repeat(MAX_BODY_BYTES + 1))
    grant.revoke()
    await request(url, grant.token, 'tools/list')
    for (const line of lines) expect(line).not.toContain(grant.token)
  })
})

/** The tools/list of Claude Code's server in process, over an in-memory transport. */
async function inProcessTools(config: Awaited<ReturnType<typeof createCanvasServer>>): Promise<unknown> {
  let answer: ((message: { result?: { tools?: unknown } }) => void) | undefined
  const transport: { onmessage?: (message: unknown) => void; start(): Promise<void>; close(): Promise<void>; send(message: { id?: number; result?: { tools?: unknown } }): Promise<void> } = {
    start: () => Promise.resolve(),
    close: () => Promise.resolve(),
    send: (message) => {
      if (message.id !== undefined) answer?.(message)
      return Promise.resolve()
    },
  }
  await config.instance.connect(transport as never)
  const ask = (id: number, method: string, params: unknown) =>
    new Promise<{ result?: { tools?: unknown } }>((resolve) => {
      answer = resolve
      transport.onmessage?.({ jsonrpc: '2.0', id, method, params })
    })
  await ask(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
  transport.onmessage?.({ jsonrpc: '2.0', method: 'notifications/initialized' })
  return (await ask(2, 'tools/list', {})).result?.tools
}

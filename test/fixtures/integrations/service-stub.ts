// A stand-in of a service's MCP server for the proxy tests of the worfy-integrations Epic (ticket 06): streamable
// HTTP on 127.0.0.1, answers in JSON, a session id from `initialize` that every later request must carry. Each Bearer
// token it knows opens a dataset of its own (`alpha`, `beta`…), so two Integrations on one address tell themselves
// apart by what the server answers. Its tools: `whoami` and `list_items` marked read-only, `create_item` that writes,
// `picture` that answers a text, an image and a link to a resource, `careless` that quotes the credential it got —
// the way a careless service does — and `broken`, whose call fails with an HTTP error that quotes it too. A token the
// test revokes gets 401 from then on; expireSessions() forgets every session, so the next request gets 404 as the
// protocol says. Its log names the dataset, never the credential.
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface StubTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: Record<string, unknown>
}

export const STUB_TOOLS: readonly StubTool[] = [
  { name: 'whoami', description: 'The dataset of this sign-in', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  {
    name: 'list_items',
    description: 'The items of the dataset',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_item',
    description: 'Creates an item',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
    annotations: { readOnlyHint: false },
  },
  { name: 'picture', description: 'A picture and a link', inputSchema: { type: 'object' } },
  { name: 'careless', description: 'Quotes the credential back', inputSchema: { type: 'object' } },
  { name: 'broken', description: 'Fails with an HTTP error', inputSchema: { type: 'object' } },
]

export interface ServiceStubOptions {
  /** Bearer token → dataset. */
  bearer: Record<string, string>
  /** The tools the stub lists; STUB_TOOLS by default. */
  tools?: readonly StubTool[]
}

export interface ServiceLogEntry {
  method: string
  /** The dataset the credential opened; `unauthorized` when it opened none, `expired` for an unknown session. */
  dataset: string
}

export interface ServiceStub {
  /** The MCP endpoint: http://127.0.0.1:<port>/mcp. */
  url: string
  log: ServiceLogEntry[]
  /** How many times each dataset was initialized: one connection is one `initialize`. */
  initialized(dataset: string): number
  /** The token gets 401 from now on. */
  revoke(token: string): void
  /** Every session is forgotten: the next request with one gets 404. */
  expireSessions(): void
  close(): Promise<void>
}

const PROTOCOL_VERSION = '2025-06-18'

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': 'application/json', ...headers })
  response.end(JSON.stringify(body))
}

/** A 1×1 transparent PNG. */
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

function toolAnswer(name: string, dataset: string, authorization: string): Record<string, unknown> {
  switch (name) {
    case 'whoami':
      return { content: [{ type: 'text', text: `dataset ${dataset}` }] }
    case 'list_items':
      return { content: [{ type: 'text', text: `items of ${dataset}` }] }
    case 'create_item':
      return { content: [{ type: 'text', text: `created in ${dataset}` }] }
    case 'picture':
      return {
        content: [
          { type: 'text', text: `picture of ${dataset}` },
          { type: 'image', data: PIXEL, mimeType: 'image/png' },
          { type: 'resource_link', uri: `stub://${dataset}/item/1`, name: 'item 1', mimeType: 'text/plain' },
        ],
      }
    case 'careless':
      return { content: [{ type: 'text', text: `you sent ${authorization}` }] }
    default:
      return { content: [{ type: 'text', text: `no tool ${name}` }], isError: true }
  }
}

/** Starts the stub on a free port of 127.0.0.1. */
export async function startServiceStub(options: ServiceStubOptions): Promise<ServiceStub> {
  const log: ServiceLogEntry[] = []
  const revoked = new Set<string>()
  const sessions = new Map<string, string>()
  const tools = options.tools ?? STUB_TOOLS
  const server = createServer((request, response) => {
    void (async () => {
      if (request.url !== '/mcp') return json(response, 404, { error: 'not found' })
      const authorization = request.headers.authorization ?? ''
      const bearer = /^Bearer (.+)$/u.exec(authorization)?.[1]
      const dataset = bearer === undefined || revoked.has(bearer) ? undefined : options.bearer[bearer]
      if (request.method === 'GET') return json(response, 405, { error: 'method not allowed' })
      if (request.method === 'DELETE') {
        const session = request.headers['mcp-session-id']
        if (typeof session === 'string') sessions.delete(session)
        response.writeHead(200)
        return response.end()
      }
      if (request.method !== 'POST') return json(response, 405, { error: 'method not allowed' })
      const message = JSON.parse(await bodyOf(request)) as { id?: number | string; method: string; params?: { name?: string } }
      if (dataset === undefined) {
        log.push({ method: message.method, dataset: 'unauthorized' })
        return json(response, 401, { error: 'invalid_token', error_description: 'The token is not valid' }, { 'www-authenticate': 'Bearer error="invalid_token"' })
      }
      if (message.method !== 'initialize') {
        const session = request.headers['mcp-session-id']
        if (typeof session !== 'string' || sessions.get(session) !== dataset) {
          log.push({ method: message.method, dataset: 'expired' })
          return json(response, 404, { jsonrpc: '2.0', id: message.id ?? null, error: { code: -32001, message: 'Session not found' } })
        }
      }
      log.push({ method: message.method, dataset })
      if (message.id === undefined) {
        response.writeHead(202)
        return response.end()
      }
      if (message.method === 'initialize') {
        const session = randomUUID()
        sessions.set(session, dataset)
        return json(
          response,
          200,
          { jsonrpc: '2.0', id: message.id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: `stub-${dataset}`, version: '1.0.0' } } },
          { 'mcp-session-id': session },
        )
      }
      if (message.method === 'tools/list') return json(response, 200, { jsonrpc: '2.0', id: message.id, result: { tools } })
      if (message.method === 'tools/call') {
        const name = message.params?.name ?? ''
        if (name === 'broken') return json(response, 500, { error: 'internal', error_description: `failed for ${authorization}` })
        return json(response, 200, { jsonrpc: '2.0', id: message.id, result: toolAnswer(name, dataset, authorization) })
      }
      return json(response, 200, { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `no method ${message.method}` } })
    })().catch((error: unknown) => {
      if (!response.headersSent) json(response, 500, { error: String(error) })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    log,
    initialized: (dataset) => log.filter((entry) => entry.method === 'initialize' && entry.dataset === dataset).length,
    revoke: (token) => void revoked.add(token),
    expireSessions: () => sessions.clear(),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error === undefined ? resolve() : reject(error)))
      }),
  }
}

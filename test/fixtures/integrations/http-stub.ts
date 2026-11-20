// A stand-in of a service's MCP server for the tests of the worfy-integrations Epic (ticket 04): streamable HTTP on
// 127.0.0.1, answers in JSON. Each credential it knows opens a dataset of its own (`alpha`, `beta`…), so two
// Integrations on one address tell themselves apart by what the server answers. It checks a Bearer token, Basic of
// an e-mail and a token, and a header of its own; a credential listed under `forbidden` gets 403 with that text.
// Its log names the dataset or the refusal, never the credential.
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface HttpStubOptions {
  /** Bearer token → dataset. */
  bearer?: Record<string, string>
  /** `e-mail:token` → dataset, sent as Basic. */
  basic?: Record<string, string>
  /** A header of the stub's own and its value → dataset. */
  header?: { name: string; values: Record<string, string> }
  /** Bearer token → the text of a 403 answer. */
  forbidden?: Record<string, string>
}

export interface StubLogEntry {
  method: string
  /** The dataset the credential opened; `unauthorized` or `forbidden` when it opened none. */
  dataset: string
}

export interface HttpStub {
  /** The MCP endpoint: http://127.0.0.1:<port>/mcp. */
  url: string
  log: StubLogEntry[]
  /** Session ids the server gave out and that were not ended with DELETE yet. */
  openSessions: Set<string>
  close(): Promise<void>
}

const PROTOCOL_VERSION = '2025-06-18'

function datasetOf(request: IncomingMessage, options: HttpStubOptions): { dataset: string } | { forbidden: string } | null {
  const authorization = request.headers.authorization ?? ''
  const bearer = /^Bearer (.+)$/u.exec(authorization)?.[1]
  if (bearer !== undefined) {
    const forbidden = options.forbidden?.[bearer]
    if (forbidden !== undefined) return { forbidden }
    const dataset = options.bearer?.[bearer]
    if (dataset !== undefined) return { dataset }
  }
  const basic = /^Basic (.+)$/u.exec(authorization)?.[1]
  if (basic !== undefined) {
    const dataset = options.basic?.[Buffer.from(basic, 'base64').toString('utf8')]
    if (dataset !== undefined) return { dataset }
  }
  if (options.header !== undefined) {
    const value = request.headers[options.header.name.toLowerCase()]
    const dataset = typeof value === 'string' ? options.header.values[value] : undefined
    if (dataset !== undefined) return { dataset }
  }
  return null
}

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': 'application/json', ...headers })
  response.end(JSON.stringify(body))
}

/** Starts the stub on a free port of 127.0.0.1. */
export async function startHttpStub(options: HttpStubOptions): Promise<HttpStub> {
  const log: StubLogEntry[] = []
  const openSessions = new Set<string>()
  const server = createServer((request, response) => {
    void (async () => {
      if (request.url !== '/mcp') return json(response, 404, { error: 'not found' })
      const opened = datasetOf(request, options)
      if (request.method === 'DELETE') {
        const session = request.headers['mcp-session-id']
        if (typeof session === 'string') openSessions.delete(session)
        response.writeHead(opened !== null && 'dataset' in opened ? 200 : 401)
        return response.end()
      }
      if (request.method !== 'POST') return json(response, 405, { error: 'method not allowed' })
      const message = JSON.parse(await bodyOf(request)) as { id?: number | string; method: string }
      if (opened === null) {
        log.push({ method: message.method, dataset: 'unauthorized' })
        return json(response, 401, { error: 'invalid_token', error_description: 'The token is not valid' }, { 'www-authenticate': 'Bearer error="invalid_token"' })
      }
      if ('forbidden' in opened) {
        log.push({ method: message.method, dataset: 'forbidden' })
        return json(response, 403, { error: 'forbidden', error_description: opened.forbidden })
      }
      log.push({ method: message.method, dataset: opened.dataset })
      if (message.id === undefined) {
        response.writeHead(202)
        return response.end()
      }
      if (message.method === 'initialize') {
        const session = randomUUID()
        openSessions.add(session)
        return json(
          response,
          200,
          { jsonrpc: '2.0', id: message.id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: `stub-${opened.dataset}`, version: '1.0.0' } } },
          { 'mcp-session-id': session },
        )
      }
      if (message.method === 'tools/list') {
        return json(response, 200, { jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'whoami', description: 'The dataset of this sign-in', inputSchema: { type: 'object' } }] } })
      }
      if (message.method === 'tools/call') {
        return json(response, 200, { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: `dataset ${opened.dataset}` }] } })
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
    openSessions,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error === undefined ? resolve() : reject(error)))
      }),
  }
}

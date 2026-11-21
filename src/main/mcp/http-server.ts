// worfy's MCP servers over streamable HTTP (worfy-multi-vendor ticket 33; ADR-0094 item 2, the mcp part):
// for a Vendor whose agent runs in a process of its own and cannot take an SDK server in worfy's process
// (Codex). One endpoint in worfy main serves the servers of every such Session; canvas-server.ts and
// browser-server.ts describe them (McpServer, src/main/vendors/mcp.ts), the same descriptions the Claude
// driver serves in process.
//
// The walls:
// - it listens on 127.0.0.1 only, on a free port picked when it starts;
// - each Session gets a token of its own (grant()), and the token is the only key: a request without it,
//   with another scheme, with a token never granted or one revoked is answered 401 before anything else
//   is read. A Session reaches only its own servers: the token, not the path, says whose they are. A
//   token is kept only as its SHA-256, so a lookup compares digests, never the secret itself;
// - a request that carries an Origin header — what a web page's request does, never Codex's — is answered
//   403 before anything else: a page in a browser of this Machine reaches no tool, whatever name its
//   host resolves to (DNS rebinding), as MCP's streamable-HTTP transport asks of a server;
// - the token is never logged: nothing here writes a header or a body anywhere;
// - a body is read up to MAX_BODY_BYTES, then the request is answered 413;
// - close() ends every token and every connection; the app's endpoint closes in `will-quit`.
//
// The protocol is the stateless part of MCP's streamable HTTP transport: every JSON-RPC message is a POST
// to the server's URL, answered with `application/json` (a batch with an array); a notification or an
// answer of the client is answered 202. No Mcp-Session-Id is given and no server-to-client stream is
// opened: a GET is answered 405, which the transport allows. Methods: initialize, ping, tools/list and
// tools/call; any other request gets "method not found".
//
// worfy-integrations ticket 07: a server whose tools come from elsewhere — an Integration's server of the proxy
// (src/main/integrations/proxy.ts), the same McpServer the Claude driver serves — answers tools/list with its
// listTools(), whose list the Project's tools filter cut and whose descriptions lead with the label, and a tools/call
// goes to the tool of that name in that list: a tool the filter cut is refused here, before the service. A rejected
// listTools() («Sign-in needed: …», with no list known) is a JSON-RPC error with its message.
//
// The agent's cancel reaches the call (the review of ticket 07): each tools/call gets a signal, as a Claude Session's
// does (src/main/vendors/claude/mcp.ts), aborted when the request's connection closes before its answer — Codex gave
// up on it: Stop, the Session closed, its own time limit — or when the same Session sends notifications/cancelled
// with the call's id to the same server. The proxy hands the signal to the service, so a call the agent abandoned is
// not done after the agent got its error.
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mcpInputSchema, type McpServer, type McpTool, type McpToolResult } from '../vendors/mcp'

/** The only address the endpoint listens on. */
export const MCP_HTTP_HOST = '127.0.0.1'

/** The largest body read; past it the request is answered 413. A Card's text goes through tools/call. */
export const MAX_BODY_BYTES = 8 * 1024 * 1024

/** The versions of MCP whose tools part this endpoint speaks, newest first: a client's own is answered back. */
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

/** JSON-RPC error codes. */
const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const INTERNAL_ERROR = -32603

/** What a Session got: its token and the URL of each of its servers. */
export interface McpGrant {
  /** The bearer token of the Session: the only key to its servers. */
  readonly token: string
  /** The URL of each server, by the server's name. */
  readonly urls: Readonly<Record<string, string>>
  /** Ends the token: every later request with it is answered 401. Calling it again does nothing. */
  revoke(): void
}

export interface McpHttpEndpoint {
  /** The port it listens on, on MCP_HTTP_HOST. */
  readonly port: number
  /** A new token for the servers of one Session; the names of `servers` are unique. */
  grant(servers: readonly McpServer[]): McpGrant
  /** Ends every token and connection and stops listening. */
  close(): Promise<void>
}

type JsonRpcId = string | number | null

interface JsonRpcAnswer {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string }
}

const digest = (token: string): string => createHash('sha256').update(token).digest('hex')

/** The bearer token of a request, or null. */
function bearerOf(request: IncomingMessage): string | null {
  const match = /^Bearer[ ]+([^\s]+)$/i.exec(request.headers.authorization ?? '')
  return match ? match[1]! : null
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const answer = (id: JsonRpcId, result: unknown): JsonRpcAnswer => ({ jsonrpc: '2.0', id, result })
const failure = (id: JsonRpcId, code: number, message: string): JsonRpcAnswer => ({ jsonrpc: '2.0', id, error: { code, message } })

/** A tool as tools/list gives it: its arguments as JSON Schema, and MCP's hints a service gave it. */
function listed(tool: McpTool): { name: string; description: string; inputSchema: unknown; annotations?: unknown } {
  return { name: tool.name, description: tool.description, inputSchema: mcpInputSchema(tool), ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }) }
}

/** The tools of `server`: its listTools() when it has one (an Integration's), else its own. */
const toolsOf = (server: McpServer): Promise<readonly McpTool[]> => (server.listTools === undefined ? Promise.resolve(server.tools) : server.listTools())

/** One tool call, with the agent's cancel; a tool that throws, which it should not, is answered as a refusal the agent reads. */
async function called(tool: McpTool, args: unknown, signal: AbortSignal): Promise<McpToolResult> {
  try {
    return await tool.call(args ?? {}, { signal })
  } catch (error) {
    return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true }
  }
}

/** The tools/call requests of one Session's server running now, by their JSON-RPC id: what notifications/cancelled finds. */
interface RunningCalls {
  /** The call `id` starts: its signal, aborted by its cancel or when the request's connection closes, and its end. */
  start(id: string | number): { signal: AbortSignal; end(): void }
  /** notifications/cancelled of the request `id`; an id no call has does nothing. */
  cancel(id: unknown): void
}

/** The answer to one JSON-RPC message for `server`; null for a notification or a client's answer. */
async function reply(server: McpServer, message: unknown, calls: RunningCalls): Promise<JsonRpcAnswer | null> {
  if (!isRecord(message)) return failure(null, INVALID_REQUEST, 'Not a JSON-RPC message')
  const id = message.id
  const hasId = typeof id === 'string' || typeof id === 'number'
  if (typeof message.method !== 'string') {
    // An answer of the client: this endpoint never asks it anything, so there is nothing to match it to.
    return 'result' in message || 'error' in message ? null : failure(hasId ? id : null, INVALID_REQUEST, 'Not a JSON-RPC message')
  }
  const params = isRecord(message.params) ? message.params : {}
  if (!hasId) {
    if (message.method === 'notifications/cancelled') calls.cancel(params.requestId)
    return null
  }
  switch (message.method) {
    case 'initialize': {
      const asked = params.protocolVersion
      return answer(id, {
        protocolVersion: typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: server.name, version: server.version },
      })
    }
    case 'ping':
      return answer(id, {})
    case 'tools/list':
    case 'tools/call': {
      let tools: readonly McpTool[]
      try {
        tools = await toolsOf(server)
      } catch (error) {
        return failure(id, INTERNAL_ERROR, error instanceof Error ? error.message : String(error))
      }
      if (message.method === 'tools/list') return answer(id, { tools: tools.map(listed) })
      const tool = tools.find((each) => each.name === params.name)
      if (tool === undefined) return failure(id, INVALID_PARAMS, `Unknown tool: ${String(params.name)}`)
      const call = calls.start(id)
      try {
        return answer(id, await called(tool, params.arguments, call.signal))
      } finally {
        call.end()
      }
    }
    default:
      return failure(id, METHOD_NOT_FOUND, `Method not found: ${message.method}`)
  }
}

/** The body of a request as text, or null when it is longer than MAX_BODY_BYTES. */
async function bodyOf(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function send(response: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  if (body === undefined) {
    response.writeHead(status, headers).end()
    return
  }
  const text = JSON.stringify(body)
  response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(text)), ...headers }).end(text)
}

/** Starts an endpoint on MCP_HTTP_HOST at a free port. */
export async function startMcpHttpEndpoint(): Promise<McpHttpEndpoint> {
  /** The servers of each live token, by the token's digest. */
  const grants = new Map<string, ReadonlyMap<string, McpServer>>()
  /** The cancels of the tools/call requests running now, by the token's digest, the server and the JSON-RPC id. */
  const running = new Map<string, AbortController>()
  const runningKey = (grant: string, server: string, id: string | number): string => JSON.stringify([grant, server, id])

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.headers.origin !== undefined) {
      request.resume()
      return send(response, 403, failure(null, INVALID_REQUEST, 'Forbidden'))
    }
    const token = bearerOf(request)
    const grant = token === null ? null : digest(token)
    const servers = grant === null ? undefined : grants.get(grant)
    if (servers === undefined) {
      // The body is not read: an unknown caller only learns that it needs a token.
      request.resume()
      return send(response, 401, failure(null, INVALID_REQUEST, 'Unauthorized'), { 'WWW-Authenticate': 'Bearer' })
    }
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    const server = path.startsWith('/mcp/') ? servers.get(path.slice('/mcp/'.length)) : undefined
    if (server === undefined) {
      request.resume()
      return send(response, 404, failure(null, INVALID_REQUEST, 'No such MCP server'))
    }
    if (request.method !== 'POST') {
      request.resume()
      return send(response, 405, failure(null, INVALID_REQUEST, 'Method not allowed'), { Allow: 'POST' })
    }
    const body = await bodyOf(request)
    if (body === null) {
      response.shouldKeepAlive = false
      return send(response, 413, failure(null, INVALID_REQUEST, 'The request is too large'))
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      return send(response, 400, failure(null, PARSE_ERROR, 'Parse error'))
    }
    const batch = Array.isArray(parsed)
    const messages: unknown[] = batch ? (parsed as unknown[]) : [parsed]
    // Codex gave up on the request: the connection closed before its answer went out.
    const abandoned = new AbortController()
    response.once('close', () => {
      if (!response.writableFinished) abandoned.abort()
    })
    const key = (id: string | number): string => runningKey(grant!, server.name, id)
    const calls: RunningCalls = {
      start: (id) => {
        const cancel = new AbortController()
        running.set(key(id), cancel)
        return {
          signal: AbortSignal.any([cancel.signal, abandoned.signal]),
          // shortcut: a reused id leaves only the newer call cancellable, redo when a client reuses ids (JSON-RPC forbids it).
          end: () => void running.delete(key(id)),
        }
      },
      cancel: (id) => {
        if (typeof id === 'string' || typeof id === 'number') running.get(key(id))?.abort()
      },
    }
    const answers = (await Promise.all(messages.map((message) => reply(server, message, calls)))).filter((each) => each !== null)
    if (answers.length === 0) return send(response, 202)
    send(response, 200, batch ? answers : answers[0])
  }

  const http = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      // Only the error's own text: never a header or a body of the request.
      console.warn('[mcp-http] a request failed', error instanceof Error ? error.message : String(error))
      if (!response.headersSent) send(response, 500, failure(null, INVALID_REQUEST, 'Internal error'))
      else response.destroy()
    })
  })
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(0, MCP_HTTP_HOST, () => {
      http.off('error', reject)
      resolve()
    })
  })
  // The endpoint never keeps the process alive by itself: the app quits, a test run ends.
  http.unref()
  const port = (http.address() as AddressInfo).port

  return {
    port,
    grant(servers) {
      const token = randomBytes(32).toString('base64url')
      const key = digest(token)
      grants.set(key, new Map(servers.map((server) => [server.name, server])))
      const urls = Object.fromEntries(servers.map((server) => [server.name, `http://${MCP_HTTP_HOST}:${port}/mcp/${server.name}`]))
      return { token, urls, revoke: () => void grants.delete(key) }
    },
    close: () =>
      new Promise<void>((resolve) => {
        grants.clear()
        http.close(() => resolve())
        http.closeAllConnections()
      }),
  }
}

let shared: Promise<McpHttpEndpoint> | null = null

/**
 * The app's endpoint, started on the first call and closed when the app quits. A start that failed is
 * tried again by the next call.
 */
export function appMcpHttpEndpoint(): Promise<McpHttpEndpoint> {
  if (shared !== null) return shared
  const starting = (async () => {
    // Electron first: an endpoint is never left listening without the `will-quit` that closes it.
    const { app } = await import('electron')
    const endpoint = await startMcpHttpEndpoint()
    app.on('will-quit', () => void endpoint.close())
    return endpoint
  })()
  shared = starting
  starting.catch(() => {
    if (shared === starting) shared = null
  })
  return starting
}

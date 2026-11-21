// A stub MCP service on 127.0.0.1 for the `integrations` scenario of probe.ts (ticket
// worfy-integrations/01). No dependencies: streamable HTTP with JSON answers only (no event stream, no
// Mcp-Session-Id), the methods `initialize`, `ping`, `tools/list` and `tools/call`.
//
// Two ways to sign in:
//   - bearer: a fixed map token -> dataset label. Every answer names the dataset of the token it came
//     with, so a caller can tell whose token a proxy used. A missing or unknown token gets 401.
//   - oauth: 401 with `resource_metadata` (RFC 9728), authorization-server metadata (RFC 8414), Dynamic
//     Client Registration, an /authorize that approves at once (302 to the redirect URI with a code),
//     PKCE S256 checked at /token, short-lived access tokens, refresh tokens (rotated or not), and a
//     revocation endpoint. expireAccess() ends every access token at once, so a test needs no clock.
//
// startEndpoint() is the stand-in of worfy's own MCP endpoint (src/main/mcp/http-server.ts): one
// address, one path per server (/mcp/<name>), one Session token for all of them. The probe routes each
// path to the proxy of one Integration.
//
// Nothing here logs a token: the request log holds the method, the path and the dataset label.
/* global URL, URLSearchParams */
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'

const sendJson = (res, code, body, headers = {}) => {
  res.writeHead(code, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

const readBody = (req) =>
  new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk.toString()))
    req.on('end', () => resolve(body))
  })

const bearerOf = (req) => {
  const header = req.headers.authorization ?? ''
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  return match ? match[1] : null
}

const listen = async (server) => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address()
  return `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
}

/** One JSON-RPC message over POST, answered with JSON; `handle(method, params)` gives the result or throws. */
async function rpc(req, res, body, handle) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'only POST' })
  let message
  try {
    message = JSON.parse(body)
  } catch {
    return sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
  }
  if (message.id === undefined || message.id === null) {
    res.writeHead(202)
    return res.end()
  }
  try {
    const result = await handle(message.method, message.params ?? {})
    sendJson(res, 200, { jsonrpc: '2.0', id: message.id, result })
  } catch (error) {
    sendJson(res, 200, { jsonrpc: '2.0', id: message.id, error: { code: error.code ?? -32603, message: error.message } })
  }
}

const notFound = (method) => Object.assign(new Error(`method not found: ${method}`), { code: -32601 })

// The text the malformed site list carries: a run that writes it anywhere has leaked a response body.
export const LEAK_MARKER = 'leakmarker-site.example.com'

/**
 * The MCP methods of the stub service for one dataset. `faults` (OAuth mode) break it on purpose:
 * `toolsList: 'fail'` answers tools/list with an error whose text holds LEAK_MARKER, `'hang'` never
 * answers it; `siteList: 'malformed'` adds getAccessibleAtlassianResources, which answers text that is
 * not JSON and holds LEAK_MARKER.
 */
function serviceMethods(label, faults = {}) {
  const tools = [
    { name: 'whoami', description: `Names the dataset of the token (dataset ${label}).`, inputSchema: { type: 'object', properties: {} } },
    { name: 'list_items', description: `Lists the items of dataset ${label}.`, inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  ]
  if (faults.siteList === 'malformed') tools.push({ name: 'getAccessibleAtlassianResources', description: 'Sites of the token.', inputSchema: { type: 'object', properties: {} } })
  return async (method, params) => {
    if (method === 'initialize') return { protocolVersion: params.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'integrations-stub', version: '0.0.1' } }
    if (method === 'ping') return {}
    if (method === 'tools/list' && faults.toolsList === 'fail') throw new Error(`tools/list failed for https://${LEAK_MARKER}/wiki`)
    if (method === 'tools/list' && faults.toolsList === 'hang') return new Promise(() => undefined)
    if (method === 'tools/list') return { tools }
    if (method === 'tools/call') {
      if (params.name === 'getAccessibleAtlassianResources') return { content: [{ type: 'text', text: `[{"id":"1","url":"https://${LEAK_MARKER}"` }] }
      if (params.name === 'whoami') return { content: [{ type: 'text', text: `dataset ${label}` }] }
      if (params.name === 'list_items') return { content: [{ type: 'text', text: `${label}-1, ${label}-2` }] }
      return { content: [{ type: 'text', text: `unknown tool ${params.name}` }], isError: true }
    }
    throw notFound(method)
  }
}

const s256 = (verifier) => createHash('sha256').update(verifier).digest('base64url')
const secret = (prefix) => `${prefix}-${randomBytes(12).toString('hex')}`

/**
 * Starts the stub service. `tokens`: token -> dataset label (bearer). `oauth`: { ttlMs, rotate, tokenDelayMs }
 * turns the OAuth mode on; its tokens carry the dataset label `oauth`. `faults`: see serviceMethods.
 */
export async function startStub({ tokens = {}, oauth, faults = {} } = {}) {
  const log = []
  const counts = { register: 0, authorize: 0, token_code: 0, token_refresh: 0, refresh_refused: 0, revoke: 0, unauthorized: 0 }
  const clients = new Map() // client_id -> redirect_uris
  const codes = new Map() // code -> { client_id, redirect_uri, challenge }
  const access = new Map() // access token -> expiry (ms)
  const refresh = new Set()
  let base = ''
  const prm = () => `${base}/.well-known/oauth-protected-resource/mcp`
  const issue = () => {
    const accessToken = secret('stub-access')
    access.set(accessToken, Date.now() + oauth.ttlMs)
    const refreshToken = secret('stub-refresh')
    refresh.add(refreshToken)
    return { access_token: accessToken, token_type: 'Bearer', expires_in: Math.round(oauth.ttlMs / 1000), refresh_token: refreshToken, scope: 'read' }
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname
    const body = await readBody(req)
    if (path === '/mcp') {
      const token = bearerOf(req)
      let label = token === null ? undefined : tokens[token]
      if (oauth && token !== null && access.has(token)) label = access.get(token) > Date.now() ? 'oauth' : undefined
      if (label === undefined) {
        counts.unauthorized += 1
        log.push(`${req.method} ${path} 401`)
        const challenge = oauth ? `Bearer error="invalid_token", resource_metadata="${prm()}"` : 'Bearer'
        return sendJson(res, 401, { error: 'invalid_token' }, { 'www-authenticate': challenge })
      }
      let method = '-'
      try {
        method = JSON.parse(body).method ?? 'answer'
      } catch {
        // logged as '-'
      }
      log.push(`${req.method} ${path} ${method} ${label}`)
      return rpc(req, res, body, serviceMethods(label, faults))
    }
    if (!oauth) return sendJson(res, 404, { error: 'not_found' })
    if (path.startsWith('/.well-known/oauth-protected-resource')) return sendJson(res, 200, { resource: `${base}/mcp`, authorization_servers: [base], bearer_methods_supported: ['header'] })
    if (path.startsWith('/.well-known/oauth-authorization-server') || path.startsWith('/.well-known/openid-configuration'))
      return sendJson(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        revocation_endpoint: `${base}/revoke`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      })
    if (path === '/register' && req.method === 'POST') {
      counts.register += 1
      const meta = JSON.parse(body || '{}')
      const clientId = secret('stub-client')
      clients.set(clientId, meta.redirect_uris ?? [])
      return sendJson(res, 201, { ...meta, client_id: clientId, token_endpoint_auth_method: 'none' })
    }
    if (path === '/authorize') {
      counts.authorize += 1
      const q = url.searchParams
      const redirect = q.get('redirect_uri') ?? ''
      const known = clients.get(q.get('client_id') ?? '')
      if (!known || !known.includes(redirect) || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge') || q.get('response_type') !== 'code')
        return sendJson(res, 400, { error: 'invalid_request' })
      const code = secret('stub-code')
      codes.set(code, { client_id: q.get('client_id'), redirect_uri: redirect, challenge: q.get('code_challenge'), resource: q.get('resource') })
      const to = new URL(redirect)
      to.searchParams.set('code', code)
      if (q.get('state')) to.searchParams.set('state', q.get('state'))
      res.writeHead(302, { location: to.toString() })
      return res.end()
    }
    if (path === '/token' && req.method === 'POST') {
      const form = new URLSearchParams(body)
      if (oauth.tokenDelayMs) await sleep(oauth.tokenDelayMs)
      if (form.get('grant_type') === 'authorization_code') {
        const entry = codes.get(form.get('code') ?? '')
        codes.delete(form.get('code') ?? '')
        if (!entry || entry.client_id !== form.get('client_id') || entry.redirect_uri !== form.get('redirect_uri') || s256(form.get('code_verifier') ?? '') !== entry.challenge)
          return sendJson(res, 400, { error: 'invalid_grant' })
        counts.token_code += 1
        return sendJson(res, 200, { ...issue(), resource_seen: entry.resource !== null })
      }
      if (form.get('grant_type') === 'refresh_token') {
        counts.token_refresh += 1
        const old = form.get('refresh_token') ?? ''
        if (!refresh.has(old)) {
          counts.refresh_refused += 1
          return sendJson(res, 400, { error: 'invalid_grant', error_description: 'unknown or used refresh token' })
        }
        const fresh = issue()
        if (oauth.rotate) refresh.delete(old)
        else {
          refresh.delete(fresh.refresh_token)
          delete fresh.refresh_token
        }
        return sendJson(res, 200, fresh)
      }
      return sendJson(res, 400, { error: 'unsupported_grant_type' })
    }
    if (path === '/revoke' && req.method === 'POST') {
      counts.revoke += 1
      const token = new URLSearchParams(body).get('token') ?? ''
      access.delete(token)
      refresh.delete(token)
      return sendJson(res, 200, {})
    }
    return sendJson(res, 404, { error: 'not_found' })
  })
  base = await listen(server)
  return {
    url: `${base}/mcp`,
    base,
    log,
    counts,
    /** Ends every access token now: the next call with one gets 401. */
    expireAccess: () => {
      for (const key of access.keys()) access.set(key, 0)
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

/**
 * The stand-in of worfy's endpoint: POST /mcp/<name> with the Session token, routed to `routes[name]`
 * (method, params) => result. Any other token gets 401 before the body is read.
 */
export async function startEndpoint({ token, routes }) {
  const log = []
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    const name = /^\/mcp\/([^/]+)$/.exec(path)?.[1]
    if (bearerOf(req) !== token) {
      log.push(`${req.method} ${path} 401`)
      return sendJson(res, 401, { error: 'invalid_token' }, { 'www-authenticate': 'Bearer' })
    }
    const handle = name === undefined ? undefined : routes[name]
    if (!handle) return sendJson(res, 404, { error: 'not_found' })
    const body = await readBody(req)
    log.push(`${req.method} ${path}`)
    return rpc(req, res, body, handle)
  })
  const base = await listen(server)
  return {
    base,
    log,
    urls: Object.fromEntries(Object.keys(routes).map((name) => [name, `${base}/mcp/${name}`])),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

/**
 * A fake of the Messages API on 127.0.0.1 for Claude Code (ANTHROPIC_BASE_URL): no model, no network.
 * It records the tools of each request (the list the model would get) and which of the names in
 * `watch` the request mentions anywhere (a deferred tool is named in the prompt, not in `tools`). The
 * first request that mentions a tool of `callTools` gets one tool_use block per such tool, the request
 * that carries their results a text, anything else (side requests of Claude Code) a short text. The
 * tool results are kept, so the caller sees what each MCP server answered through Claude Code.
 */
export async function startFakeMessagesApi({ callTools, watch = [] }) {
  const requests = []
  const toolResults = []
  let called = false
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    const body = await readBody(req)
    if (req.method !== 'POST' || !path.startsWith('/v1/messages')) return sendJson(res, 200, { data: [] })
    if (path.endsWith('/count_tokens')) return sendJson(res, 200, { input_tokens: 1 })
    let request = {}
    try {
      request = JSON.parse(body)
    } catch {
      // answered as a side request
    }
    const tools = Array.isArray(request.tools) ? request.tools : []
    const names = tools.map((t) => t.name ?? t.type ?? '?')
    // The tool results of this turn: every tool_result block after the last assistant message.
    const messages = Array.isArray(request.messages) ? request.messages : []
    const lastAssistant = messages.map((m) => m?.role).lastIndexOf('assistant')
    const results = lastAssistant < 0 ? [] : messages.slice(lastAssistant + 1).flatMap((m) => (Array.isArray(m?.content) ? m.content.filter((c) => c?.type === 'tool_result') : []))
    const mentions = watch.filter((name) => body.includes(name))
    requests.push({ model: request.model, stream: request.stream === true, tools: names, deferred: tools.filter((t) => t.defer_loading === true).map((t) => t.name), mentions, messages: request.messages?.length ?? 0, tool_results: results.length })
    let content
    let stop = 'end_turn'
    const offered = callTools.filter((name) => body.includes(name))
    if (results.length > 0) {
      for (const r of results) toolResults.push({ tool_use_id: r.tool_use_id, is_error: r.is_error === true, text: (Array.isArray(r.content) ? r.content.map((c) => c.text ?? '').join(' ') : String(r.content ?? '')).slice(0, 200) })
      content = [{ type: 'text', text: 'done' }]
    } else if (!called && offered.length > 0) {
      called = true
      stop = 'tool_use'
      content = offered.map((name, i) => ({ type: 'tool_use', id: `toolu_spike_${i + 1}`, name, input: {} }))
    } else content = [{ type: 'text', text: 'ok' }]
    const message = { id: `msg_spike_${requests.length}`, type: 'message', role: 'assistant', model: request.model ?? 'fake', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
    if (request.stream !== true) return sendJson(res, 200, message)
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
    event('message_start', { message: { ...message, content: [], stop_reason: null } })
    content.forEach((block, index) => {
      if (block.type === 'text') {
        event('content_block_start', { index, content_block: { type: 'text', text: '' } })
        event('content_block_delta', { index, delta: { type: 'text_delta', text: block.text } })
      } else {
        event('content_block_start', { index, content_block: { ...block, input: {} } })
        event('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: '{}' } })
      }
      event('content_block_stop', { index })
    })
    event('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } })
    event('message_stop', {})
    res.end()
  })
  const base = await listen(server)
  return { base, requests, toolResults, close: () => new Promise((resolve) => server.close(() => resolve())) }
}

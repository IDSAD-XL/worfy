// A stand-in of a service that signs in with OAuth, for the tests of worfy-integrations ticket 05: one HTTP server on
// 127.0.0.1 that is both the MCP server and its authorization server, as Linear's is. It does what the MCP
// authorization spec asks and what Atlassian and Linear did in the live step of ticket 01's spike:
// - the MCP endpoint /mcp answers 401 with `resource_metadata` in WWW-Authenticate to a request without a token it
//   issued, or with one it ended;
// - /.well-known/oauth-protected-resource (RFC 9728) and /.well-known/oauth-authorization-server (RFC 8414);
// - Dynamic Client Registration (RFC 7591) at /register;
// - /authorize approves at once and redirects with a code — only for a registered client, a registered redirect URI
//   (a loopback one on any port, RFC 8252 7.3), PKCE S256 and the `resource` of the MCP server (RFC 8707);
// - /token exchanges a code once, checking its `code_verifier`, and refreshes with rotation: every refresh gives a
//   new refresh token and ends the old one, so a second refresh with the same token is refused (invalid_grant);
// - /revoke (RFC 7009).
// Each registered client is a dataset of its own (`client-1`, `client-2`…): `whoami` answers it, so two Integrations
// on one address tell themselves apart by what the server answers. The log keeps the endpoint and a fact about the
// request, never a token.
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface OAuthStubOptions {
  /** The scopes the resource metadata lists (what a client asks for when it names none). */
  scopesSupported?: readonly string[]
  /** How long /token takes to answer a refresh, so parallel calls meet one refresh in flight; 100 ms by default. */
  refreshDelayMs?: number
  /** Whether the authorization server lists a revocation endpoint; true by default. */
  revocation?: boolean
}

/** What one request to /authorize carried. */
export interface AuthorizeRequest {
  clientId: string
  redirectUri: string
  codeChallengeMethod: string | null
  resource: string | null
  scope: string | null
  state: string | null
}

/** What one request to /token carried; never the token or the code itself. */
export interface TokenRequest {
  grant: string
  resource: string | null
  /** For a code: whether its code_verifier matched the challenge. */
  verifierMatched?: boolean
  outcome: 'issued' | 'refused'
}

export interface RegisteredClient {
  clientId: string
  dataset: string
  redirectUris: string[]
  scope: string | null
}

export interface OAuthStub {
  /** The MCP endpoint: http://127.0.0.1:<port>/mcp. */
  url: string
  /** http://127.0.0.1:<port>: the issuer of the authorization server. */
  origin: string
  registrations: RegisteredClient[]
  authorizations: AuthorizeRequest[]
  tokenRequests: TokenRequest[]
  /** What /revoke was asked: the type hint, and whether the token was one the stub still honoured; never the token. */
  revocations: { hint: string | null; known: boolean }[]
  /** Datasets of the tools/call requests, in order. */
  calls: string[]
  /** How many `initialize` requests came: one connection is one. */
  initializes(): number
  /** How many refresh requests reached /token. */
  refreshes(): number
  /** Every access token issued so far is ended: the next request with one gets 401. */
  expireAccessTokens(): void
  /** Every refresh token is ended too: a refresh gets invalid_grant. */
  expireRefreshTokens(): void
  /** Whether `token` is an access or refresh token the stub issued and still honours. */
  honours(token: string): boolean
  close(): Promise<void>
}

const PROTOCOL_VERSION = '2025-06-18'

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers })
  response.end(JSON.stringify(body))
}

const s256 = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url')
const token = (kind: string): string => `${kind}-${randomBytes(12).toString('hex')}`

/** Whether `requested` is `registered`, a loopback redirect URI allowed on any port (RFC 8252 7.3). */
function redirectAllowed(registered: readonly string[], requested: string): boolean {
  return registered.some((uri) => {
    if (uri === requested) return true
    try {
      const a = new URL(uri)
      const b = new URL(requested)
      return a.hostname === '127.0.0.1' && b.hostname === '127.0.0.1' && a.protocol === b.protocol && a.pathname === b.pathname && a.search === b.search
    } catch {
      return false
    }
  })
}

/** Starts the stub on a free port of 127.0.0.1. */
export async function startOAuthStub(options: OAuthStubOptions = {}): Promise<OAuthStub> {
  const registrations: RegisteredClient[] = []
  const authorizations: AuthorizeRequest[] = []
  const tokenRequests: TokenRequest[] = []
  const revocations: { hint: string | null; known: boolean }[] = []
  const calls: string[] = []
  let initializes = 0
  /** code → what it was given for. */
  const codes = new Map<string, { clientId: string; challenge: string; redirectUri: string; resource: string | null }>()
  /** access token → dataset, refresh token → client id: the live ones. */
  const access = new Map<string, string>()
  const refresh = new Map<string, string>()
  const sessions = new Map<string, string>()
  let port = 0
  const origin = (): string => `http://127.0.0.1:${port}`
  const mcpUrl = (): string => `${origin()}/mcp`
  const scopesSupported = options.scopesSupported ?? ['read', 'write', 'delete', 'admin']

  const issue = (clientId: string): Record<string, unknown> => {
    const client = registrations.find((entry) => entry.clientId === clientId)
    const accessToken = token('at')
    const refreshToken = token('rt')
    access.set(accessToken, client?.dataset ?? 'unknown')
    refresh.set(refreshToken, clientId)
    return { access_token: accessToken, token_type: 'Bearer', expires_in: 3600, refresh_token: refreshToken, scope: client?.scope ?? scopesSupported.join(' ') }
  }

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', origin())
      const path = url.pathname
      if (path === '/.well-known/oauth-protected-resource/mcp' || path === '/.well-known/oauth-protected-resource') {
        return json(response, 200, { resource: mcpUrl(), authorization_servers: [origin()], scopes_supported: scopesSupported, bearer_methods_supported: ['header'] })
      }
      if (path === '/.well-known/oauth-authorization-server') {
        return json(response, 200, {
          issuer: origin(),
          authorization_endpoint: `${origin()}/authorize`,
          token_endpoint: `${origin()}/token`,
          registration_endpoint: `${origin()}/register`,
          ...(options.revocation === false ? {} : { revocation_endpoint: `${origin()}/revoke` }),
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        })
      }
      if (path === '/register' && request.method === 'POST') {
        const metadata = JSON.parse(await bodyOf(request)) as { redirect_uris?: string[]; scope?: string }
        const clientId = `client-${registrations.length + 1}`
        registrations.push({ clientId, dataset: clientId, redirectUris: metadata.redirect_uris ?? [], scope: metadata.scope ?? null })
        return json(response, 201, { ...metadata, client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), token_endpoint_auth_method: 'none' })
      }
      if (path === '/authorize' && request.method === 'GET') {
        const q = url.searchParams
        const entry: AuthorizeRequest = {
          clientId: q.get('client_id') ?? '',
          redirectUri: q.get('redirect_uri') ?? '',
          codeChallengeMethod: q.get('code_challenge_method'),
          resource: q.get('resource'),
          scope: q.get('scope'),
          state: q.get('state'),
        }
        authorizations.push(entry)
        const client = registrations.find((each) => each.clientId === entry.clientId)
        if (client === undefined || !redirectAllowed(client.redirectUris, entry.redirectUri)) return json(response, 400, { error: 'invalid_request', error_description: 'unknown client or redirect URI' })
        const back = new URL(entry.redirectUri)
        if (entry.codeChallengeMethod !== 'S256' || q.get('code_challenge') === null || entry.resource !== mcpUrl()) {
          back.searchParams.set('error', 'invalid_request')
        } else {
          const code = token('code')
          codes.set(code, { clientId: entry.clientId, challenge: q.get('code_challenge') ?? '', redirectUri: entry.redirectUri, resource: entry.resource })
          back.searchParams.set('code', code)
        }
        if (entry.state !== null) back.searchParams.set('state', entry.state)
        response.writeHead(302, { location: back.toString() })
        return response.end()
      }
      if (path === '/token' && request.method === 'POST') {
        const form = new URLSearchParams(await bodyOf(request))
        const grant = form.get('grant_type') ?? ''
        const resource = form.get('resource')
        if (grant === 'authorization_code') {
          const given = codes.get(form.get('code') ?? '')
          codes.delete(form.get('code') ?? '')
          const verifierMatched = given !== undefined && s256(form.get('code_verifier') ?? '') === given.challenge
          const ok = given !== undefined && verifierMatched && form.get('client_id') === given.clientId && form.get('redirect_uri') === given.redirectUri && resource === given.resource
          tokenRequests.push({ grant, resource, verifierMatched, outcome: ok ? 'issued' : 'refused' })
          if (!ok || given === undefined) return json(response, 400, { error: 'invalid_grant', error_description: 'The code is not valid' })
          return json(response, 200, issue(given.clientId))
        }
        if (grant === 'refresh_token') {
          await new Promise((resolve) => setTimeout(resolve, options.refreshDelayMs ?? 100))
          const old = form.get('refresh_token') ?? ''
          const clientId = refresh.get(old)
          // Rotation: the token is spent whatever happens next.
          refresh.delete(old)
          tokenRequests.push({ grant, resource, outcome: clientId === undefined ? 'refused' : 'issued' })
          if (clientId === undefined) return json(response, 400, { error: 'invalid_grant', error_description: 'The refresh token is not valid' })
          return json(response, 200, issue(clientId))
        }
        tokenRequests.push({ grant, resource, outcome: 'refused' })
        return json(response, 400, { error: 'unsupported_grant_type' })
      }
      if (path === '/revoke' && request.method === 'POST') {
        const form = new URLSearchParams(await bodyOf(request))
        const value = form.get('token') ?? ''
        const known = access.delete(value) || refresh.delete(value)
        revocations.push({ hint: form.get('token_type_hint'), known })
        response.writeHead(200)
        return response.end()
      }
      if (path !== '/mcp') return json(response, 404, { error: 'not found' })
      const bearer = /^Bearer (.+)$/u.exec(request.headers.authorization ?? '')?.[1]
      const dataset = bearer === undefined ? undefined : access.get(bearer)
      if (dataset === undefined) {
        await bodyOf(request)
        return json(response, 401, { error: 'invalid_token' }, { 'www-authenticate': `Bearer error="invalid_token", resource_metadata="${origin()}/.well-known/oauth-protected-resource/mcp"` })
      }
      if (request.method === 'GET') return json(response, 405, { error: 'method not allowed' })
      if (request.method === 'DELETE') {
        const session = request.headers['mcp-session-id']
        if (typeof session === 'string') sessions.delete(session)
        response.writeHead(200)
        return response.end()
      }
      const message = JSON.parse(await bodyOf(request)) as { id?: number | string; method: string; params?: { name?: string } }
      if (message.id === undefined) {
        response.writeHead(202)
        return response.end()
      }
      if (message.method === 'initialize') {
        initializes++
        const session = randomBytes(8).toString('hex')
        sessions.set(session, dataset)
        return json(
          response,
          200,
          { jsonrpc: '2.0', id: message.id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'oauth-stub', version: '1.0.0' } } },
          { 'mcp-session-id': session },
        )
      }
      if (message.method === 'tools/list') {
        return json(response, 200, {
          jsonrpc: '2.0',
          id: message.id,
          result: { tools: [{ name: 'whoami', description: 'The dataset of this sign-in', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }] },
        })
      }
      if (message.method === 'tools/call') {
        calls.push(dataset)
        return json(response, 200, { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: `dataset ${dataset}` }] } })
      }
      return json(response, 200, { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `no method ${message.method}` } })
    })().catch((error: unknown) => {
      if (!response.headersSent) json(response, 500, { error: String(error) })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
  return {
    url: mcpUrl(),
    origin: origin(),
    registrations,
    authorizations,
    tokenRequests,
    revocations,
    calls,
    initializes: () => initializes,
    refreshes: () => tokenRequests.filter((entry) => entry.grant === 'refresh_token').length,
    expireAccessTokens: () => access.clear(),
    expireRefreshTokens: () => refresh.clear(),
    honours: (value) => access.has(value) || refresh.has(value),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error === undefined ? resolve() : reject(error)))
      }),
  }
}

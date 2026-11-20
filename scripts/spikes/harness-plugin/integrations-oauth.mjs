// The MCP SDK side of the `integrations` and `integrations-sign-in` scenarios of probe.ts (ticket
// worfy-integrations/01): the package `@modelcontextprotocol/sdk` the Agent SDK already carries as a
// peer (1.32.0), an OAuthClientProvider that keeps everything in memory, the sign-in through the
// package (Dynamic Client Registration, PKCE, `resource`), the spike window and the report of one
// signed-in server.
//
// The spike window is a BrowserWindow on a partition of its own per sign-in. The partition name has no
// `persist:` prefix, so its cookies and storage live in memory only and end with the process. The
// redirect goes to http://127.0.0.1/worfy-oauth/<slot>, as Ticket 05 plans it: the window's requests
// are watched, the redirect is caught and cancelled, and no listener is opened. Tokens stay in the
// memory of the provider; the report holds no token, no address of a site and no e-mail.
/* global URL, URLSearchParams, fetch, setTimeout, clearTimeout */
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

/** The ES modules of the @modelcontextprotocol/sdk copy the Agent SDK of `repo` resolves (pnpm keeps it out of the root). */
export async function loadMcpSdk(repo) {
  const agentSdk = realpathSync(join(repo, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'))
  const cjs = createRequire(agentSdk).resolve('@modelcontextprotocol/sdk/client/index.js')
  const root = cjs.split(/[\\/]dist[\\/]cjs[\\/]/)[0]
  const esm = (sub) => import(pathToFileURL(join(root, 'dist', 'esm', sub)).href)
  const [client, http, auth, server, types, memory] = await Promise.all([
    esm('client/index.js'),
    esm('client/streamableHttp.js'),
    esm('client/auth.js'),
    esm('server/index.js'),
    esm('types.js'),
    esm('inMemory.js'),
  ])
  return {
    version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
    Client: client.Client,
    StreamableHTTPClientTransport: http.StreamableHTTPClientTransport,
    auth: auth.auth,
    discoverOAuthServerInfo: auth.discoverOAuthServerInfo,
    UnauthorizedError: auth.UnauthorizedError,
    Server: server.Server,
    ListToolsRequestSchema: types.ListToolsRequestSchema,
    CallToolRequestSchema: types.CallToolRequestSchema,
    InMemoryTransport: memory.InMemoryTransport,
  }
}

const short = (value) => (typeof value === 'string' ? createHash('sha256').update(value).digest('hex').slice(0, 12) : null)

/** An OAuthClientProvider of the package that keeps the client, the tokens and the verifier in memory. */
export function memoryProvider({ redirectUrl, clientName }) {
  const kept = { client: undefined, tokens: undefined, verifier: undefined, authUrl: undefined, state: undefined, saves: 0 }
  const provider = {
    redirectUrl,
    clientMetadata: {
      client_name: clientName,
      redirect_uris: [redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    state: () => {
      kept.state = randomBytes(16).toString('hex')
      return kept.state
    },
    clientInformation: () => kept.client,
    saveClientInformation: (info) => {
      kept.client = info
    },
    tokens: () => kept.tokens,
    saveTokens: (tokens) => {
      kept.tokens = tokens
      kept.saves += 1
    },
    redirectToAuthorization: (url) => {
      kept.authUrl = url
    },
    saveCodeVerifier: (verifier) => {
      kept.verifier = verifier
    },
    codeVerifier: () => kept.verifier,
    invalidateCredentials: (scope) => {
      if (scope === 'all' || scope === 'client') kept.client = undefined
      if (scope === 'all' || scope === 'tokens') kept.tokens = undefined
      if (scope === 'all' || scope === 'verifier') kept.verifier = undefined
    },
  }
  return { provider, kept }
}

const newClient = (sdk) => new sdk.Client({ name: 'worfy-integrations-spike', version: '0.0.1' })

/**
 * Signs in to the MCP server at `url` through the package: the first connect meets 401, the package
 * discovers the metadata, registers the client, builds the PKCE authorization URL and hands it to
 * the provider; `open(authUrl)` returns the redirect URL the browser reached; finishAuth exchanges the
 * code. Returns a connected client. `options` go to each transport (a `fetch` of the caller's).
 */
export async function signIn(sdk, url, memory, open, options = {}) {
  const first = new sdk.StreamableHTTPClientTransport(new URL(url), { ...options, authProvider: memory.provider })
  try {
    const client = newClient(sdk)
    await client.connect(first)
    return client
  } catch (error) {
    if (!(error instanceof sdk.UnauthorizedError)) throw error
  }
  if (!memory.kept.authUrl) throw new Error('the package gave no authorization URL')
  const back = new URL(await open(memory.kept.authUrl))
  if (back.searchParams.get('state') !== memory.kept.state) throw new Error('the redirect came back with another state')
  const code = back.searchParams.get('code')
  if (!code) throw new Error(`the redirect has no code (error: ${back.searchParams.get('error') ?? 'none'})`)
  await first.finishAuth(code)
  const client = newClient(sdk)
  await client.connect(new sdk.StreamableHTTPClientTransport(new URL(url), { ...options, authProvider: memory.provider }))
  return client
}

/** For a server that approves at once (the stub): follows the authorization URL to its redirect without a browser. */
export const followRedirect = async (authUrl) => {
  const answer = await fetch(authUrl, { redirect: 'manual' })
  const location = answer.headers.get('location')
  if (!location) throw new Error(`the authorization endpoint answered ${answer.status} without a redirect`)
  return location
}

/**
 * The spike window: opens `authUrl` in a BrowserWindow on the in-memory partition `partition` and
 * resolves with the first request URL that starts with `redirectPrefix`, which it cancels.
 */
export function windowOpener(electron, { partition, show, title, redirectPrefix, timeoutMs }) {
  return (authUrl) =>
    new Promise((resolve, reject) => {
      const ses = electron.session.fromPartition(partition)
      const win = new electron.BrowserWindow({ show, width: 960, height: 780, title, webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true } })
      let done = false
      const finish = (settle) => {
        if (done) return
        done = true
        clearTimeout(timer)
        ses.webRequest.onBeforeRequest(null)
        if (!win.isDestroyed()) win.destroy()
        settle()
      }
      ses.webRequest.onBeforeRequest((details, callback) => {
        if (!details.url.startsWith(redirectPrefix)) return callback({})
        callback({ cancel: true })
        finish(() => resolve(details.url))
      })
      win.on('closed', () => finish(() => reject(new Error('the window was closed before the sign-in finished'))))
      const timer = setTimeout(() => finish(() => reject(new Error('the sign-in did not finish in time'))), timeoutMs)
      win.loadURL(String(authUrl)).catch(() => {
        // The cancelled redirect rejects the load; the result comes from onBeforeRequest.
      })
    })
}

/** Every tool of a connected client, page by page. */
export async function allTools(client) {
  const tools = []
  let cursor
  do {
    const page = await client.listTools(cursor ? { cursor } : {})
    tools.push(...page.tools)
    cursor = page.nextCursor
  } while (cursor)
  return tools
}

/**
 * What the spike asks of one signed-in server: capabilities from `initialize`, tools, the access
 * token's lifetime, whether a refresh token came and whether a refresh works, the endpoints of the
 * authorization server. Hashes stand in for tokens: only "did it change" is kept.
 */
export async function serverReport(sdk, url, client, memory) {
  const capabilities = client.getServerCapabilities() ?? {}
  const tools = await allTools(client)
  const first = memory.kept.tokens ?? {}
  const report = {
    server: client.getServerVersion()?.name ?? null,
    capabilities: Object.keys(capabilities).sort(),
    // Each capability with the keys of its object, as one string (`tools` would read as a tool list to the probe's sanitizer).
    capability_details: Object.entries(capabilities).map(([k, v]) => `${k}{${v && typeof v === 'object' ? Object.keys(v).sort().join(',') : String(v)}}`),
    instructions_chars: (client.getInstructions?.() ?? '').length,
    tools: tools.length,
    tool_names: tools.map((t) => t.name).sort(),
    longest_tool_name: Math.max(0, ...tools.map((t) => t.name.length)),
    // spec: a server name of up to 24 characters, mcp__<server>__<tool>.
    longest_full_name_with_24_char_server: 5 + 24 + 2 + Math.max(0, ...tools.map((t) => t.name.length)),
    token_type: first.token_type ?? null,
    expires_in_s: first.expires_in ?? null,
    scope: first.scope ?? null,
    refresh_token: typeof first.refresh_token === 'string',
  }
  try {
    const info = await sdk.discoverOAuthServerInfo(url)
    const meta = info.authorizationServerMetadata ?? {}
    report.authorization_server = info.authorizationServerUrl ? new URL(String(info.authorizationServerUrl)).origin : null
    report.registration_endpoint = typeof meta.registration_endpoint === 'string'
    report.revocation_endpoint = typeof meta.revocation_endpoint === 'string'
    report.client_id_metadata_document = meta.client_id_metadata_document_supported === true
    report.grant_types = meta.grant_types_supported ?? null
    report.token_auth_methods = meta.token_endpoint_auth_methods_supported ?? null
    report.revocation_url = meta.revocation_endpoint ?? null
  } catch (error) {
    report.metadata_error = String(error?.message ?? error)
  }
  if (report.refresh_token) {
    const t0 = Date.now()
    try {
      const result = await sdk.auth(memory.provider, { serverUrl: url })
      const after = memory.kept.tokens ?? {}
      report.refresh = {
        result,
        new_access_token: short(after.access_token) !== short(first.access_token),
        refresh_token_rotated: typeof after.refresh_token === 'string' && short(after.refresh_token) !== short(first.refresh_token),
        expires_in_s_after: after.expires_in ?? null,
        ms: Date.now() - t0,
      }
      report.refresh.tools_after_refresh = (await allTools(client)).length
    } catch (error) {
      report.refresh = { error: String(error?.message ?? error), ms: Date.now() - t0 }
    }
  } else report.refresh = 'no refresh token'
  return report
}

/** Revokes the tokens of `memory` at the revocation endpoint (RFC 7009), if the server has one; HTTP statuses only. */
export async function revoke(url, memory) {
  if (!url) return 'no revocation endpoint'
  const tokens = memory.kept.tokens ?? {}
  const clientId = memory.kept.client?.client_id
  const out = {}
  for (const [hint, token] of [
    ['refresh_token', tokens.refresh_token],
    ['access_token', tokens.access_token],
  ]) {
    if (typeof token !== 'string') continue
    const body = new URLSearchParams({ token, token_type_hint: hint, ...(clientId ? { client_id: clientId } : {}) })
    out[hint] = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }).then(
      (r) => r.status,
      (error) => String(error?.message ?? error),
    )
  }
  return out
}

/**
 * Ten (or `n`) parallel tools/call on one client after every access token was ended: how many refresh
 * requests reach the token endpoint, and how many calls fail. `expire` ends the tokens on the server.
 */
export async function parallelAfterExpiry(client, counts, expire, n = 10) {
  expire()
  const before = counts.token_refresh
  const refusedBefore = counts.refresh_refused
  const t0 = Date.now()
  const settled = await Promise.allSettled(Array.from({ length: n }, () => client.callTool({ name: 'whoami', arguments: {} })))
  await sleep(50)
  const errors = settled.filter((s) => s.status === 'rejected').map((s) => String(s.reason?.message ?? s.reason))
  return {
    calls: n,
    refresh_requests: counts.token_refresh - before,
    refresh_refused: counts.refresh_refused - refusedBefore,
    ok: settled.filter((s) => s.status === 'fulfilled' && !s.value.isError).length,
    errors: [...new Set(errors)].map((e) => ({ error: e, times: errors.filter((x) => x === e).length })),
    ms: Date.now() - t0,
  }
}

/**
 * A fetch for the transport that sends one refresh request at a time per refresh token: a second
 * refresh with the same token while the first is on its way gets a copy of the first answer. The
 * mitigation Ticket 05 would put next to its provider if the package does not hold such a lock itself.
 */
export function singleFlightFetch(base = fetch) {
  const inFlight = new Map()
  return async (input, init) => {
    const body = typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : null
    const key = body !== null && (init?.method ?? 'GET').toUpperCase() === 'POST' && new URLSearchParams(body).get('grant_type') === 'refresh_token' ? `${String(input)} ${body}` : null
    if (key === null) return base(input, init)
    if (!inFlight.has(key)) {
      const pending = base(input, init).finally(() => setTimeout(() => inFlight.delete(key), 0))
      inFlight.set(key, pending)
    }
    return (await inFlight.get(key)).clone()
  }
}

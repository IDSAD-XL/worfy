// Sign-in with OAuth (worfy-integrations ticket 05; ADR-0111 item 4; spec, implementation decisions, sign-in with
// OAuth; owner's answers Q4, Q5 and Q10). The protocol is the MCP SDK's own (`@modelcontextprotocol/sdk` 1.32.0,
// client/auth.js): discovery of the protected resource (RFC 9728) and of its authorization server (RFC 8414), Dynamic
// Client Registration (RFC 7591), PKCE S256 and the `resource` of the MCP server (RFC 8707). worfy writes only:
// - an OAuthClientProvider over the Integration store's secret store: the registered client under `<id>:client`
//   (JSON, as the package gave it, with its `issuer`), the tokens under `<id>:access` and `<id>:refresh`, the PKCE
//   code verifier in memory for the time of one sign-in. A client is registered once per Integration and kept
//   until Sign out; two Integrations on one address register two clients and keep two sets of tokens.
// - the sign-in itself (IntegrationOAuth.signIn): in a worfy window on the cookie partition
//   `persist:integration-<id>`, so a second account of the same service does not pick up the first one's login, its
//   redirect to http://127.0.0.1/worfy-oauth/<id> caught by the window's own request hook with no listener, the
//   window closed after the code is exchanged; or, for single sign-on and passkeys, in the system browser with a
//   loopback listener on 127.0.0.1 and a random port (RFC 8252) that waits at most 10 minutes. The scope is the
//   catalogue's when it names one (explicit, so Atlassian does not ask for every write scope its metadata lists); a
//   service without one gets what its metadata lists.
// - the refresh lock (IntegrationOAuth.transport): the transport of the proxy (src/main/integrations/proxy.ts)
//   refreshes an expired access token itself, but each request that meets 401 calls the package's auth() on its own
//   and the package holds no lock — the spike of ticket 01 (step 5) saw two refreshes for one call and ten for ten.
//   Atlassian and Linear rotate the refresh token on every refresh, so the second refresh with a spent token gets
//   invalid_grant and the package throws the sign-in away. The OAuthClientProvider has no place around a refresh;
//   the transport's `fetch` has: there one refresh request per Integration goes out at a time, every other one gets
//   a copy of its answer, and a refresh with a refresh token that is no longer the kept one — or while the kept access
//   token was never refused — is answered with the kept tokens without asking the service. So a refresh token is
//   never sent twice.
// - Sign out: the tokens revoked at the revocation endpoint when the service has one (RFC 7009), every `<id>:*` key
//   removed, the partition's cookies and storage cleared.
// The proxy's transport never opens a window: a sign-in it would need ends as UnauthorizedError, which the proxy
// answers «Sign-in needed: <label>…» (an unattended Session never opens one either, ADR-0111 item 7). No token goes
// into a message, a log line, integrations.json or a channel's answer.
import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { catalogueEntry } from '../../../shared/integrations/catalogue'
import type { Integration, IntegrationSecretPart, IntegrationSignIn } from '../../../shared/integrations/types'
import type { OAuthTransport } from '../proxy'
import { integrationStore } from '../store'
import { MissingSecretError, scrubServiceText, type TokenStore } from './tokens'

/** How long a sign-in waits for the person: the window or the system browser. */
export const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000
/** How long Sign out waits for each request to the service. */
const SIGN_OUT_TIMEOUT_MS = 15_000
/** The path every redirect of a sign-in comes back to, before the Integration's id. */
const REDIRECT_PATH = '/worfy-oauth/'

/** The redirect URI of Integration `id`: without a port for the window, with the listener's port for the system browser. */
export function redirectUrlOf(id: string, port?: number): string {
  return `http://127.0.0.1${port === undefined ? '' : `:${port}`}${REDIRECT_PATH}${id}`
}

/** The cookie partition of Integration `id`'s sign-in window: kept on disk, one per Integration. */
export function partitionOf(id: string): string {
  return `persist:integration-${id}`
}

/** Whether `url` is a redirect of some worfy sign-in: never loaded, whichever Integration it is for. */
export function isSignInRedirect(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && parsed.pathname.startsWith(REDIRECT_PATH)
  } catch {
    return false
  }
}

/** What a redirect brought: the code, or the service's refusal. */
export type RedirectOutcome = { code: string } | { error: string }

/**
 * What `url` brings to the sign-in of Integration `id` with `state`: null unless it is that sign-in's redirect — its
 * path, its `state`, and its port (`port`; none for the window).
 */
export function redirectOutcome(url: string, id: string, state: string, port?: number): RedirectOutcome | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') return null
  if (parsed.port !== (port === undefined ? '' : String(port))) return null
  if (parsed.pathname !== `${REDIRECT_PATH}${id}`) return null
  if (parsed.searchParams.get('state') !== state) return null
  const code = parsed.searchParams.get('code')
  if (code !== null && code !== '') return { code }
  return { error: parsed.searchParams.get('error_description') ?? parsed.searchParams.get('error') ?? 'the service sent no code' }
}

/** One wait for a sign-in's redirect: its outcome, and how to end the wait — the window or the listener with it. */
export interface RedirectWait {
  outcome: Promise<RedirectOutcome>
  close(): void
}

/** What the sign-in window needs: the page, the Integration and its sign-in's state, the partition and the wait. */
export interface WindowRequest {
  authorizationUrl: URL
  id: string
  state: string
  partition: string
  title: string
  timeoutMs: number
}

/** Opens the sign-in window; the app's is windowOpener(Electron). */
export type OpenWindow = (request: WindowRequest) => RedirectWait

/** The parts of Electron the sign-in window uses; tests pass a stand-in. */
export interface WindowElectron {
  session: {
    fromPartition(partition: string): {
      webRequest: {
        onBeforeRequest(listener: ((details: { url: string }, callback: (response: { cancel?: boolean }) => void) => void) | null): void
      }
    }
  }
  BrowserWindow: new (options: Record<string, unknown>) => {
    loadURL(url: string): Promise<void>
    on(event: 'closed', listener: () => void): void
    isDestroyed(): boolean
    destroy(): void
    webContents: unknown
  }
}

/**
 * The sign-in window: a BrowserWindow on the Integration's partition, with no preload and no Node. Every request of its
 * pages to a worfy redirect is cancelled, so none reaches 127.0.0.1; the one of this sign-in — its id and its state —
 * ends the wait with its code. Closing the window, or 10 minutes, ends the wait with an error. `prepare` lets main
 * fit the window into its walls (src/main/window.ts) before the first page loads.
 */
export function windowOpener(electron: WindowElectron, prepare: (contents: unknown, partition: string) => void = () => undefined): OpenWindow {
  return ({ authorizationUrl, id, state, partition, title, timeoutMs }) => {
    const hooks = electron.session.fromPartition(partition).webRequest
    const win = new electron.BrowserWindow({
      width: 960,
      height: 780,
      title,
      show: true,
      webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    prepare(win.webContents, partition)
    let settle: ((outcome: RedirectOutcome | Error) => void) | null = null
    const outcome = new Promise<RedirectOutcome>((resolve, reject) => {
      settle = (value) => (value instanceof Error ? reject(value) : resolve(value))
    })
    // Ended before anyone waits on it (the sign-in failed first): not an unhandled rejection.
    outcome.catch(() => undefined)
    let ended = false
    const end = (value: RedirectOutcome | Error | null): void => {
      if (ended) return
      ended = true
      clearTimeout(timer)
      hooks.onBeforeRequest(null)
      if (value !== null) settle?.(value)
    }
    const timer = setTimeout(() => end(new Error('The sign-in did not finish in 10 minutes.')), timeoutMs)
    hooks.onBeforeRequest((details, callback) => {
      if (!isSignInRedirect(details.url)) return callback({})
      callback({ cancel: true })
      const found = redirectOutcome(details.url, id, state)
      if (found !== null) end(found)
    })
    win.on('closed', () => end(new Error('The sign-in window was closed before the sign-in finished.')))
    // The cancelled redirect fails the load; the outcome comes from the request hook.
    win.loadURL(String(authorizationUrl)).catch(() => undefined)
    return {
      outcome,
      close: () => {
        end(new Error('The sign-in was ended.'))
        if (!win.isDestroyed()) win.destroy()
      },
    }
  }
}

/** A loopback listener waiting for the redirect of a sign-in in the system browser. */
export interface LoopbackWait extends RedirectWait {
  redirectUrl: string
  /** Whether the listener still listens. */
  listening(): boolean
}

/**
 * Listens on 127.0.0.1 on a random port for the redirect of Integration `id`'s sign-in with `state` (RFC 8252): the
 * first request that is that redirect gets a page saying so and ends the wait, and the listener closes; any other
 * gets 404 and the wait goes on. After `timeoutMs` the wait ends with an error and the listener closes.
 */
export async function listenLoopback(request: { id: string; state: string; timeoutMs: number }): Promise<LoopbackWait> {
  let settle: ((outcome: RedirectOutcome | Error) => void) | null = null
  const outcome = new Promise<RedirectOutcome>((resolve, reject) => {
    settle = (value) => (value instanceof Error ? reject(value) : resolve(value))
  })
  outcome.catch(() => undefined)
  let port = 0
  let open = true
  let timer: ReturnType<typeof setTimeout> | undefined
  const server: Server = createServer((incoming, response) => {
    const found = redirectOutcome(`http://127.0.0.1:${port}${incoming.url ?? '/'}`, request.id, request.state, port)
    if (found === null) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Not found')
      return
    }
    response.writeHead('code' in found ? 200 : 400, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' })
    response.end('code' in found ? 'Signed in. You can close this tab and go back to worfy.' : 'The service did not sign you in. Go back to worfy to try again.')
    end(found)
  })
  const end = (value: RedirectOutcome | Error): void => {
    if (!open) return
    open = false
    clearTimeout(timer)
    server.close()
    server.closeIdleConnections()
    settle?.(value)
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  port = (server.address() as AddressInfo).port
  timer = setTimeout(() => end(new Error('The sign-in did not finish in 10 minutes.')), request.timeoutMs)
  return { redirectUrl: redirectUrlOf(request.id, port), outcome, close: () => end(new Error('The sign-in was ended.')), listening: () => open }
}

// ── the provider ──────────────────────────────────────────────────────────────

/** The MCP SDK's auth part, loaded on first use, as the proxy loads its parts. */
const authSdk = () => import('@modelcontextprotocol/sdk/client/auth.js')

/** The client and the tokens of an Integration as the secret store keeps them. */
interface Kept {
  client: OAuthClientInformationMixed | undefined
  access: string | undefined
  refresh: string | undefined
}

function keptOf(store: TokenStore, id: string): Kept {
  const raw = store.secret(id, 'client')
  let client: OAuthClientInformationMixed | undefined
  if (raw !== undefined && raw !== '') {
    try {
      client = JSON.parse(raw) as OAuthClientInformationMixed
    } catch {
      client = undefined
    }
  }
  const value = (part: IntegrationSecretPart): string | undefined => {
    const secret = store.secret(id, part)
    return secret === undefined || secret === '' ? undefined : secret
  }
  return { client, access: value('access'), refresh: value('refresh') }
}

/** Keeps only `parts` of Integration `id`'s secrets: the store removes all of them at once, so the rest are put back. */
function keepOnly(store: TokenStore, id: string, parts: readonly IntegrationSecretPart[]): void {
  const kept = parts.flatMap((part) => {
    const value = store.secret(id, part)
    return value === undefined ? [] : [[part, value] as const]
  })
  store.deleteSecrets(id)
  for (const [part, value] of kept) store.setSecret(id, part, value)
}

/** The client metadata worfy registers with: a public client (PKCE, no secret) with the window's redirect URI. */
function clientMetadataOf(id: string, scope: string | undefined): OAuthClientMetadata {
  return {
    client_name: 'worfy',
    redirect_uris: [redirectUrlOf(id)],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    ...(scope === undefined ? {} : { scope }),
  }
}

/**
 * The provider of Integration `id`. `signIn` — the provider of a sign-in a person runs: it starts from no tokens, so
 * the package authorizes anew instead of refreshing, keeps the code verifier in memory and hands the authorization URL
 * to `redirect`. Without it — the proxy's: it never registers a client and never redirects, so a sign-in it would need
 * ends as UnauthorizedError.
 */
function providerOf(
  store: TokenStore,
  id: string,
  onSaved: () => void,
  signIn?: { redirectUrl: string; state: string; scope: string | undefined; redirect: (url: URL) => void },
): OAuthClientProvider {
  let verifier: string | undefined
  const unauthorized = async (message: string): Promise<never> => {
    const { UnauthorizedError } = await authSdk()
    throw new UnauthorizedError(message)
  }
  return {
    redirectUrl: signIn?.redirectUrl ?? redirectUrlOf(id),
    clientMetadata: clientMetadataOf(id, signIn?.scope),
    ...(signIn === undefined ? {} : { state: () => signIn.state }),
    clientInformation: async () => {
      const { client } = keptOf(store, id)
      if (client === undefined && signIn === undefined) return unauthorized('sign-in needed: no client is registered')
      return client
    },
    saveClientInformation: async (information) => {
      // The proxy only stamps the kept client with its issuer; a new registration is a sign-in's.
      if (signIn === undefined && keptOf(store, id).client?.client_id !== information.client_id) return unauthorized('sign-in needed: the client must register again')
      store.setSecret(id, 'client', JSON.stringify(information))
    },
    tokens: (): OAuthTokens | undefined => {
      if (signIn !== undefined) return undefined
      const kept = keptOf(store, id)
      if (kept.access === undefined) return undefined
      return {
        access_token: kept.access,
        token_type: 'Bearer',
        ...(kept.refresh === undefined ? {} : { refresh_token: kept.refresh }),
        ...(kept.client?.issuer === undefined ? {} : { issuer: kept.client.issuer }),
      }
    },
    saveTokens: (tokens) => {
      // A refresh that gives no new refresh token leaves the old one (RFC 6749 6); a new sign-in replaces both.
      if (signIn !== undefined || tokens.refresh_token !== undefined) keepOnly(store, id, ['client'])
      store.setSecret(id, 'access', tokens.access_token)
      if (tokens.refresh_token !== undefined) store.setSecret(id, 'refresh', tokens.refresh_token)
      onSaved()
    },
    redirectToAuthorization: (url) => {
      signIn?.redirect(url)
    },
    saveCodeVerifier: (value) => {
      if (signIn !== undefined) verifier = value
    },
    codeVerifier: () => {
      if (verifier === undefined) throw new Error('no sign-in is running')
      return verifier
    },
    invalidateCredentials: (scope) => {
      if (scope === 'verifier') verifier = undefined
      else if (scope === 'tokens') keepOnly(store, id, ['client'])
      else if (scope !== 'discovery') store.deleteSecrets(id)
    },
  }
}

// ── the refresh lock ─────────────────────────────────────────────────────────

/** An answer read whole, so every request that waited for it gets its own copy. */
interface Captured {
  status: number
  headers: [string, string][]
  body: string
}

const replay = (answer: Captured): Response => new Response(answer.body, { status: answer.status, headers: answer.headers })

const jsonAnswer = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** The refresh token of a token request with grant_type=refresh_token; null for any other request. */
function refreshTokenOf(init: RequestInit | undefined): string | null {
  if ((init?.method ?? 'GET').toUpperCase() !== 'POST') return null
  const body = init?.body
  const form = body instanceof URLSearchParams ? body : typeof body === 'string' ? new URLSearchParams(body) : null
  if (form?.get('grant_type') !== 'refresh_token') return null
  return form.get('refresh_token')
}

/** The Bearer token a request carries. */
function bearerOf(init: RequestInit | undefined): string | null {
  const value = new Headers(init?.headers).get('authorization')
  return /^Bearer (.+)$/iu.exec(value ?? '')?.[1] ?? null
}

/** What the lock of one Integration remembers. */
interface LockState {
  /** Access tokens the service answered 401 to since the tokens were last saved. */
  refused: Set<string>
  /**
   * The last refresh that went to the service: its refresh token, its answer, and whether that answer is still on its
   * way into the store (`pending`: from the request until the tokens it gave are saved, or it failed). Dropped when it
   * failed for no reason of the token's (a failure of the service, no answer).
   */
  last: { from: string; answer: Promise<Captured>; pending: boolean } | null
}

// ── the sign-in ───────────────────────────────────────────────────────────────

export interface IntegrationOAuthOptions {
  /** The Machine's Integrations and their secrets; the app's store by default. */
  store?: TokenStore
  /** The fetch every request to the service goes through; the platform's by default. */
  fetch?: typeof globalThis.fetch
  /** Opens the sign-in window; Electron's (windowOpener) by default. */
  openWindow?: OpenWindow
  /** Starts the loopback listener of a sign-in in the system browser; listenLoopback by default. */
  listen?: typeof listenLoopback
  /** Opens a page in the system browser; Electron's shell.openExternal by default. */
  openExternal?: (url: string) => Promise<void>
  /** Clears the cookies and storage of a partition; Electron's session by default. */
  clearPartition?: (partition: string) => Promise<void>
  /** The scopes to ask for; the catalogue's by default — none, the service's metadata decides. */
  scopes?: (integration: Integration) => readonly string[]
  /** How long a sign-in waits for the person; SIGN_IN_TIMEOUT_MS by default. */
  timeoutMs?: number
  now?: () => Date
}

/** Where the person signs in: a worfy window, or the system browser for single sign-on and passkeys. */
export type SignInVia = 'window' | 'browser'

/** The app's sign-in window, made on first use: Electron's BrowserWindow fitted into main's walls. */
const appWindow: OpenWindow = (request) => {
  let wait: RedirectWait | null = null
  let closed = false
  const outcome = (async () => {
    const electron = await import('electron')
    const { allowSignInNavigation, guardBrowserSession } = await import('../../window')
    if (closed) throw new Error('The sign-in was ended.')
    const prepare = (contents: unknown, partition: string): void => {
      allowSignInNavigation(contents as import('electron').WebContents)
      guardBrowserSession(electron.session.fromPartition(partition))
    }
    wait = windowOpener(electron as unknown as WindowElectron, prepare)(request)
    return wait.outcome
  })()
  return {
    outcome,
    close: () => {
      closed = true
      wait?.close()
    },
  }
}

const openWithShell = async (url: string): Promise<void> => {
  const { shell } = await import('electron')
  await shell.openExternal(url)
}

const clearWithSession = async (partition: string): Promise<void> => {
  const { session } = await import('electron')
  await session.fromPartition(partition).clearStorageData()
}

export class IntegrationOAuth {
  private readonly locks = new Map<string, LockState>()
  private readonly running = new Set<string>()

  constructor(private readonly options: IntegrationOAuthOptions = {}) {}

  private get store(): TokenStore {
    return this.options.store ?? integrationStore()
  }

  private integration(id: string): Integration & { transport: { kind: 'http'; url: string } } {
    const integration = this.store.get(id)
    if (integration === undefined) throw new Error(`no Integration ${id} on this Machine`)
    if (integration.auth !== 'oauth' || integration.transport.kind !== 'http') throw new Error(`${integration.label} does not sign in with OAuth`)
    return integration as Integration & { transport: { kind: 'http'; url: string } }
  }

  private lock(id: string): LockState {
    let state = this.locks.get(id)
    if (state === undefined) {
      state = { refused: new Set(), last: null }
      this.locks.set(id, state)
    }
    return state
  }

  /**
   * The fetch of Integration `id`'s requests: a 401 is remembered against the access token it refused, and a refresh
   * goes to the service only when the kept access token was refused and no refresh with this refresh token went
   * before; otherwise the answer is the refresh in flight's, or the kept tokens.
   */
  private fetchOf(id: string): typeof globalThis.fetch {
    const base = this.options.fetch ?? globalThis.fetch
    return async (input, init) => {
      const state = this.lock(id)
      const spent = refreshTokenOf(init)
      if (spent === null) {
        const sent = bearerOf(init)
        const response = await base(input, init)
        if (response.status === 401 && sent !== null) state.refused.add(sent)
        return response
      }
      const kept = keptOf(this.store, id)
      const last = state.last
      // The refresh of this token on its way, or done and its access token not refused since: its answer. A service that
      // does not rotate the refresh token gets a new refresh with it once the access token it gave was refused.
      if (last?.from === spent && (last.pending || kept.access === undefined || !state.refused.has(kept.access))) return replay(await last.answer)
      if (kept.refresh !== spent) {
        // Spent by a refresh before this one, or signed out since: never sent again.
        return kept.access === undefined ? jsonAnswer(400, { error: 'invalid_grant', error_description: 'signed out' }) : this.keptAnswer(kept)
      }
      if (kept.access !== undefined && !state.refused.has(kept.access)) return this.keptAnswer(kept)
      const answer = base(input, init).then(async (response): Promise<Captured> => ({ status: response.status, headers: [...response.headers.entries()], body: await response.text() }))
      const current = { from: spent, answer, pending: true }
      state.last = current
      const forget = (): void => {
        if (state.last === current) state.last = null
      }
      try {
        const captured = await answer
        // A refusal (invalid_grant) stays the answer to this token; a failure of the service lets a later refresh try again.
        if (captured.status >= 500) forget()
        else if (captured.status >= 300) current.pending = false
        return replay(captured)
      } catch (error) {
        forget()
        throw error
      }
    }
  }

  /** The kept tokens as a token endpoint's answer, for a refresh that needs none. */
  private keptAnswer(kept: Kept): Response {
    return jsonAnswer(200, { access_token: kept.access, token_type: 'Bearer', ...(kept.refresh === undefined ? {} : { refresh_token: kept.refresh }) })
  }

  /** Tokens were saved: the refusals were of the tokens before them, and the last refresh's answer is in the store. */
  private saved(id: string): void {
    const state = this.lock(id)
    state.refused.clear()
    if (state.last !== null) state.last.pending = false
  }

  /**
   * OAuth's part of the proxy's transport of `integration`: the provider and the fetch with the refresh lock; none for
   * an Integration that does not sign in with OAuth. One with no access token kept throws MissingSecretError, so the
   * proxy answers «Sign-in needed» without asking the service.
   */
  transport(integration: Integration): OAuthTransport | undefined {
    if (integration.auth !== 'oauth' || integration.transport.kind !== 'http') return undefined
    if (keptOf(this.store, integration.id).access === undefined) throw new MissingSecretError('access')
    return { authProvider: providerOf(this.store, integration.id, () => this.saved(integration.id)), fetch: this.fetchOf(integration.id) }
  }

  /**
   * Signs Integration `id` in: the package discovers the service and registers a client when it has none, the person
   * signs in in the window or the system browser, and the code is exchanged with the PKCE verifier. Answers what the
   * sign-in shows — never a token. One sign-in per Integration at a time.
   */
  async signIn(id: string, request: { via: SignInVia } = { via: 'window' }): Promise<IntegrationSignIn> {
    const integration = this.integration(id)
    if (this.running.has(id)) throw new Error(`A sign-in of ${integration.label} is already open.`)
    this.running.add(id)
    const timeoutMs = this.options.timeoutMs ?? SIGN_IN_TIMEOUT_MS
    let wait: RedirectWait | null = null
    try {
      const { auth } = await authSdk()
      const state = randomBytes(16).toString('base64url')
      const scopes = (this.options.scopes ?? ((each: Integration) => catalogueEntry(each.service)?.scopes ?? []))(integration)
      const scope = scopes.length === 0 ? undefined : scopes.join(' ')
      const loopback = request.via === 'browser' ? await (this.options.listen ?? listenLoopback)({ id, state, timeoutMs }) : null
      wait = loopback
      let authorizationUrl: URL | null = null
      const provider = providerOf(this.store, id, () => this.saved(id), {
        redirectUrl: loopback?.redirectUrl ?? redirectUrlOf(id),
        state,
        scope,
        redirect: (url) => {
          authorizationUrl = url
        },
      })
      const serverUrl = integration.transport.url
      const fetchFn = this.fetchOf(id)
      const started = await auth(provider, { serverUrl, fetchFn, ...(scope === undefined ? {} : { scope }) })
      const url = authorizationUrl as URL | null
      if (started !== 'REDIRECT' || url === null) throw new Error(`${integration.label}: the service gave no sign-in page`)
      let current: RedirectWait
      if (loopback !== null) {
        current = loopback
        await (this.options.openExternal ?? openWithShell)(url.toString())
      } else {
        current = (this.options.openWindow ?? appWindow)({ authorizationUrl: url, id, state, partition: partitionOf(id), title: `Sign in — ${integration.label}`, timeoutMs })
        wait = current
      }
      const outcome = await current.outcome
      if ('error' in outcome) throw new Error(`${integration.label}: the service did not sign you in: ${scrubServiceText(outcome.error, [])}`)
      await auth(provider, { serverUrl, fetchFn, authorizationCode: outcome.code, ...(scope === undefined ? {} : { scope }) })
      const signIn: IntegrationSignIn = { account: null, site: null, at: (this.options.now ?? (() => new Date()))().toISOString() }
      this.store.setSignIn(id, signIn)
      return signIn
    } catch (error) {
      // The package's errors may quote an answer of the service; the tokens are never in them, the verifier stays here.
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(message.startsWith(integration.label) ? message : `${integration.label}: ${scrubServiceText(message, [])}`)
    } finally {
      wait?.close()
      this.running.delete(id)
    }
  }

  /**
   * Signs Integration `id` out: its refresh and access tokens revoked at the service's revocation endpoint when it has
   * one — a service that does not answer does not stop the rest — every `<id>:*` key removed from the secret store, the
   * sign-in forgotten, and the cookies and storage of its partition cleared. Answers whether the service took the
   * revocation.
   */
  async signOut(id: string): Promise<{ revoked: boolean }> {
    const integration = this.integration(id)
    const kept = keptOf(this.store, id)
    let revoked = false
    if (kept.access !== undefined || kept.refresh !== undefined) {
      try {
        revoked = await this.revoke(integration.transport.url, kept)
      } catch {
        revoked = false
      }
    }
    this.store.deleteSecrets(id)
    this.store.setSignIn(id, null)
    this.locks.delete(id)
    await (this.options.clearPartition ?? clearWithSession)(partitionOf(id))
    return { revoked }
  }

  /** Revokes `kept`'s tokens (RFC 7009), the refresh token first; true when the service answered 200 to each. */
  private async revoke(serverUrl: string, kept: Kept): Promise<boolean> {
    const { discoverOAuthServerInfo } = await authSdk()
    const base = this.options.fetch ?? globalThis.fetch
    const fetchFn: typeof globalThis.fetch = (input, init) => base(input, { ...init, signal: AbortSignal.timeout(SIGN_OUT_TIMEOUT_MS) })
    // RFC 8414 metadata names it; OpenID Connect discovery metadata may too, outside its type.
    const metadata = (await discoverOAuthServerInfo(serverUrl, { fetchFn })).authorizationServerMetadata as { revocation_endpoint?: unknown } | undefined
    const endpoint = metadata?.revocation_endpoint
    if (typeof endpoint !== 'string') return false
    const client = kept.client
    let all = true
    for (const [hint, token] of [
      ['refresh_token', kept.refresh],
      ['access_token', kept.access],
    ] as const) {
      if (token === undefined) continue
      const form = new URLSearchParams({ token, token_type_hint: hint })
      const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
      if (client !== undefined) {
        const secret = 'client_secret' in client ? client.client_secret : undefined
        const method = 'token_endpoint_auth_method' in client ? client.token_endpoint_auth_method : undefined
        if (secret !== undefined && method === 'client_secret_basic') headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(client.client_id)}:${encodeURIComponent(secret)}`).toString('base64')}`
        else {
          form.set('client_id', client.client_id)
          if (secret !== undefined) form.set('client_secret', secret)
        }
      }
      const answer = await fetchFn(endpoint, { method: 'POST', headers, body: form, redirect: 'manual' })
      await answer.body?.cancel()
      if (answer.status !== 200) all = false
    }
    return all
  }
}

let appOAuth: IntegrationOAuth | undefined

/** The OAuth sign-in of this Machine's Integrations, shared by the channels and the proxy. */
export function integrationOAuth(): IntegrationOAuth {
  appOAuth ??= new IntegrationOAuth()
  return appOAuth
}

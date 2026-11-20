// Sign-in with a token (worfy-integrations ticket 04; ADR-0111; spec, implementation decisions, sign-in by token).
// The token is kept in the Integration store's secret store under `<id>:access`, the secret variables of a stdio
// server under `<id>:env:<NAME>` (src/main/integrations/store.ts), and read from there on every connection, so a new
// token takes effect on the next one. The ways:
// - Bearer — `Authorization: Bearer <token>`: a Linear API key, a GitHub personal access token, a Notion MCP token,
//   an Atlassian service account token;
// - Basic — `Authorization: Basic base64(<e-mail>:<token>)`: an Atlassian API token; `<id>:access` keeps
//   `<e-mail>:<token>` whole, made by basicSecret();
// - a header of the server's own (a custom server): `<headerName>: <token>`;
// - the secret variables of a stdio server: in the environment of its process, never in its arguments.
// OAuth (ticket 05) signs in through the transport's authProvider, not through a header from here.
//
// The check is the service's own `initialize` with that header, one POST without the MCP SDK's Client: 401 is
// `needs-sign-in`, 403 and anything else that is not an MCP answer is `error` with the service's text. Atlassian lets a
// token in only when the organisation admin turned token sign-in on, so its refusal names that page. A token never
// goes into a message, a log line or an answer: every text from the service passes scrubServiceText().
import { z } from 'zod'
import { catalogueEntry } from '../../../shared/integrations/catalogue'
import type { Integration, IntegrationSecretPart, IntegrationSignIn, IntegrationStatus } from '../../../shared/integrations/types'
import { redactSecrets } from '../../../shared/terminal-ai/redact'
import { accountAuth, type GhRunner } from '../../github/prs'

/** Reads a secret of one Integration; undefined when it is not kept. */
export type SecretReader = (part: IntegrationSecretPart) => string | undefined

/** A secret the sign-in needs is not kept. The message names the part, never a value. */
export class MissingSecretError extends Error {
  constructor(readonly part: IntegrationSecretPart) {
    super(`the secret ${part} is not kept`)
  }
}

/** The ways to sign in that send a token the user gave. */
export const TOKEN_AUTH: readonly Integration['auth'][] = ['bearer', 'basic', 'header']

function required(read: SecretReader, part: IntegrationSecretPart): string {
  const value = read(part)
  if (value === undefined || value === '') throw new MissingSecretError(part)
  return value
}

/** What `<id>:access` keeps for Basic: `<e-mail>:<token>`. An e-mail with a colon cannot be told from its token. */
export function basicSecret(email: string, token: string): string {
  const address = email.trim()
  if (address === '') throw new Error('Basic sign-in needs the e-mail')
  if (address.includes(':')) throw new Error('the e-mail of Basic sign-in cannot have a colon in it')
  if (token === '') throw new Error('Basic sign-in needs the token')
  return `${address}:${token}`
}

/** The e-mail of a Basic secret; throws, without quoting the secret, when it has none. */
function basicEmail(secret: string): string {
  const colon = secret.indexOf(':')
  if (colon <= 0 || colon === secret.length - 1) throw new Error('Basic sign-in keeps the e-mail and the token as <e-mail>:<token>; this one has no e-mail')
  return secret.slice(0, colon)
}

/**
 * The headers of the Integration's sign-in, for every request to its server; `{}` for `none` and for `oauth`, whose
 * token the transport's authProvider adds (ticket 05). A token that is not kept throws MissingSecretError.
 */
export function signInHeaders(integration: Integration, read: SecretReader): Record<string, string> {
  switch (integration.auth) {
    case 'bearer':
      return { Authorization: `Bearer ${required(read, 'access')}` }
    case 'basic': {
      const secret = required(read, 'access')
      basicEmail(secret)
      return { Authorization: `Basic ${Buffer.from(secret, 'utf8').toString('base64')}` }
    }
    case 'header': {
      if (integration.headerName === null) throw new Error(`Integration ${integration.id} signs in with a header but names none`)
      return { [integration.headerName]: required(read, 'access') }
    }
    case 'none':
    case 'oauth':
      return {}
  }
}

/** The part of the Integration store the sign-in reads; IntegrationStore is one. */
export interface SecretSource {
  get(id: string): Integration | undefined
  secret(id: string, part: IntegrationSecretPart): string | undefined
}

/** The sign-in headers of Integration `id`, read from the store now: the proxy (ticket 06) asks on every connection. */
export function connectionHeaders(store: SecretSource, id: string): Record<string, string> {
  const integration = store.get(id)
  if (integration === undefined) throw new Error(`no Integration ${id} on this Machine`)
  return signInHeaders(integration, (part) => store.secret(id, part))
}

/** How to start a stdio server: its command, its arguments as the user gave them, and its own variables. */
export interface StdioLaunch {
  command: string
  args: string[]
  /** The plain variables and the secret ones; the caller adds the base environment of the process. */
  env: Record<string, string>
}

/** The launch of a stdio Integration with its secret variables in `env`, never in `args`; a secret not kept throws. */
export function stdioLaunch(integration: Integration, read: SecretReader): StdioLaunch {
  const { transport } = integration
  if (transport.kind !== 'stdio') throw new Error(`Integration ${integration.id} is not a stdio server`)
  const env: Record<string, string> = { ...transport.env }
  for (const name of transport.secretEnv) env[name] = required(read, `env:${name}`)
  return { command: transport.command, args: [...transport.args], env }
}

/** How long a service's text may be in a status. */
const TEXT_LIMIT = 400

/**
 * What the service said, fit for a status: each of `secrets` and its base64 form hidden, then anything shaped like a
 * credential (redactSecrets), then cut to TEXT_LIMIT characters.
 */
export function scrubServiceText(text: string, secrets: readonly string[]): string {
  let out = text
  for (const secret of secrets) {
    if (secret.length === 0) continue
    for (const form of [secret, Buffer.from(secret, 'utf8').toString('base64')]) out = out.split(form).join('[redacted]')
  }
  out = redactSecrets(out).replace(/\s+/gu, ' ').trim()
  return out.length > TEXT_LIMIT ? `${out.slice(0, TEXT_LIMIT - 1)}…` : out
}

/** The values in `headers` and their parts after a space (`Bearer x`) and of a Basic pair: what must not leak. */
function secretsOf(headers: Record<string, string>): string[] {
  const out: string[] = []
  for (const value of Object.values(headers)) {
    out.push(value)
    const credential = /^(?:Bearer|Basic) (.+)$/u.exec(value)?.[1]
    if (credential === undefined) continue
    out.push(credential)
    if (value.startsWith('Basic ')) {
      const pair = Buffer.from(credential, 'base64').toString('utf8')
      out.push(pair, pair.slice(pair.indexOf(':') + 1))
    }
  }
  return out.filter((secret) => secret.length >= 4)
}

const PROTOCOL_VERSION = '2025-06-18'
/** How long the check waits for the service's answer. */
const CHECK_TIMEOUT_MS = 15_000

const rpcAnswerSchema = z.object({
  jsonrpc: z.literal('2.0'),
  result: z.object({ protocolVersion: z.string() }).loose().optional(),
  error: z.object({ message: z.string() }).loose().optional(),
})

/** The first JSON-RPC message of an answer in JSON or in a server-sent event stream; null when there is none. */
function rpcAnswer(contentType: string, body: string): z.output<typeof rpcAnswerSchema> | null {
  const candidates = contentType.includes('text/event-stream')
    ? body
        .split(/\r?\n/u)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
    : [body]
  for (const candidate of candidates) {
    try {
      const parsed = rpcAnswerSchema.safeParse(JSON.parse(candidate))
      if (parsed.success) return parsed.data
    } catch {
      // Not JSON: the next event.
    }
  }
  return null
}

/** The text of a refusal: the `error_description`, `message` or `error` of a JSON body, else the body itself. */
function refusalText(body: string): string {
  try {
    const json = JSON.parse(body) as Record<string, unknown>
    const error = json.error
    for (const value of [json.error_description, json.message, typeof error === 'object' && error !== null ? (error as Record<string, unknown>).message : error, json.detail]) {
      if (typeof value === 'string' && value.trim() !== '') return value
    }
  } catch {
    // Not JSON: the body as it is.
  }
  return body
}

/** Atlassian's refusal of a token: its own text and where the admin turns token sign-in on. */
function atlassianRefusal(text: string, status: number): string {
  const note = catalogueEntry('atlassian')?.tokenNote
  const said = text === '' ? `Atlassian refused the token (${status})` : `Atlassian refused the token: ${text}`
  if (note === null || note === undefined) return said
  return `${said}. ${note.text} ${note.url}`
}

export interface CheckOptions {
  /** fetch of the platform by default; tests pass none, the stub answers on 127.0.0.1. */
  fetch?: typeof globalThis.fetch
  /** How long to wait for the answer; CHECK_TIMEOUT_MS by default. */
  timeoutMs?: number
}

/** The answer of a sign-in check: never `checking`. */
export type CheckedStatus = Exclude<IntegrationStatus, { state: 'checking' }>

/**
 * Asks the Integration's server `initialize` with the sign-in `headers`: an MCP answer is `signed-in`, 401
 * `needs-sign-in`, anything else `error` with the service's text, scrubbed. A session the server opened is ended with
 * DELETE. Only for an http Integration.
 */
export async function checkSignIn(integration: Integration, headers: Record<string, string>, options: CheckOptions = {}): Promise<CheckedStatus> {
  const { transport } = integration
  if (transport.kind !== 'http') throw new Error(`Integration ${integration.id} is not an http server`)
  const doFetch = options.fetch ?? globalThis.fetch
  const secrets = secretsOf(headers)
  const host = (() => {
    try {
      return new URL(transport.url).host
    } catch {
      return 'the server'
    }
  })()
  const atlassian = integration.service === 'atlassian'
  let response: Response
  let body: string
  try {
    response = await doFetch(transport.url, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'worfy', version: '1' } } }),
      signal: AbortSignal.timeout(options.timeoutMs ?? CHECK_TIMEOUT_MS),
    })
    body = await response.text()
  } catch (error) {
    const reason = error instanceof Error ? (error.cause instanceof Error && 'code' in error.cause ? String(error.cause.code) : error.name === 'TimeoutError' ? 'no answer in time' : error.message) : String(error)
    return { state: 'error', message: scrubServiceText(`Could not reach ${host}: ${reason}`, secrets) }
  }
  const text = scrubServiceText(refusalText(body), secrets)
  if (response.status === 401 || response.status === 403) {
    if (atlassian) return { state: 'error', message: atlassianRefusal(text, response.status) }
    if (response.status === 401) return { state: 'needs-sign-in' }
    return { state: 'error', message: text === '' ? `${host} refused the sign-in (403)` : text }
  }
  if (!response.ok) return { state: 'error', message: `${host} answered ${response.status}${text === '' ? '' : `: ${text}`}` }
  const answer = rpcAnswer(response.headers.get('content-type') ?? '', body)
  const session = response.headers.get('mcp-session-id')
  if (session !== null) {
    // The check needs no session: end it, as the protocol asks; a server that cannot is no reason to fail the check.
    await doFetch(transport.url, { method: 'DELETE', headers: { ...headers, 'mcp-session-id': session }, signal: AbortSignal.timeout(options.timeoutMs ?? CHECK_TIMEOUT_MS) })
      .then((ended) => ended.body?.cancel())
      .catch(() => undefined)
  }
  if (answer?.result !== undefined) return { state: 'signed-in' }
  if (answer?.error !== undefined) return { state: 'error', message: scrubServiceText(`${host}: ${answer.error.message}`, secrets) }
  return { state: 'error', message: `${host} did not answer initialize as an MCP server` }
}

/** The part of the Integration store a token sign-in reads and writes; IntegrationStore is one. */
export interface TokenStore extends SecretSource {
  setSecret(id: string, part: IntegrationSecretPart, value: string): void
  setSignIn(id: string, signIn: IntegrationSignIn | null): Integration
  deleteSecrets(id: string): void
}

/** The check a sign-in runs; checkSignIn by default. */
export type SignInCheck = (integration: Integration, headers: Record<string, string>) => Promise<CheckedStatus>

/** Whether Integration `integration` signs in with a token worfy can check: a token way over http. */
export function checksToken(integration: Integration): boolean {
  return TOKEN_AUTH.includes(integration.auth) && integration.transport.kind === 'http'
}

/**
 * Checks the token Integration `id` keeps and records the outcome: `signed-in` keeps the sign-in (the account is the
 * e-mail of a Basic secret, or `account`), anything else clears it. A token that is not kept is `needs-sign-in`
 * without asking the service.
 */
export async function verifyTokenSignIn(store: TokenStore, id: string, options: { check?: SignInCheck; account?: string | null; now?: () => Date } = {}): Promise<CheckedStatus> {
  const integration = store.get(id)
  if (integration === undefined) throw new Error(`no Integration ${id} on this Machine`)
  if (!checksToken(integration)) throw new Error(`Integration ${id} does not sign in with a token over http`)
  let headers: Record<string, string>
  try {
    headers = connectionHeaders(store, id)
  } catch (error) {
    store.setSignIn(id, null)
    if (error instanceof MissingSecretError) return { state: 'needs-sign-in' }
    return { state: 'error', message: error instanceof Error ? error.message : 'the sign-in could not be read' }
  }
  const status = await (options.check ?? checkSignIn)(integration, headers)
  if (status.state !== 'signed-in') {
    store.setSignIn(id, null)
    return status
  }
  const secret = integration.auth === 'basic' ? store.secret(id, 'access') : undefined
  const account = secret === undefined ? (options.account ?? null) : basicEmail(secret)
  store.setSignIn(id, { account, site: null, at: (options.now ?? (() => new Date()))().toISOString() })
  return status
}

/** Sign out of a token: every `<id>:*` key leaves the secret store, and the Integration needs sign-in. */
export function signOut(store: TokenStore, id: string): void {
  store.deleteSecrets(id)
  store.setSignIn(id, null)
}

// ── the token of the Project's gh account ────────────────────────────────────

const ghStatusSchema = z.object({
  hosts: z.record(z.string(), z.array(z.object({ login: z.string(), scopes: z.string().nullish() }).loose()).catch([])),
})

/** What Add integration shows for GitHub when the Project has a gh account: the account and its scopes, never the token. */
export interface GhTokenOffer {
  account: string
  /** The scopes of the account's token as gh reports them; null when this gh does not say. */
  scopes: string[] | null
  warning: string
}

export interface GhTokenOptions {
  /** The Project's GitHub account (src/main/workflow/profile.ts); null when it has none. */
  account: string | null
  /** The runner gh goes through: the app's own, WORFY_GH in tests. */
  run: GhRunner
  /** The Project's folder, where gh runs. */
  root: string
}

/** The scopes of `account` on github.com from `gh auth status --json hosts`; null when this gh cannot say. */
async function ghScopes(account: string, run: GhRunner, root: string): Promise<string[] | null> {
  try {
    const parsed = ghStatusSchema.safeParse(JSON.parse(await run(['auth', 'status', '--json', 'hosts'], root)))
    if (!parsed.success) return null
    const entry = (parsed.data.hosts['github.com'] ?? []).find((candidate) => candidate.login === account)
    if (entry?.scopes === undefined || entry.scopes === null) return null
    return entry.scopes
      .split(',')
      .map((scope) => scope.trim().replace(/^'|'$/gu, ''))
      .filter((scope) => scope !== '')
  } catch {
    return null
  }
}

/**
 * The offer of the gh account's token for a GitHub Integration, with a warning about what the token may do; null
 * when the Project has no gh account. The token itself is not read here.
 */
export async function offerGhToken(options: GhTokenOptions): Promise<GhTokenOffer | null> {
  const { account } = options
  if (account === null) return null
  const scopes = await ghScopes(account, options.run, options.root)
  const what = scopes === null ? 'gh does not say what scopes it has' : scopes.length === 0 ? 'it has no scopes' : `it has the scopes ${scopes.join(', ')}`
  const warning = `This is the token of the gh account ${account}: ${what}. Agents using this Integration can do on GitHub whatever the token allows. A personal access token with fewer scopes keeps them narrower.`
  return { account, scopes, warning }
}

/**
 * Signs a GitHub Integration in with the token of the Project's gh account: a copy goes to the secret store under
 * `<id>:access` and is checked like a token the user typed; the gh login becomes the account of the sign-in.
 */
export async function signInWithGhToken(options: GhTokenOptions & { store: TokenStore; id: string; check?: SignInCheck }): Promise<CheckedStatus> {
  const { account } = options
  if (account === null) throw new Error('the Project has no GitHub account')
  const env = await accountAuth({ account: () => Promise.resolve(account), run: options.run })(options.root)
  const token = env.GH_TOKEN
  if (token === undefined) throw new Error(`gh gave no token for ${account}`)
  options.store.setSecret(options.id, 'access', token)
  return verifyTokenSignIn(options.store, options.id, { account, ...(options.check === undefined ? {} : { check: options.check }) })
}

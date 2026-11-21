// The proxy of the Integrations (worfy-integrations ticket 06; ADR-0111 item 1; spec, implementation decisions, Proxy):
// an Integration reaches a Session as an MCP server of worfy's (McpServer, src/main/vendors/mcp.ts) whose tools are the
// service's. worfy main keeps the connection to the service — the MCP SDK's Client over streamable HTTP, or over the
// stdio of a process worfy starts itself — one per Integration and Machine, shared by every Session that uses it.
//
// - The sign-in: the headers of a token sign-in (ticket 04, connectionHeaders) are read from the secret store each time
//   a connection opens, and a call checks they are still the same: a new token opens a new connection. The secret
//   variables of a stdio server go into its environment, never its arguments (stdioLaunch); its stderr is not read.
//   OAuth (ticket 05) plugs its provider in through `oauth`, the transport's own place for it: the transport refreshes
//   an expired token itself and throws UnauthorizedError when it cannot; the one-refresh-at-a-time lock of the spike
//   of ticket 01 (step 5) belongs in the transport's `fetch`, which the same option carries.
// - A Session's server (sessionServer) lists the service's tools once per Session start and keeps the list: the
//   Project's tools filter (all, read-only by the service's readOnlyHint, or names) cuts it, a tool whose full name
//   `mcp__<server>__<tool>` would pass 128 characters is left out (Claude Code drops it without a word, the spike's
//   3.5) and named in the status, and each description is led by the label («[Jira — client A] …»), so an agent with
//   two accounts of one service tells them apart. A call of a tool the list lacks is refused before the service.
// - A refused sign-in (401, a token not kept, OAuth's UnauthorizedError) answers the tool call with isError
//   «Sign-in needed: <label>. Ask the user to sign in in worfy» and sets the status `needs-sign-in`; a session the
//   service forgot (404) is opened again once; a call the agent cancelled or that ran past its time limit fails alone;
//   any other failure of the connection drops it, so the next call opens a new one. A changed sign-in opens one new
//   connection however many calls find it; the old one closes when its last call ends. An Integration removed from the
//   Machine, or one whose connection failed while worfy restarted, answers an error that names it; the removal and the
//   app's quit close its connection (src/main/ipc/integrations.ts).
// - Nothing a Session gets carries a secret: every text from the service — the text blocks of an answer and the
//   message of an error — passes scrubServiceText with the Integration's secrets. A log line names the Integration's
//   id and the kind of the failure, never its message.
//
// The first version passes tools only (the spec's decision 4, confirmed by the owner; the spike of ticket 01 found
// the stub, Claude and Codex need nothing else): text, images and links to resources as the service gave them.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Integration, IntegrationSecretPart, IntegrationStatus, IntegrationTools, ProjectIntegration } from '../../shared/integrations/types'
import type { McpJsonSchema, McpServer, McpTool, McpToolContent, McpToolResult } from '../vendors/mcp'
import { agentEnv } from '../agent/env'
import { connectionHeaders, MissingSecretError, scrubServiceText, stdioLaunch, type SecretSource } from './auth/tokens'
import { integrationStore } from './store'

// ── the name of an Integration's server in a Session ─────────────────────────

/** The longest server name: `mcp__<server>__<tool>` then leaves a tool 97 characters (the spike of ticket 01, 3.5). */
export const SERVER_NAME_MAX = 24
/** The longest full name of a tool Claude Code keeps; a longer one it drops without a word. */
export const TOOL_NAME_MAX = 128
/** The prefix of worfy's own servers (worfy-canvas, worfy-browser, worfy-mind-map): no Integration takes a name under it. */
const WORFY_PREFIX = 'worfy-'
/** The slug of a label with no Latin letter or digit in it. */
const FALLBACK_SLUG = 'integration'

/** The full name Claude Code gives a tool of the server `server`. */
export const fullToolName = (server: string, tool: string): string => `mcp__${server}__${tool}`

/** Whether Claude Code keeps the tool `tool` of the server `server`: its full name is at most 128 characters. */
export const toolNameFits = (server: string, tool: string): boolean => fullToolName(server, tool).length <= TOOL_NAME_MAX

/** `slug` cut to `max` characters, without a `-` at its end. */
const cut = (slug: string, max: number): string => slug.slice(0, max).replace(/-+$/u, '')

/**
 * The slug of a label: Latin letters (accents dropped) and digits in lowercase, one `-` for each run of anything else,
 * at most SERVER_NAME_MAX characters; `integration` when nothing is left.
 */
export function serverNameSlug(label: string): string {
  const slug = label
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  const short = cut(slug, SERVER_NAME_MAX)
  return short === '' ? FALLBACK_SLUG : short
}

/** The server name of an Integration in the Sessions of a Project, and why it is not its slug, when it is not. */
export interface IntegrationServerName {
  id: string
  name: string
  /** For the Integration's row: what its slug clashed with, and the name it got; null when it got its slug. */
  warning: string | null
}

/**
 * The server names of a Project's Integrations, in their order: each its slug, unless the slug is the name of another
 * Integration before it, a name of `taken` (the servers of Claude Code from the MCP inventory's last answer; compared
 * without case) or under worfy's prefix `worfy-` — then the slug with `-2`, `-3`… (cut so the name stays within
 * SERVER_NAME_MAX), and a warning.
 */
export function integrationServerNames(integrations: readonly { id: string; label: string }[], taken: readonly string[]): IntegrationServerName[] {
  const claude = new Set(taken.map((name) => name.toLowerCase()))
  const used = new Set<string>()
  return integrations.map(({ id, label }) => {
    const slug = serverNameSlug(label)
    const clash = (name: string): string | null => (used.has(name) ? 'another Integration of this Project' : claude.has(name) ? 'a server of Claude Code' : null)
    // A slug under worfy's prefix gets a suffix too: worfy-canvas-2 is not worfy's, and never shadows a server of it.
    const first = slug.startsWith(WORFY_PREFIX) ? "worfy's own servers (worfy-…)" : clash(slug)
    let name = slug
    for (let n = 2; first !== null && (name === slug || clash(name) !== null); n++) {
      const suffix = `-${n}`
      name = `${cut(slug, SERVER_NAME_MAX - suffix.length)}${suffix}`
    }
    used.add(name)
    return { id, name, warning: first === null ? null : `The name ${slug} is taken by ${first}: this Integration's server is ${name}.` }
  })
}

// ── the tools ─────────────────────────────────────────────────────────────────

/** A tool as the service lists it: what the proxy reads of tools/list. */
export interface ServiceTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  annotations?: Record<string, unknown>
}

/** How many tools, and their size in tokens: the length of the JSON of their names, descriptions and schemas over 4. */
export interface ToolsCost {
  count: number
  tokens: number
}

/** The cost of `tools` in each request to the model: their count, and the length of their JSON over 4 as tokens. */
export function toolsCost(tools: readonly ServiceTool[]): ToolsCost {
  const json = JSON.stringify(tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })))
  return { count: tools.length, tokens: Math.ceil(json.length / 4) }
}

/** The tools of `tools` the Project's filter lets through: all, those the service marks readOnlyHint, or those named. */
export function filterTools<T extends ServiceTool>(tools: readonly T[], filter: IntegrationTools): T[] {
  if (filter === 'all') return [...tools]
  if (filter === 'read-only') return tools.filter((tool) => tool.annotations?.readOnlyHint === true)
  const names = new Set(filter)
  return tools.filter((tool) => names.has(tool.name))
}

// ── the status ────────────────────────────────────────────────────────────────

/** What the proxy knows of an Integration: its sign-in, the price of its tools, and the tools no agent sees. */
export interface IntegrationProxyStatus {
  status: Exclude<IntegrationStatus, { state: 'checking' }>
  /** The service's tools by its last tools/list, before any filter; null before the first. */
  tools: ToolsCost | null
  /** Tools the last Session's server left out: their full name would pass TOOL_NAME_MAX. */
  hidden: string[]
}

/** The answer of a tool call that needs a sign-in. */
export const signInNeeded = (label: string): string => `Sign-in needed: ${label}. Ask the user to sign in in worfy.`

// ── the proxy ─────────────────────────────────────────────────────────────────

/** An Integration as a Session gets it: its id, its server name in the Session and the Project's tools filter. */
export interface SessionEntry {
  id: string
  name: string
  tools: IntegrationTools
}

/** What OAuth (ticket 05) gives a transport: its provider, and a fetch that keeps one refresh at a time. */
export type OAuthTransport = Pick<StreamableHTTPClientTransportOptions, 'authProvider' | 'fetch'>

export interface IntegrationProxyOptions {
  /** The Machine's Integrations and their secrets; the app's store by default. */
  store?: SecretSource
  /**
   * The environment a stdio server starts from, before its own variables. By default the MCP SDK's short safe list
   * (HOME, PATH, USER… — never worfy's whole environment) with the PATH of the agent environment (src/main/agent/env.ts:
   * the login shell on macOS), so a command such as `npx` is found as in a terminal.
   */
  baseEnv?: () => Promise<Record<string, string>>
  /** OAuth's part of an http transport (ticket 05); none until then. */
  oauth?: (integration: Integration) => OAuthTransport | undefined
  /** How long one tool call may take; CALL_TIMEOUT_MS by default. */
  callTimeoutMs?: number
}

/** How long a tool call may take: a service's tool may run long, and the agent can cancel it. */
export const CALL_TIMEOUT_MS = 10 * 60 * 1000
/** At most this many pages of tools/list. */
const MAX_PAGES = 50

/** The MCP SDK's parts the proxy uses, loaded on first use: a Session start loads them, not the app's start. */
async function mcpSdk() {
  const [client, http, stdio, types, auth] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js'),
    import('@modelcontextprotocol/sdk/types.js'),
    import('@modelcontextprotocol/sdk/client/auth.js'),
  ])
  return {
    Client: client.Client,
    StreamableHTTPClientTransport: http.StreamableHTTPClientTransport,
    StreamableHTTPError: http.StreamableHTTPError,
    StdioClientTransport: stdio.StdioClientTransport,
    getDefaultEnvironment: stdio.getDefaultEnvironment,
    McpError: types.McpError,
    UnauthorizedError: auth.UnauthorizedError,
  }
}
type McpSdk = Awaited<ReturnType<typeof mcpSdk>>

/** The MCP SDK's safe list of variables with the PATH of the agent environment; the SDK's list alone when that fails. */
async function defaultBaseEnv(sdk: McpSdk): Promise<Record<string, string>> {
  const base = sdk.getDefaultEnvironment()
  try {
    const { env } = await agentEnv()
    const path = env.PATH ?? env.Path
    return path === undefined ? base : { ...base, PATH: path }
  } catch {
    return base
  }
}

/** One open connection to a service. */
interface Live {
  client: Client
  /** The secrets it was opened with: what scrubServiceText hides, and how a changed sign-in is told. */
  secrets: string[]
  fingerprint: string
  /** Which opening of the Integration's connection this is: a failure of an older one leaves the status alone. */
  generation: number
  /** Calls and lists running on it now. */
  inFlight: number
  /** A newer connection replaced it: it closes when its last call ends. */
  retired: boolean
}

/** Why a call or a list failed. */
type Failure =
  | { kind: 'sign-in' }
  | { kind: 'gone' }
  /** The service forgot the session (404): open again once. */
  | { kind: 'expired' }
  /** The service answered an error of the protocol: the connection stays. */
  | { kind: 'service'; message: string }
  /** This one request ended early — cancelled by the agent, or past its time limit: the connection stays. */
  | { kind: 'call'; message: string }
  /** The connection failed: dropped, the next call opens another. */
  | { kind: 'connection'; message: string }

/** An Integration that is no longer on the Machine. */
class IntegrationGone extends Error {}

/** A tool list the service refused because of the sign-in, with nothing listed before. */
class SignInNeededError extends Error {}

export class IntegrationProxy {
  private readonly store: SecretSource
  private readonly connections = new Map<string, Promise<Live>>()
  /** Connections a newer one replaced while calls still ran on them, by Integration (retire). */
  private readonly replaced = new Map<string, Set<Live>>()
  /** The generation of each Integration's newest connection (Live.generation). */
  private readonly generations = new Map<string, number>()
  private readonly statuses = new Map<string, IntegrationProxyStatus>()
  /** The last list of each Integration's tools, for a Session that starts while the service refuses the sign-in. */
  private readonly lastTools = new Map<string, ServiceTool[]>()
  private sdk: Promise<McpSdk> | null = null

  constructor(private readonly options: IntegrationProxyOptions = {}) {
    this.store = options.store ?? integrationStore()
  }

  /** What the proxy knows of Integration `id`; null before it first spoke to its service. */
  status(id: string): IntegrationProxyStatus | null {
    const known = this.statuses.get(id)
    return known === undefined ? null : { ...known, hidden: [...known.hidden] }
  }

  /**
   * The service's whole tool list for the screen's count and Test (worfy-integrations ticket 08), before any filter,
   * on the shared connection; it fails as a Session's tools/list does, and leaves status() as that would.
   */
  serviceToolsOf(id: string): Promise<ServiceTool[]> {
    return this.serviceTools(id, this.store.get(id)?.label ?? id)
  }

  private setStatus(id: string, change: Partial<IntegrationProxyStatus>): void {
    const was = this.statuses.get(id) ?? { status: { state: 'signed-in' }, tools: null, hidden: [] }
    this.statuses.set(id, { ...was, ...change })
  }

  private loadSdk(): Promise<McpSdk> {
    this.sdk ??= mcpSdk()
    return this.sdk
  }

  /**
   * The server of the Integration `entry.id` for one Session start, under the name `entry.name`: its tools listed once
   * and kept, cut by `entry.tools`. The label is read with the list, so a rename reaches the next start.
   */
  sessionServer(entry: SessionEntry): McpServer {
    let listing: Promise<readonly McpTool[]> | null = null
    let label = this.store.get(entry.id)?.label ?? entry.name
    const list = async (): Promise<readonly McpTool[]> => {
      const integration = this.store.get(entry.id)
      if (integration === undefined) throw new Error(`${label} is no longer on this Machine: restart the Session without it.`)
      label = integration.label
      const all = await this.serviceTools(entry.id, label)
      const shown = filterTools(all, entry.tools)
      const hidden = shown.filter((tool) => !toolNameFits(entry.name, tool.name)).map((tool) => tool.name)
      this.setStatus(entry.id, { hidden })
      return shown
        .filter((tool) => toolNameFits(entry.name, tool.name))
        .map((tool): McpTool => ({
          name: tool.name,
          description: `[${label}] ${tool.description ?? ''}`.trimEnd(),
          inputSchema: { ...tool.inputSchema, type: 'object' } as McpJsonSchema,
          ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
          call: (args, extra) => this.callTool(entry.id, label, tool.name, args, extra?.signal),
        }))
    }
    return {
      name: entry.name,
      version: '1.0.0',
      tools: [],
      listTools: () => {
        // A failed list is not kept: the next tools/list asks again.
        listing ??= list().catch((error: unknown) => {
          listing = null
          throw error
        })
        return listing
      },
    }
  }

  /** The service's tools, every page; with the sign-in refused, the last list known, or SignInNeededError. */
  private async serviceTools(id: string, label: string): Promise<ServiceTool[]> {
    const outcome = await this.withConnection(id, async (live) => {
      const tools: ServiceTool[] = []
      let cursor: string | undefined
      for (let page = 0; page < MAX_PAGES; page++) {
        const answer = await live.client.listTools(cursor === undefined ? undefined : { cursor })
        tools.push(...(answer.tools as ServiceTool[]))
        cursor = answer.nextCursor
        if (cursor === undefined) break
      }
      return tools
    })
    if (outcome.ok) {
      this.lastTools.set(id, outcome.value)
      this.setStatus(id, { status: { state: 'signed-in' }, tools: toolsCost(outcome.value) })
      return outcome.value
    }
    const failure = outcome.failure
    if (failure.kind === 'sign-in') {
      const known = this.lastTools.get(id)
      if (known !== undefined) return known
      throw new SignInNeededError(signInNeeded(label))
    }
    if (failure.kind === 'gone') throw new IntegrationGone(`${label} is no longer on this Machine: restart the Session without it.`)
    throw new Error(`${label}: ${failure.kind === 'expired' ? 'the service ended the session twice in a row' : failure.message}`)
  }

  /** Calls `tool` of Integration `id` with `args`; never throws. */
  private async callTool(id: string, label: string, tool: string, args: unknown, signal: AbortSignal | undefined): Promise<McpToolResult> {
    const outcome = await this.withConnection(id, async (live) => {
      const answer = await live.client.callTool({ name: tool, arguments: (args ?? {}) as Record<string, unknown> }, undefined, {
        timeout: this.options.callTimeoutMs ?? CALL_TIMEOUT_MS,
        ...(signal === undefined ? {} : { signal }),
      })
      return { answer: answer as McpToolResult, secrets: live.secrets }
    }, signal)
    if (outcome.ok) {
      this.setStatus(id, { status: { state: 'signed-in' } })
      return scrubResult(outcome.value.answer, outcome.value.secrets)
    }
    const failure = outcome.failure
    const refusal = (text: string): McpToolResult => ({ content: [{ type: 'text', text }], isError: true })
    switch (failure.kind) {
      case 'sign-in':
        return refusal(signInNeeded(label))
      case 'gone':
        return refusal(`${label} is no longer on this Machine: restart the Session without it.`)
      case 'expired':
        return refusal(`${label}: the service ended the session twice in a row; try again.`)
      case 'service':
      case 'call':
      case 'connection':
        return refusal(`${label}: ${failure.message}`)
    }
  }

  /**
   * Runs `work` on the Integration's connection, opened if needed: a changed sign-in opens a new one, a session the
   * service forgot (404) is opened again and `work` runs once more. A failure is classified and the status set — only
   * by the newest connection, so an older one that dies under its last call does not mark the new one failed. The
   * connection is dropped unless the service only answered an error of the protocol or this one request ended early.
   */
  private async withConnection<T>(id: string, work: (live: Live) => Promise<T>, signal?: AbortSignal): Promise<{ ok: true; value: T } | { ok: false; failure: Failure }> {
    for (let attempt = 0; ; attempt++) {
      let live: Live | null = null
      try {
        live = await this.connection(id)
        // Another call retired it between its opening and this turn: take the one that replaced it.
        while (live.retired) live = await this.connection(id)
        const running = live
        running.inFlight++
        try {
          return { ok: true, value: await work(running) }
        } finally {
          running.inFlight--
          if (running.retired && running.inFlight === 0) this.closeRetired(id, running)
        }
      } catch (error) {
        // Cancelled before its request went out (while the connection opened, say): the MCP SDK throws the bare reason
        // (signal.throwIfAborted, shared/protocol.js), not -32001 — still this call's end alone.
        const failure: Failure =
          live !== null && signal?.aborted === true ? { kind: 'call', message: 'the call was cancelled' } : await this.failureOf(error, live?.secrets ?? this.secretsOf(id), live !== null)
        if (failure.kind !== 'service' && failure.kind !== 'call') this.drop(id, live)
        if (failure.kind === 'expired' && attempt === 0) continue
        const newest = live === null || this.generations.get(id) === live.generation
        if (newest && failure.kind === 'sign-in') this.setStatus(id, { status: { state: 'needs-sign-in' } })
        if (newest && failure.kind === 'connection') this.setStatus(id, { status: { state: 'error', message: failure.message } })
        if (failure.kind !== 'service' && failure.kind !== 'call') console.warn(`[integrations] ${id}: ${failure.kind === 'connection' ? 'the connection failed' : failure.kind === 'sign-in' ? 'sign-in needed' : failure.kind}`)
        return { ok: false, failure }
      }
    }
  }

  /**
   * The open connection of Integration `id`, or a new one when there is none or its sign-in changed since. One opening
   * at a time: the map is read again after every wait, and a new opening replaces the old in the same turn, so calls
   * that find the sign-in changed together share one new connection. An Integration no longer on the Machine is
   * refused here, its connection closed, whatever secrets it had.
   */
  private async connection(id: string): Promise<Live> {
    for (;;) {
      const existing = this.connections.get(id)
      if (existing === undefined) {
        if (this.store.get(id) === undefined) throw new IntegrationGone()
        return this.startOpening(id)
      }
      // An opening that fails fails every call that waited for it: none of them opens again on its own.
      const live = await existing
      // Replaced or forgotten while this call waited: look again.
      if (this.connections.get(id) !== existing) continue
      if (this.store.get(id) === undefined) {
        this.connections.delete(id)
        this.retire(id, live)
        throw new IntegrationGone()
      }
      if (live.fingerprint === this.fingerprint(id)) return live
      this.retire(id, live)
      return this.startOpening(id)
    }
  }

  /** Opens a new connection of Integration `id` and makes it the one calls use. */
  private startOpening(id: string): Promise<Live> {
    const generation = (this.generations.get(id) ?? 0) + 1
    this.generations.set(id, generation)
    const opening = this.open(id, generation)
    this.connections.set(id, opening)
    opening.catch(() => {
      if (this.connections.get(id) === opening) this.connections.delete(id)
    })
    return opening
  }

  /**
   * A connection of Integration `id` a newer one replaced: closed now, or when the calls still running on it end —
   * kept in `replaced` till then, so close(id) and close() end it too.
   */
  private retire(id: string, live: Live): void {
    live.retired = true
    if (live.inFlight === 0) {
      void live.client.close().catch(() => undefined)
      return
    }
    const kept = this.replaced.get(id) ?? new Set<Live>()
    kept.add(live)
    this.replaced.set(id, kept)
  }

  /** A replaced connection of Integration `id` whose last call ended: closed and forgotten. */
  private closeRetired(id: string, live: Live): void {
    const kept = this.replaced.get(id)
    kept?.delete(live)
    if (kept?.size === 0) this.replaced.delete(id)
    void live.client.close().catch(() => undefined)
  }

  /** Every secret of Integration `id` the store keeps, and their parts that could be quoted alone. */
  private secretsOf(id: string, options: { refresh: boolean } = { refresh: true }): string[] {
    const integration = this.store.get(id)
    if (integration === undefined) return []
    const env = integration.transport.kind === 'stdio' ? integration.transport.secretEnv.map((name): IntegrationSecretPart => `env:${name}`) : []
    const parts: IntegrationSecretPart[] = ['access', ...(options.refresh ? (['refresh'] as const) : []), 'client', ...env]
    const values: string[] = []
    for (const part of parts) {
      const value = this.store.secret(id, part)
      if (value === undefined || value === '') continue
      values.push(value)
      // A Basic secret `<e-mail>:<token>`: the token alone too.
      const colon = value.indexOf(':')
      if (colon > 0) values.push(value.slice(colon + 1))
    }
    return values.filter((value) => value.length >= 4)
  }

  /**
   * What tells the sign-in a connection was opened with: the secrets a request carries, in order. Not the refresh
   * token: storing a new one changes nothing a request sends. Ticket 05 (OAuth): the authProvider hands each request
   * its access token, so a refreshed access token must not open a new connection either — leave `access` out of an
   * OAuth Integration's fingerprint there, or calls in flight on the old connection would run on a retired one.
   */
  private fingerprint(id: string): string {
    return JSON.stringify(this.secretsOf(id, { refresh: false }))
  }

  /** Opens a connection to the service of Integration `id`: `initialize` with the sign-in read now. */
  private async open(id: string, generation: number): Promise<Live> {
    const integration = this.store.get(id)
    if (integration === undefined) throw new IntegrationGone()
    const sdk = await this.loadSdk()
    const secrets = this.secretsOf(id)
    const fingerprint = this.fingerprint(id)
    const client = new sdk.Client({ name: 'worfy', version: '1.0.0' }, { capabilities: {} })
    try {
      if (integration.transport.kind === 'http') {
        const headers = connectionHeaders(this.store, id)
        const oauth = this.options.oauth?.(integration)
        const transport = new sdk.StreamableHTTPClientTransport(new URL(integration.transport.url), { requestInit: { headers }, ...oauth })
        await client.connect(transport)
      } else {
        const launch = stdioLaunch(integration, (part) => this.store.secret(id, part))
        const base = this.options.baseEnv === undefined ? await defaultBaseEnv(sdk) : await this.options.baseEnv()
        // stderr is not read: a server may print what it was started with. The MCP SDK starts the command with
        // cross-spawn, which finds a bare name on the PATH given here and runs a Windows .cmd shim (npx.cmd) through
        // cmd.exe with its arguments escaped, so no shell of worfy's own is needed.
        const transport = new sdk.StdioClientTransport({ command: launch.command, args: launch.args, env: { ...base, ...launch.env }, stderr: 'ignore' })
        await client.connect(transport)
      }
    } catch (error) {
      // A server that started but failed `initialize` is not left running.
      await client.close().catch(() => undefined)
      throw error
    }
    const live: Live = { client, secrets, fingerprint, generation, inFlight: 0, retired: false }
    client.onclose = () => {
      if (this.generations.get(id) === generation) this.connections.delete(id)
    }
    return live
  }

  /** Forgets the connection `live` of Integration `id`, unless a newer one took its place, and closes it. */
  private drop(id: string, live: Live | null): void {
    if (live === null) return
    if (this.generations.get(id) === live.generation) this.connections.delete(id)
    void live.client.close().catch(() => undefined)
  }

  /** Why `error` happened, its text scrubbed of `secrets`; `opened` — the connection was open when it happened. */
  private async failureOf(error: unknown, secrets: readonly string[], opened: boolean): Promise<Failure> {
    if (error instanceof IntegrationGone) return { kind: 'gone' }
    if (error instanceof MissingSecretError) return { kind: 'sign-in' }
    const sdk = await this.loadSdk()
    if (error instanceof sdk.UnauthorizedError) return { kind: 'sign-in' }
    if (error instanceof sdk.StreamableHTTPError) {
      if (error.code === 401) return { kind: 'sign-in' }
      // 404 to a request of an open session: the service forgot it. 404 to `initialize`: nothing answers MCP there.
      if (error.code === 404) return opened ? { kind: 'expired' } : { kind: 'connection', message: 'the address was not found (HTTP 404): check the address of the Integration' }
    }
    const message = scrubServiceText(error instanceof Error ? error.message : String(error), secrets)
    // -32001 (RequestTimeout) is how the MCP SDK ends one request the caller cancelled or that ran past its time
    // limit (shared/protocol.js): that request fails, the connection and every other call on it go on.
    if (opened && error instanceof sdk.McpError && error.code === -32001) return { kind: 'call', message: message === '' ? 'the call ended before the service answered' : message }
    if (error instanceof sdk.McpError && error.code !== -32000 && error.code !== -32001) return { kind: 'service', message }
    return { kind: 'connection', message: message === '' ? 'the service did not answer' : message }
  }

  /** Closes the connection of Integration `id`, or every connection: a stdio server's process ends with it. */
  async close(id?: string): Promise<void> {
    const ids = id === undefined ? [...new Set([...this.connections.keys(), ...this.replaced.keys()])] : [id]
    await Promise.all(
      ids.map(async (each) => {
        const opening = this.connections.get(each)
        this.connections.delete(each)
        // Calls still running on it fail as an older connection's: the status is not theirs to set.
        this.generations.set(each, (this.generations.get(each) ?? 0) + 1)
        // The connections a newer one replaced, with calls still running on them, end too.
        const replaced = [...(this.replaced.get(each) ?? [])]
        this.replaced.delete(each)
        const live = await opening?.catch(() => null)
        await Promise.all([live, ...replaced].map((connection) => connection?.client.close().catch(() => undefined)))
      }),
    )
  }
}

/** `result` with every secret hidden in its text blocks. */
function scrubResult(result: McpToolResult, secrets: readonly string[]): McpToolResult {
  if (secrets.length === 0) return result
  const content = result.content.map((block): McpToolContent => (block.type === 'text' ? { ...block, text: hide(block.text, secrets) } : block))
  const structured = result.structuredContent
  const scrubbed = structured === undefined ? {} : { structuredContent: JSON.parse(hide(JSON.stringify(structured), secrets.map((secret) => JSON.stringify(secret).slice(1, -1)))) as unknown }
  return { ...result, content, ...scrubbed }
}

/** `text` with each of `secrets` and its base64 form replaced by `[redacted]`; nothing else changed. */
function hide(text: string, secrets: readonly string[]): string {
  let out = text
  for (const secret of secrets) {
    if (secret.length === 0) continue
    for (const form of [secret, Buffer.from(secret, 'utf8').toString('base64')]) out = out.split(form).join('[redacted]')
  }
  return out
}

/** An Integration a Session gets: its server name and label, and the server itself. */
export interface SessionIntegration {
  name: string
  label: string
  server: McpServer
}

export interface SessionIntegrationsInput {
  /** The Project's `integrations` (its settings.json). */
  entries: readonly ProjectIntegration[]
  /** The Machine's Integrations: an id it does not have is skipped (the review of ticket 03). */
  store: Pick<SecretSource, 'get'>
  proxy: Pick<IntegrationProxy, 'sessionServer'>
  /** No person is at the Session (Autopilot): only the Integrations «Available to Autopilot» (ADR-0111 item 7). */
  unattended: boolean
  /** The servers of Claude Code from the MCP inventory's last answer: no Integration takes their names. */
  taken: readonly string[]
}

/**
 * The Integrations a Session of the Project gets: each enabled entry the Machine still has, under its server name —
 * the names given over every enabled Integration, so an unattended Session's are the same — and for an unattended
 * Session only those «Available to Autopilot».
 */
export function sessionIntegrations(input: SessionIntegrationsInput): SessionIntegration[] {
  const known = input.entries.flatMap((entry) => {
    if (!entry.enabled) return []
    const integration = input.store.get(entry.id)
    return integration === undefined ? [] : [{ entry, label: integration.label }]
  })
  const names = integrationServerNames(
    known.map(({ entry, label }) => ({ id: entry.id, label })),
    input.taken,
  )
  return known.flatMap(({ entry, label }, index) => {
    if (input.unattended && !entry.autopilot) return []
    const name = names[index]?.name ?? serverNameSlug(label)
    return [{ name, label, server: input.proxy.sessionServer({ id: entry.id, name, tools: entry.tools }) }]
  })
}

let appProxy: IntegrationProxy | undefined

/** The proxy of this Machine's Integrations, shared by every Session of the app. */
export function integrationProxy(): IntegrationProxy {
  appProxy ??= new IntegrationProxy()
  return appProxy
}

/**
 * Closes the app proxy's connection of Integration `id`, or every connection, when the proxy was made at all: what
 * the removal of an Integration and the app's quit call (src/main/ipc/integrations.ts).
 */
export async function closeIntegrationConnections(id?: string): Promise<void> {
  await appProxy?.close(id)
}

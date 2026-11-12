// The mcp part of the Codex driver (ADR-0094 item 2; worfy-multi-vendor ticket 33): worfy's MCP servers
// reach Codex through the streamable-HTTP endpoint of worfy main on 127.0.0.1 (src/main/mcp/http-server.ts),
// not inside the app's process. A Codex Session in a Project gets `worfy-canvas` and `worfy-browser` as
// a Claude Session does (src/main/vendors/claude/query.ts): bound to the Project of its cwd, each only
// when the Profile's list of MCP servers names it (`worfy-browser` also when the list names
// `worfy-canvas`: the rule of withBrowserServer, src/main/vendors/claude/options.ts), and in Autopilot
// mode for an unattended Session. A Session outside every Project, or whose canvas failed, gets none.
//
// Each process of the Session gets a token of its own (codexMcpSessions). Codex reads it from the
// environment variable MCP_TOKEN_ENV of its app-server (`bearer_token_env_var`): the token is in no
// argument, in neither thread/start nor thread/resume, and in no file. The token ends when the handle
// closes and when the process exits (session.ts), whichever comes first. The same environment sends
// Codex's requests to 127.0.0.1 past any proxy the user set (directToLoopback).
//
// The Session's events are watched on the way out of the handle (observe): each turn's `init` names
// the thread the tools act for, and a `fileChange` into a Card's folder makes the Session the Card's
// last editor, so a Card's `session.ask` reaches it (src/main/cards/ask.ts), as it reaches Claude.
//
// worfy-mcp-live ticket 06: the status of every MCP server of a Codex Session, the user's own among
// them, as the rows of src/shared/agent/mcp-status.ts. Codex tells how each server of the thread starts
// (`mcpServer/startupStatus/updated`, which the live 0.166.0 recordings send for every server of a new
// thread); once none is starting any more, the Session asks `mcpServerStatus/list` of its thread for the
// tools and the sign-in state (session.ts). Both come to the same row (codexMcpRow, codexStartupRow).
// Codex shows the user's servers as they are (spec Q8): no row is `not-allowed`, none offers `allow`.
// Reconnect is `config/mcpServer/reload`, Sign in is `mcpServer/oauth/login` with its page opened in the
// system browser, over by `mcpServer/oauthLogin/completed`. The protocol has no way to turn a server
// off for one thread only (`config/value/write` would change the user's config.toml for every
// Session), so a Codex row offers no Turn off.
import { BROWSER_SERVER_NAME } from '../../../shared/browser/tools'
import { CANVAS_SERVER_NAME } from '../../../shared/canvas/tools'
import type { AgentEvent } from '../../../shared/agent/events'
import type { McpServerAction, McpServerRow } from '../../../shared/agent/mcp-status'
import type { BrowserBinding } from '../../mcp/browser-server'
import type { CanvasBinding } from '../../mcp/canvas-server'
import type { McpHttpEndpoint } from '../../mcp/http-server'
import { PartNotWired } from '../driver'
import { McpActionRefused, type McpPart, type McpServer } from '../mcp'
import type { SessionHandle } from '../session'
import type { JsonValue } from './protocol/ts/serde_json/JsonValue'
import type { ListMcpServerStatusParams } from './protocol/ts/v2/ListMcpServerStatusParams'
import type { McpServerOauthLoginParams } from './protocol/ts/v2/McpServerOauthLoginParams'
import type { McpServerStatus } from './protocol/ts/v2/McpServerStatus'
import type { McpServerStatusUpdatedNotification } from './protocol/ts/v2/McpServerStatusUpdatedNotification'

/** What the mcp part reads of the SessionHandle of the Codex driver (CodexSession, session.ts). */
export interface CodexMcpLive {
  /** The rows of `mcpServerStatus/list` of the thread, asked now; null: no data (Codex refused, or it is gone). Never rejects. */
  codexMcpStatus(): Promise<McpServerRow[] | null>
  /** `config/mcpServer/reload`: Codex reconnects the servers of its threads, a new one of its config included. */
  codexMcpReload(): Promise<void>
  /** `mcpServer/oauth/login` of the server `name`, its page opened; settles when Codex says the sign-in is over. */
  codexMcpSignIn(name: string): Promise<void>
}

/** The CodexMcpLive of `session`; null for a handle that is not the Codex driver's. */
function mcpLive(session: SessionHandle): CodexMcpLive | null {
  const live = session as SessionHandle & Partial<CodexMcpLive>
  return typeof live.codexMcpStatus === 'function' && typeof live.codexMcpReload === 'function' && typeof live.codexMcpSignIn === 'function' ? (live as CodexMcpLive) : null
}

const NOT_OURS = 'it takes the SessionHandle of the Codex driver'

export const codexMcp: McpPart = {
  delivery: 'http',
  status(session) {
    const live = mcpLive(session)
    return live === null ? Promise.reject(new PartNotWired('codex', 'mcp.status', NOT_OURS)) : live.codexMcpStatus()
  },
  async act(session, name, action) {
    // Turn off, Turn on, Allow and Restart are not Codex's (see above); Restart comes with the shared path of ticket 03.
    if (action !== 'reconnect' && action !== 'sign-in') throw new McpActionRefused(action)
    const live = mcpLive(session)
    if (live === null) throw new PartNotWired('codex', 'mcp.act', NOT_OURS)
    if (action === 'reconnect') await live.codexMcpReload()
    else await live.codexMcpSignIn(name)
  },
}

/** The params of one page of `mcpServerStatus/list` for the thread `threadId`: its own connections, not new ones. */
export function codexMcpListParams(threadId: string, cursor: string | null): ListMcpServerStatusParams {
  return cursor === null ? { threadId } : { threadId, cursor }
}

/** The params of `mcpServer/oauth/login` of the server `name` of the thread `threadId`. */
export function codexMcpLoginParams(name: string, threadId: string): McpServerOauthLoginParams {
  return { name, threadId }
}

/** The names of worfy's own servers among the `config` keys of a Session (CodexMcpSession.config: `mcp_servers.<name>`). */
export function worfyServerNames(config: Readonly<Record<string, JsonValue>>): string[] {
  const prefix = 'mcp_servers.'
  return Object.keys(config).flatMap((key) => (key.startsWith(prefix) ? [key.slice(prefix.length)] : []))
}

/** What a row of Codex offers: Reconnect to a failed server, Sign in to one that waits for it — when it can sign in (an HTTP server). */
function actionsOf(status: McpServerRow['status'], signIn: boolean): McpServerAction[] {
  if (status === 'failed') return ['reconnect']
  if (status === 'needs-auth') return signIn ? ['sign-in'] : ['reconnect']
  return []
}

/** The source of a server: worfy's own when worfy gave it to the Session, else user config (a plugin's with the word kept). */
function sourceOf(name: string, pluginId: string | null, worfy: readonly string[]): Pick<McpServerRow, 'source' | 'sourceWord'> {
  if (worfy.includes(name)) return { source: 'worfy', sourceWord: null }
  return { source: 'user', sourceWord: pluginId === null ? null : 'plugin' }
}

/** The status of a row by Codex's runtimeStatus; null — «unavailable or the configuration changed» — is still starting. */
function runtimeStatusOf(server: McpServerStatus): McpServerRow['status'] {
  switch (server.runtimeStatus) {
    case 'connected':
      return 'connected'
    case 'authenticationRequired':
      return 'needs-auth'
    case 'failed':
    case 'cancelled':
      return 'failed'
    case 'disabled':
      return 'disabled'
    default:
      return 'pending'
  }
}

/**
 * The row of one server of `mcpServerStatus/list`; `worfy` names worfy's own servers of the Session. A
 * server that is not connected and has no sign-in (`authStatus: notLoggedIn`) needs one. Only the
 * fields a row shows are read: the server's origin, info and capabilities go nowhere.
 */
export function codexMcpRow(server: McpServerStatus, worfy: readonly string[]): McpServerRow {
  const runtime = runtimeStatusOf(server)
  const status = runtime !== 'connected' && runtime !== 'disabled' && server.authStatus === 'notLoggedIn' ? 'needs-auth' : runtime
  return {
    name: server.name,
    status,
    tools: status === 'connected' && server.toolsError === null ? Object.keys(server.tools).length : null,
    error: server.toolsError,
    ...sourceOf(server.name, server.pluginId, worfy),
    // mcpServer/oauth/login signs in to HTTP servers only.
    actions: actionsOf(status, server.httpOrigin !== null),
  }
}

/**
 * The row of a server after `mcpServer/startupStatus/updated`, over its row before (`previous`, if any):
 * `starting` → pending, `ready` → connected, `failed` and `cancelled` → failed, a failure for want of a
 * new sign-in → needs-auth. The tools stay as the last list said while the server is connected.
 */
export function codexStartupRow(previous: McpServerRow | undefined, update: McpServerStatusUpdatedNotification, worfy: readonly string[]): McpServerRow {
  const status: McpServerRow['status'] =
    update.status === 'ready' ? 'connected' : update.status === 'starting' ? 'pending' : update.failureReason === 'reauthenticationRequired' ? 'needs-auth' : 'failed'
  return {
    name: update.name,
    status,
    tools: status === 'connected' ? (previous?.tools ?? null) : null,
    error: status === 'connected' || status === 'pending' ? null : update.error,
    ...(previous === undefined ? sourceOf(update.name, null, worfy) : { source: previous.source, sourceWord: previous.sourceWord }),
    // A server that wants a new sign-in signed in before: an OAuth one.
    actions: actionsOf(status, true),
  }
}

/** The environment variable of the app-server that carries the Session's token (`bearer_token_env_var`). */
export const MCP_TOKEN_ENV = 'WORFY_MCP_TOKEN'

/** What one process of a Codex Session gets of worfy's MCP servers. */
export interface CodexMcpSession {
  /** Keys of `config` for thread/start and thread/resume: `mcp_servers.<name>` with its URL and MCP_TOKEN_ENV. */
  config: Record<string, JsonValue>
  /** The instructions of the servers given (the Cards folder, the Browser), for `developerInstructions`. */
  developerInstructions: string
  /** The app-server's environment over `base`: the token under MCP_TOKEN_ENV, and the endpoint reached past any proxy (directToLoopback). */
  env(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv
  /** The handle with the Session's events watched; its close() also ends the token. */
  observe(handle: SessionHandle): SessionHandle
  /** Ends the token. Calling it again does nothing. */
  close(): void
}

/** What a Session starts with, as far as its servers go. Never rejects: a failure gives no servers. */
export type CodexMcpResolver = (request: { cwd: string; resume: string | undefined; unattended: boolean }) => Promise<CodexMcpSession | null>

export interface CodexMcpDeps {
  canvas(request: { cwd: string; resume: string | undefined }): Promise<CanvasBinding | null>
  browser(request: { cwd: string; resume: string | undefined; autopilot: boolean }): Promise<BrowserBinding | null>
  /** The MCP servers the Profile of the Project at `cwd` lists (readMcpAllowlist); never rejects. */
  allowlist(cwd: string): Promise<readonly string[]>
  endpoint(): Promise<McpHttpEndpoint>
}

/** The hosts the endpoint's URLs may name; the URLs name MCP_HTTP_HOST (src/main/mcp/http-server.ts). */
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost']

/**
 * `env` with LOOPBACK_HOSTS added to its NO_PROXY and no_proxy, the user's own entries kept: with
 * HTTP_PROXY or ALL_PROXY set, Codex would otherwise send its requests to the endpoint — the token in
 * clear text — through the proxy, which cannot reach 127.0.0.1 of this Machine anyway. A variable the
 * user set under one spelling only gives its value to the other; every other spelling of it (Windows
 * reads the name in any case) gets the hosts too.
 */
export function directToLoopback(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const spellings = Object.keys(env).filter((key) => key.toLowerCase() === 'no_proxy' && env[key] !== undefined)
  const anySpelling = spellings.length === 0 ? undefined : env[spellings[0]!]
  const out: NodeJS.ProcessEnv = { ...env }
  for (const key of new Set(['NO_PROXY', 'no_proxy', ...spellings])) {
    const own = (env[key] ?? anySpelling ?? '').trim()
    const listed = own.split(',').map((entry) => entry.trim().toLowerCase())
    const missing = LOOPBACK_HOSTS.filter((host) => !listed.includes(host))
    out[key] = missing.length === 0 ? own : own === '' ? missing.join(',') : `${own},${missing.join(',')}`
  }
  return out
}

/** The paths a `fileChange` tool_use of the Codex driver (items.ts, toolUse) writes. */
function writtenPaths(event: Extract<AgentEvent, { type: 'tool_use' }>): string[] {
  if (event.name !== 'fileChange') return []
  const changes = (event.input as { changes?: unknown } | null)?.changes
  return Array.isArray(changes) ? changes.flatMap((change: unknown) => (typeof (change as { path?: unknown } | null)?.path === 'string' ? [(change as { path: string }).path] : [])) : []
}

/** `handle`, with `onEvent` called for every event it gives and `onClose` before its close(). */
function watched(handle: SessionHandle, onEvent: (event: AgentEvent) => void, onClose: () => void): SessionHandle {
  const source = handle.events
  const events: AsyncIterable<AgentEvent> = {
    [Symbol.asyncIterator]: () => {
      const inner = source[Symbol.asyncIterator]()
      return {
        next: async () => {
          const result = await inner.next()
          if (!result.done) {
            try {
              onEvent(result.value)
            } catch (error) {
              console.warn('[codex] an event observer of the MCP servers threw', error)
            }
          }
          return result
        },
        ...(inner.return ? { return: (value?: unknown) => inner.return!(value) } : {}),
        ...(inner.throw ? { throw: (error?: unknown) => inner.throw!(error) } : {}),
      }
    },
  }
  // A Proxy rather than a copy: whatever the handle gains later reaches the Session unchanged.
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'events') return events
      if (property === 'close') {
        return () => {
          onClose()
          target.close()
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  })
}

async function orNull<T>(what: string, cwd: string, make: () => Promise<T | null>): Promise<T | null> {
  try {
    return await make()
  } catch (error) {
    console.warn(`[codex] no ${what} for ${cwd}`, error)
    return null
  }
}

/** The servers of each Codex Session over `deps`; the app's are appCodexMcp. */
export function codexMcpSessions(deps: CodexMcpDeps): CodexMcpResolver {
  return async (request) => {
    const canvas = await orNull('canvas tools', request.cwd, () => deps.canvas({ cwd: request.cwd, resume: request.resume }))
    if (canvas === null) return null
    const [browser, listed] = await Promise.all([
      orNull('Browser tools', request.cwd, () => deps.browser({ cwd: request.cwd, resume: request.resume, autopilot: request.unattended })),
      deps.allowlist(request.cwd).catch(() => [] as readonly string[]),
    ])
    const given: { server: McpServer; instructions: string }[] = []
    if (listed.includes(CANVAS_SERVER_NAME)) given.push(canvas)
    if (browser !== null && (listed.includes(BROWSER_SERVER_NAME) || listed.includes(CANVAS_SERVER_NAME))) given.push(browser)
    if (given.length === 0) return null
    const endpoint = await orNull('MCP endpoint', request.cwd, () => deps.endpoint())
    if (endpoint === null) return null
    const grant = endpoint.grant(given.map((each) => each.server))
    const config: Record<string, JsonValue> = {}
    // One key per server, not the whole `mcp_servers` table: the user's own servers stay as they are.
    for (const { server } of given) config[`mcp_servers.${server.name}`] = { url: grant.urls[server.name]!, bearer_token_env_var: MCP_TOKEN_ENV }
    const sessionId = (id: string): void => {
      canvas.setSessionId(id)
      browser?.setSessionId(id)
    }
    return {
      config,
      developerInstructions: given.map((each) => each.instructions).join('\n\n'),
      env: (base) => ({ ...directToLoopback(base), [MCP_TOKEN_ENV]: grant.token }),
      observe: (handle) =>
        watched(
          handle,
          (event) => {
            if (event.type === 'init') sessionId(event.sdkSessionId)
            else if (event.type === 'tool_use') {
              const paths = writtenPaths(event)
              if (paths.length > 0) canvas.wrote(paths)
            }
          },
          grant.revoke,
        ),
      close: grant.revoke,
    }
  }
}

/** The app's: the Project's canvas and Browser, the Profile's list, and the app's endpoint (loaded on first use). */
export const appCodexMcp: CodexMcpResolver = (request) =>
  orNull('MCP servers', request.cwd, async () => {
    const [{ canvasBindingForSession }, { browserBindingForSession }, { appMcpHttpEndpoint }] = await Promise.all([
      import('../../mcp/canvas-server'),
      import('../../mcp/browser-server'),
      import('../../mcp/http-server'),
    ])
    return codexMcpSessions({
      canvas: (each) => canvasBindingForSession(each),
      browser: (each) => browserBindingForSession(each),
      allowlist: async (cwd) => {
        const [{ agentEnv }, { readMcpAllowlist }, { claudeHome }] = await Promise.all([import('../../agent/env'), import('../../workflow/profile'), import('../../storage/paths')])
        // bin/profile runs with the login shell environment, as for a Claude Session: from Finder worfy's own PATH has no node.
        return (await readMcpAllowlist({ root: cwd, claudeHome: claudeHome(), env: (await agentEnv()).env })).servers
      },
      endpoint: appMcpHttpEndpoint,
    })(request)
  })

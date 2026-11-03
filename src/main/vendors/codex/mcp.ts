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
// closes and when the process exits (session.ts), whichever comes first.
//
// The Session's events are watched on the way out of the handle (observe): each turn's `init` names
// the thread the tools act for, and a `fileChange` into a Card's folder makes the Session the Card's
// last editor, so a Card's `session.ask` reaches it (src/main/cards/ask.ts), as it reaches Claude.
import { BROWSER_SERVER_NAME } from '../../../shared/browser/tools'
import { CANVAS_SERVER_NAME } from '../../../shared/canvas/tools'
import type { AgentEvent } from '../../../shared/agent/events'
import type { BrowserBinding } from '../../mcp/browser-server'
import type { CanvasBinding } from '../../mcp/canvas-server'
import type { McpHttpEndpoint } from '../../mcp/http-server'
import type { McpPart, McpServer } from '../mcp'
import type { SessionHandle } from '../session'
import type { JsonValue } from './protocol/ts/serde_json/JsonValue'

export const codexMcp: McpPart = { delivery: 'http' }

/** The environment variable of the app-server that carries the Session's token (`bearer_token_env_var`). */
export const MCP_TOKEN_ENV = 'WORFY_MCP_TOKEN'

/** What one process of a Codex Session gets of worfy's MCP servers. */
export interface CodexMcpSession {
  /** Keys of `config` for thread/start and thread/resume: `mcp_servers.<name>` with its URL and MCP_TOKEN_ENV. */
  config: Record<string, JsonValue>
  /** The instructions of the servers given (the Cards folder, the Browser), for `developerInstructions`. */
  developerInstructions: string
  /** What the app-server's environment gets on top of its own: the token, under MCP_TOKEN_ENV. */
  env: Record<string, string>
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
      env: { [MCP_TOKEN_ENV]: grant.token },
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

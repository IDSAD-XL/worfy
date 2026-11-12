// The mcp part of the Claude driver: worfy-canvas and worfy-browser are Agent SDK servers in the
// app's process. claudeMcpServer builds one from worfy's description of a server
// (src/main/vendors/mcp.ts, given by src/main/mcp/canvas-server.ts and browser-server.ts); the
// options of each Session hand it to Claude Code (options.ts).
//
// worfy-mcp-live ticket 02: the status of every MCP server of a Session is mcpServerStatus() of its
// live query (claudeMcpStatus; the Session's handle asks it after each system/init and `result`,
// session.ts), and Reconnect is reconnectMcpServer(). Turn off and Turn on are not done here: Claude
// Code's toggleMcpServer writes the user's .claude.json, so nothing in worfy calls it.
//
// Ticket 03: a server the Project's list allows, added to the user's config while the query runs, is
// taken in by reloadPlugins() (the spike of ticket 01, F:allowed-reload-plugins), called before the
// status is read when a person asks for it — the chip's popover opens (agent.mcp with `pickUp`) — and
// no turn runs: never after each turn by itself, never on a window's plain read, and never in a
// running turn, whose tools stay as they are. Its prompt-cache cost comes only
// when the set of servers changed, which is what the person added the server for: no confirmation is
// asked (holdOnCacheImpact is not used). Turn off, Turn on and Restart are a Restart of the Session
// with the same conversation (Session.mcpAction; `restarts`), which starts Claude Code without the
// servers turned off (options.ts, mcpOff); a connected server offers Turn off. An unattended Session
// (Autopilot) takes in nothing in the middle of a Wave and offers neither: its set of servers is fixed
// when it starts.
//
// Ticket 05: a server the Profile's list keeps out is a row `not-allowed` with Allow, from the MCP inventory
// (mcp-inventory.ts; the handle adds those rows, session.ts). Allow itself is the Session's: it writes the
// list, then restarts the Session with the same conversation (Session.mcpAction). Sign in, for a server in
// needs-auth, is Claude Code's mcpAuthenticate() — in the SDK's code, not in its documented types (the spike
// of ticket 01): its sign-in page opens in the system browser, Claude Code itself listens for the callback on
// localhost and takes the token, and the action ends once the server is out of needs-auth (connected, or
// reconnected when it failed). worfy never sees a token; the page's address is neither logged nor sent
// anywhere but to the browser. A claude.ai connector signs in on claude.ai, with no callback
// (callbackExpected false): the action ends once the page is open, and the person presses Reconnect after.
// A Claude Code without mcpAuthenticate offers no Sign in: the row says where to sign in, and Reconnect.
import type { McpSdkServerConfigWithInstance, McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import type { QueryHandle } from '../../agent/session/types'
import type { McpServerRow } from '../../../shared/agent/mcp-status'
import { z } from 'zod'
import { mcpServerRowsOf } from '../../../shared/vendors/claude/events'
import { PartNotWired } from '../driver'
import { McpActionRefused, type McpPart, type McpServer } from '../mcp'
import type { SessionHandle } from '../session'

/** How a read of the status goes (claudeMcpStatus). */
export interface McpRead {
  /** A person may act on the Session: a connected server offers Turn off. False: an unattended Session's rows. */
  attended: boolean
  /** Take in a server added to the user's config first (reloadPlugins); only between turns of an attended Session. */
  pickUp: boolean
}

/**
 * The rows of the MCP servers of `query`: its mcpServerStatus(), or — for a query that lacks it — the
 * servers of its last system/init (`initServers`). null: no data (the answer failed or was no list).
 * With `read.pickUp`, reloadPlugins() first; when it fails the status is read all the same. Never
 * rejects; a failure is logged without the answer, which may name the user's servers.
 */
export async function claudeMcpStatus(query: QueryHandle, initServers: readonly McpServerRow[] | null, label: string, read: McpRead): Promise<McpServerRow[] | null> {
  if (read.pickUp && query.reloadPlugins !== undefined) {
    try {
      await query.reloadPlugins()
    } catch (error) {
      console.warn(`[agent] could not take in new MCP servers of ${label}: ${error instanceof Error ? error.name : 'an error'}`)
    }
  }
  let rows: McpServerRow[] | null
  if (query.mcpServerStatus === undefined) rows = initServers === null ? null : initServers.map((row) => ({ ...row }))
  else {
    try {
      rows = mcpServerRowsOf(await query.mcpServerStatus())
    } catch (error) {
      console.warn(`[agent] could not read the MCP servers of ${label}: ${error instanceof Error ? error.name : 'an error'}`)
      return null
    }
  }
  if (rows === null) return null
  const signs = typeof (query as Partial<ClaudeSignIn>).mcpAuthenticate === 'function'
  return rows.map((row) => withSignIn(read.attended ? withTurnOff(row) : row, signs))
}

/** Where to sign in to a server in needs-auth when Claude Code cannot start the sign-in itself. */
export const SIGN_IN_ELSEWHERE = 'Sign in with /mcp in Claude Code in a terminal (a claude.ai connector: in its settings on claude.ai), then press Reconnect.'

/**
 * A server in needs-auth offers Sign in, when Claude Code can start one, and Reconnect for after a sign-in
 * that ended elsewhere (a claude.ai connector); without Sign in its row says where to sign in.
 */
function withSignIn(row: McpServerRow, signs: boolean): McpServerRow {
  if (row.status !== 'needs-auth') return row
  return signs ? { ...row, actions: ['sign-in', 'reconnect'] } : { ...row, error: row.error ?? SIGN_IN_ELSEWHERE, actions: ['reconnect'] }
}

/** Claude Code's sign-in to an MCP server: in the SDK's code (sdk.mjs), not in its types (sdk.d.ts). */
interface ClaudeSignIn {
  mcpAuthenticate(serverName: string): Promise<unknown>
}

/** What worfy reads of mcpAuthenticate()'s answer (F:oauth-authenticate); the rest — state, port — stays with Claude Code. */
const signInAnswer = z.object({ authUrl: z.string().min(1).nullish(), callbackExpected: z.boolean().nullish() })

/** How long Sign in waits for the sign-in in the browser to land, as Codex's does (codex/session.ts). */
export const SIGN_IN_WAIT_MS = 10 * 60 * 1000
/** How often it asks Claude Code meanwhile. */
export const SIGN_IN_POLL_MS = 500

/** Opens a sign-in page in the system browser. */
const openWithShell = async (url: string): Promise<void> => {
  const { shell } = await import('electron')
  await shell.openExternal(url)
}

/**
 * `url` as the URL parser reads it (`href`), when it is a web page (http or https): a sign-in page of another
 * scheme is refused before anything opens it, and the browser gets the address that was checked, not the raw
 * string (a tab, a line break or backslashes in it are what the parser makes of them).
 */
function webPage(url: string): string {
  let parsed: URL | null = null
  try {
    parsed = new URL(url)
  } catch {
    // Not a URL at all.
  }
  if (parsed === null || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) throw new Error('Claude Code gave a sign-in page that is not a web page')
  return parsed.href
}

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/**
 * Signs in to the server `name` of `query`: its page opened in the browser, then — when Claude Code waits for
 * the callback — until the server is out of needs-auth, SIGN_IN_WAIT_MS at most; a server that failed after
 * the sign-in is reconnected. Never logs the page's address.
 */
async function signIn(query: QueryHandle, name: string, open: (url: string) => Promise<void>): Promise<void> {
  const authenticate = (query as Partial<ClaudeSignIn>).mcpAuthenticate
  if (typeof authenticate !== 'function') throw new McpActionRefused('sign-in')
  const answer = signInAnswer.safeParse(await authenticate.call(query, name))
  if (!answer.success) throw new Error('Claude Code answered the sign-in with something worfy does not read')
  const page = answer.data.authUrl
  // No page: nothing to sign in to now — the server signed in meanwhile.
  if (page === null || page === undefined) return
  await open(webPage(page))
  if (answer.data.callbackExpected !== true) return
  const status = query.mcpServerStatus
  if (status === undefined) return
  const until = Date.now() + SIGN_IN_WAIT_MS
  while (Date.now() < until) {
    await pause(SIGN_IN_POLL_MS)
    const row = mcpServerRowsOf(await status.call(query))?.find((each) => each.name === name)
    if (row === undefined || row.status === 'connected') return
    if (row.status === 'needs-auth' || row.status === 'pending') continue
    if (query.reconnectMcpServer !== undefined) await query.reconnectMcpServer(name)
    return
  }
  throw new Error(`The sign-in was not completed within ${Math.round(SIGN_IN_WAIT_MS / 60_000)} minutes: sign in, then press Reconnect`)
}

/** A connected server of an attended Session offers Turn off for this Session (a Restart without it). */
const withTurnOff = (row: McpServerRow): McpServerRow => (row.status === 'connected' && !row.actions.includes('turn-off') ? { ...row, actions: [...row.actions, 'turn-off'] } : row)

/** What the mcp part reads of the SessionHandle of the Claude driver (ClaudeSession, session.ts). */
export interface ClaudeMcpLive {
  /** The live query; null before it started and once Claude Code is gone. */
  readonly query: QueryHandle | null
  /**
   * The rows of the query's servers, asked now — with `pickUp`, taking in a new server first between
   * turns of an attended Session. It counts as the handle's latest ask: an `mcp` event asked before it
   * is not sent. null: no data, or Claude Code is gone.
   */
  readMcp(pickUp: boolean): Promise<McpServerRow[] | null>
}

/** What the Claude driver holds of `session` for the mcp part; null for a handle that is not its own. */
function mcpLive(session: SessionHandle): ClaudeMcpLive | null {
  const live = session as SessionHandle & Partial<ClaudeMcpLive>
  return live.query !== undefined && typeof live.readMcp === 'function' ? (live as ClaudeMcpLive) : null
}

const NOT_OURS = 'it takes the SessionHandle of the Claude driver'

export const claudeMcp: McpPart = {
  delivery: 'inProcess',
  // Turn off, Turn on and Restart: the Session restarts Claude Code without the servers turned off (options.ts).
  restarts: true,
  status(session, read) {
    const live = mcpLive(session)
    if (live === null) return Promise.reject(new PartNotWired('claude', 'mcp.status', NOT_OURS))
    return live.readMcp(read?.pickUp === true)
  },
  async act(session, name, action) {
    // Reconnect and Sign in: Turn off and Turn on would need toggleMcpServer (see above) and, with Allow, are the Session's own.
    if (action !== 'reconnect' && action !== 'sign-in') throw new McpActionRefused(action)
    const live = mcpLive(session)
    if (live === null) throw new PartNotWired('claude', 'mcp.act', NOT_OURS)
    const query = live.query
    if (query === null) throw new Error('Claude Code is not running')
    if (action === 'sign-in') return signIn(query, name, openWithShell)
    if (query.reconnectMcpServer === undefined) throw new McpActionRefused(action)
    await query.reconnectMcpServer(name)
  },
}

/**
 * A worfy MCP server as Claude Code gets it: the SDK server in the app's process that
 * claudeMcpServer made. Outside the driver it is only handed back, with a Session's options.
 */
export interface ClaudeMcpServer {
  readonly type: 'sdk'
  readonly name: string
  /** The MCP server itself: the SDK connects Claude Code to it, a test may connect to it too. */
  readonly instance: { connect(transport: never): Promise<void> }
}

/** The SDK server of `server`. The SDK is loaded on first use, as a Session loads it. */
export async function claudeMcpServer(server: McpServer): Promise<ClaudeMcpServer> {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk')
  return createSdkMcpServer({
    name: server.name,
    version: server.version,
    tools: server.tools.map((each) => tool(each.name, each.description, each.shape, (args) => each.call(args))),
  })
}

/** The SDK's config of a server claudeMcpServer made, for the `mcpServers` of a Session's options. */
export const sdkServerConfig = (server: ClaudeMcpServer): McpServerConfig => server as McpSdkServerConfigWithInstance

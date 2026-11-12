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
// status is read when a window asks for it (status()) and no turn runs — never after each turn by
// itself, and never in a running turn, whose tools stay as they are. Its prompt-cache cost comes only
// when the set of servers changed, which is what the person added the server for: no confirmation is
// asked (holdOnCacheImpact is not used). Turn off, Turn on and Restart are a Restart of the Session
// with the same conversation (Session.mcpAction; `restarts`), which starts Claude Code without the
// servers turned off (options.ts, mcpOff); a connected server offers Turn off. An unattended Session
// (Autopilot) takes in nothing in the middle of a Wave and offers neither: its set of servers is fixed
// when it starts.
import type { McpSdkServerConfigWithInstance, McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import type { QueryHandle } from '../../agent/session/types'
import type { McpServerRow } from '../../../shared/agent/mcp-status'
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
  return rows === null || !read.attended ? rows : rows.map(withTurnOff)
}

/** A connected server of an attended Session offers Turn off for this Session (a Restart without it). */
const withTurnOff = (row: McpServerRow): McpServerRow => (row.status === 'connected' && !row.actions.includes('turn-off') ? { ...row, actions: [...row.actions, 'turn-off'] } : row)

/** What the mcp part reads of the SessionHandle of the Claude driver (ClaudeSession, session.ts). */
export interface ClaudeMcpLive {
  /** The live query; null before it started and once Claude Code is gone. */
  readonly query: QueryHandle | null
  /**
   * The rows of the query's servers, asked now — taking in a new server first between turns of an
   * attended Session. It counts as the handle's latest ask: an `mcp` event asked before it is not sent.
   * null: no data, or Claude Code is gone.
   */
  readMcp(): Promise<McpServerRow[] | null>
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
  status(session) {
    const live = mcpLive(session)
    if (live === null) return Promise.reject(new PartNotWired('claude', 'mcp.status', NOT_OURS))
    return live.readMcp()
  },
  async act(session, name, action) {
    // Only Reconnect: Turn off and Turn on would need toggleMcpServer (see above) and are the Session's Restart; Allow and Sign in come with ticket 05.
    if (action !== 'reconnect') throw new McpActionRefused(action)
    const live = mcpLive(session)
    if (live === null) throw new PartNotWired('claude', 'mcp.act', NOT_OURS)
    const query = live.query
    if (query === null) throw new Error('Claude Code is not running')
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

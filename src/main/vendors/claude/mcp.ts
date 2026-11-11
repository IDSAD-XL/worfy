// The mcp part of the Claude driver: worfy-canvas and worfy-browser are Agent SDK servers in the
// app's process. claudeMcpServer builds one from worfy's description of a server
// (src/main/vendors/mcp.ts, given by src/main/mcp/canvas-server.ts and browser-server.ts); the
// options of each Session hand it to Claude Code (options.ts).
//
// worfy-mcp-live ticket 02: the status of every MCP server of a Session is mcpServerStatus() of its
// live query (claudeMcpStatus; the Session's handle asks it after each system/init and `result`,
// session.ts), and Reconnect is reconnectMcpServer(). Turn off and Turn on are refused here: Claude
// Code's toggleMcpServer writes the user's .claude.json, so they come as a Restart of the Session
// (ticket 03), and nothing in worfy calls it.
import type { McpSdkServerConfigWithInstance, McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import type { QueryHandle } from '../../agent/session/types'
import type { McpServerRow } from '../../../shared/agent/mcp-status'
import { mcpServerRowsOf } from '../../../shared/vendors/claude/events'
import { PartNotWired } from '../driver'
import { McpActionRefused, type McpPart, type McpServer } from '../mcp'
import type { SessionHandle } from '../session'

/**
 * The rows of the MCP servers of `query`: its mcpServerStatus(), or — for a query that lacks it — the
 * servers of its last system/init (`initServers`). null: no data (the answer failed or was no list).
 * Never rejects; a failure is logged without the answer, which may name the user's servers.
 */
export async function claudeMcpStatus(query: QueryHandle, initServers: readonly McpServerRow[] | null, label: string): Promise<McpServerRow[] | null> {
  if (query.mcpServerStatus === undefined) return initServers === null ? null : [...initServers]
  try {
    return mcpServerRowsOf(await query.mcpServerStatus())
  } catch (error) {
    console.warn(`[agent] could not read the MCP servers of ${label}: ${error instanceof Error ? error.name : 'an error'}`)
    return null
  }
}

/** What the mcp part reads of the SessionHandle of the Claude driver (ClaudeSession, session.ts). */
export interface ClaudeMcpLive {
  /** The live query; null before it started and once Claude Code is gone. */
  readonly query: QueryHandle | null
  /** The servers its last system/init named; null before the first. */
  readonly initMcpServers: readonly McpServerRow[] | null
}

/** What the Claude driver holds of `session` for the mcp part; null for a handle that is not its own. */
function mcpLive(session: SessionHandle): ClaudeMcpLive | null {
  const live = session as SessionHandle & Partial<ClaudeMcpLive>
  return live.query !== undefined && live.initMcpServers !== undefined ? { query: live.query, initMcpServers: live.initMcpServers } : null
}

const NOT_OURS = 'it takes the SessionHandle of the Claude driver'

export const claudeMcp: McpPart = {
  delivery: 'inProcess',
  status(session) {
    const live = mcpLive(session)
    if (live === null) return Promise.reject(new PartNotWired('claude', 'mcp.status', NOT_OURS))
    return live.query === null ? Promise.resolve(null) : claudeMcpStatus(live.query, live.initMcpServers, 'a Claude Session')
  },
  async act(session, name, action) {
    // Only Reconnect: Turn off and Turn on would need toggleMcpServer (see above), the rest come with tickets 03 and 05.
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

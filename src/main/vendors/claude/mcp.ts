// The mcp part of the Claude driver: worfy-canvas and worfy-browser are Agent SDK servers in the
// app's process. claudeMcpServer builds one from worfy's description of a server
// (src/main/vendors/mcp.ts, given by src/main/mcp/canvas-server.ts and browser-server.ts); the
// options of each Session hand it to Claude Code (options.ts).
import type { McpSdkServerConfigWithInstance, McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import type { McpPart, McpServer } from '../mcp'

export const claudeMcp: McpPart = { delivery: 'inProcess' }

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

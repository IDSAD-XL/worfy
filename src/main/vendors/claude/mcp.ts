// The mcp part of the Claude driver: worfy-canvas and worfy-browser are Agent SDK servers in the
// app's process (createSdkMcpServer in src/main/mcp/canvas-server.ts and browser-server.ts), handed
// to Claude Code with the options of each Session (src/main/agent/options.ts).
import type { McpPart } from '../mcp'

export const claudeMcp: McpPart = { delivery: 'inProcess' }

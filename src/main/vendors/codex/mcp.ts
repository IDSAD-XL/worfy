// The mcp part of the Codex driver (ADR-0094 item 2): worfy's MCP servers reach Codex through an HTTP
// endpoint of worfy main, not inside the app's process. worfy-multi-vendor ticket 33 serves them and
// changes this file only.
import type { McpPart } from '../mcp'

export const codexMcp: McpPart = { delivery: 'http' }

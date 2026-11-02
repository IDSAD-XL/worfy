// The mcp part of a Vendor driver (ADR-0094 item 2): how worfy's MCP servers (worfy-canvas,
// worfy-browser) reach the Vendor's agent.

export interface McpPart {
  /**
   * In the app's process (`inProcess`: Claude Code's SDK server), or through an HTTP endpoint of
   * worfy main on 127.0.0.1 (`http`: Codex).
   */
  readonly delivery: 'inProcess' | 'http'
}

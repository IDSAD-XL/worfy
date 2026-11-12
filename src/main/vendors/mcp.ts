// The mcp part of a Vendor driver (ADR-0094 item 2): how worfy's MCP servers (worfy-canvas,
// worfy-browser) reach the Vendor's agent. A server is described here in worfy's own terms
// (McpServer: its name and tools, each with a zod shape and a call); src/main/mcp/canvas-server.ts
// and browser-server.ts give such a description, and each driver serves it its own way.
//
// worfy-mcp-live ticket 02: the part also reads the status of every MCP server of a live Session, the
// user's own among them, as the rows of src/shared/agent/mcp-status.ts, and does what a row offers.
// Ticket 03: Turn off, Turn on and Restart are a Restart of the Session with the same conversation,
// done by the Session for a driver that `restarts`.
import type { z } from 'zod'
import type { McpServerAction, McpServerRow } from '../../shared/agent/mcp-status'
import type { SessionHandle } from './session'

export interface McpPart {
  /**
   * In the app's process (`inProcess`: Claude Code's SDK server), or through an HTTP endpoint of
   * worfy main on 127.0.0.1 (`http`: Codex).
   */
  readonly delivery: 'inProcess' | 'http'
  /**
   * The rows of the MCP servers of the live Session `session`, a handle of this driver's; null: no
   * data — the Vendor's answer failed, or its process is gone. A failed answer does not reject.
   * Absent: the driver reads no status yet (Codex until worfy-mcp-live ticket 06). `read.pickUp`
   * (ticket 03): a person asked to take in servers added to the Vendor's config first, where the driver
   * can and no turn runs; ignored otherwise.
   */
  status?(session: SessionHandle, read?: { pickUp?: boolean }): Promise<McpServerRow[] | null>
  /**
   * Does `action` on the server `name` of the live Session `session`. Rejects with McpActionRefused
   * for an action the driver does not do, before anything reaches the Vendor; with the Vendor's own
   * error when it refused the action.
   */
  act?(session: SessionHandle, name: string, action: McpServerAction): Promise<void>
  /**
   * The driver starts its agent without the servers SessionStart.mcpOff names (worfy-mcp-live ticket
   * 03): `turn-off`, `turn-on` and `restart` are then done by the Session itself, as a Restart with the
   * same conversation (Session.mcpAction), never by act(). Absent: the Session refuses them.
   */
  readonly restarts?: boolean
}

/** An MCP action the driver does not do: refused before anything reaches the Vendor. Its message names no server. */
export class McpActionRefused extends Error {
  constructor(action: McpServerAction) {
    super(`The MCP action ${action} is not available for this Session`)
    this.name = 'McpActionRefused'
  }
}

/** One block of a tool's answer: text, or an image (a Browser screenshot). */
export type McpToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

/** What a tool call answers; `isError` marks a refusal the agent reads. */
export interface McpToolResult {
  [key: string]: unknown
  content: McpToolContent[]
  isError?: boolean
}

/** One tool of a worfy MCP server. */
export interface McpTool {
  readonly name: string
  readonly description: string
  /** The arguments as a zod object shape: the agent sees it as the tool's input schema. */
  readonly shape: z.ZodRawShape
  /** Answers one call; never throws (a refusal is a result with `isError`). */
  call(args: unknown): Promise<McpToolResult>
}

/** A worfy MCP server: what a driver needs to serve it to its agent. */
export interface McpServer {
  readonly name: string
  readonly version: string
  readonly tools: readonly McpTool[]
}

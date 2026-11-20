// The mcp part of a Vendor driver (ADR-0094 item 2): how worfy's MCP servers (worfy-canvas,
// worfy-browser) reach the Vendor's agent. A server is described here in worfy's own terms
// (McpServer: its name and tools, each with a zod shape and a call); src/main/mcp/canvas-server.ts
// and browser-server.ts give such a description, and each driver serves it its own way.
//
// worfy-mcp-live ticket 02: the part also reads the status of every MCP server of a live Session, the
// user's own among them, as the rows of src/shared/agent/mcp-status.ts, and does what a row offers.
// Ticket 03: Turn off, Turn on and Restart are a Restart of the Session with the same conversation,
// done by the Session for a driver that `restarts`.
import { z } from 'zod'
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

/**
 * One block of a tool's answer: text, an image (a Browser screenshot), or — passed on from an Integration's service
 * (worfy-integrations ticket 06) — audio, a link to a resource or a resource itself, as MCP defines them.
 */
export type McpToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string }
  | { [key: string]: unknown; type: 'resource_link'; uri: string; name: string }
  | { [key: string]: unknown; type: 'resource'; resource: { [key: string]: unknown; uri: string } }

/** What a tool call answers; `isError` marks a refusal the agent reads. */
export interface McpToolResult {
  [key: string]: unknown
  content: McpToolContent[]
  isError?: boolean
}

/** A JSON Schema of a tool's arguments, as an MCP server lists it: an object schema. */
export interface McpJsonSchema {
  [key: string]: unknown
  type: 'object'
}

/** What else a call gets: the agent's cancel of it. */
export interface McpCallExtra {
  signal?: AbortSignal
}

interface McpToolCommon {
  readonly name: string
  readonly description: string
  /** MCP's hints about the tool (`readOnlyHint`…), passed on as they are; absent for worfy's own tools. */
  readonly annotations?: Readonly<Record<string, unknown>>
  /** Answers one call; never throws (a refusal is a result with `isError`). */
  call(args: unknown, extra?: McpCallExtra): Promise<McpToolResult>
}

/**
 * One tool of a worfy MCP server. Its arguments are a zod object shape (worfy's own tools), or the JSON Schema a
 * service gave (`inputSchema`: an Integration's tools through the proxy, worfy-integrations ticket 06); the agent sees
 * either as the tool's input schema.
 */
export type McpTool = McpToolCommon & ({ readonly shape: z.ZodRawShape; readonly inputSchema?: undefined } | { readonly inputSchema: McpJsonSchema; readonly shape?: undefined })

/** The input schema the agent sees for `tool`: the service's own, or its zod shape as JSON Schema. */
export function mcpInputSchema(tool: McpTool): Record<string, unknown> {
  if (tool.inputSchema !== undefined) return tool.inputSchema
  return z.toJSONSchema(z.object(tool.shape), { io: 'input', unrepresentable: 'any' })
}

/** A worfy MCP server: what a driver needs to serve it to its agent. */
export interface McpServer {
  readonly name: string
  readonly version: string
  /** Its tools; ignored when it has listTools. */
  readonly tools: readonly McpTool[]
  /**
   * The tools asked when the agent lists them, for a server whose tools come from elsewhere (an Integration's proxy,
   * worfy-integrations ticket 06): a rejection fails the agent's tools/list with its message. A call goes to the
   * tool of that name in the list it answers.
   */
  readonly listTools?: () => Promise<readonly McpTool[]>
}

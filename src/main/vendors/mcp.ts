// The mcp part of a Vendor driver (ADR-0094 item 2): how worfy's MCP servers (worfy-canvas,
// worfy-browser) reach the Vendor's agent. A server is described here in worfy's own terms
// (McpServer: its name and tools, each with a zod shape and a call); src/main/mcp/canvas-server.ts
// and browser-server.ts give such a description, and each driver serves it its own way.
import type { z } from 'zod'

export interface McpPart {
  /**
   * In the app's process (`inProcess`: Claude Code's SDK server), or through an HTTP endpoint of
   * worfy main on 127.0.0.1 (`http`: Codex).
   */
  readonly delivery: 'inProcess' | 'http'
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

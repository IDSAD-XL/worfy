// Options of the SDK query() behind one Session.
//
// The Session runs with the user's own settings (ADR-0002): settingSources user + project + local,
// the claude_code system prompt preset, and bypassPermissions. A Session in a Project also gets
// the canvas (ticket 24, src/main/mcp/canvas-server.ts): the in-process MCP server `worfy-canvas`,
// the Project's Cards folder as an extra writable directory, and the agent instructions appended
// to the preset. Claude Code runs as the native binary of the SDK's platform package
// (ADR-0008): in `pnpm dev` the SDK finds it itself; in the packaged app its own lookup points
// inside app.asar, where nothing can be spawned, so the path into app.asar.unpacked is explicit.
import { join } from 'node:path'
import type { McpServerConfig, Options } from '@anthropic-ai/claude-agent-sdk'
import { CANVAS_SERVER_NAME } from '../../shared/canvas/tools'
import type { Env } from './env'

export interface RuntimeInfo {
  /** app.isPackaged */
  packaged: boolean
  /** process.resourcesPath: Contents/Resources of the .app */
  resourcesPath: string
  platform: NodeJS.Platform
  arch: string
}

/**
 * The Claude Code binary to run, or undefined to let the SDK find it (`pnpm dev`). In the
 * packaged app: <Resources>/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude.
 * electron-builder.yml unpacks that package (asarUnpack).
 */
export function claudeExecutablePath(runtime: RuntimeInfo): string | undefined {
  if (!runtime.packaged) return undefined
  return join(runtime.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', `claude-agent-sdk-${runtime.platform}-${runtime.arch}`, 'claude')
}

/** The canvas a Session in a Project works with. */
export interface CanvasAttachment {
  /** The `worfy-canvas` MCP server bound to the Project. */
  server: McpServerConfig
  /** `<Project data folder>/cards`, where the agent writes Cards. */
  cardsDir: string
  /** Appended to the claude_code system prompt (src/main/mcp/agent-instructions.md). */
  instructions: string
}

export interface SessionOptionsInput {
  /** Root of the Project the Session works in. */
  cwd: string
  /** Environment from the user's login shell, without API keys (env.ts). */
  env: Env
  runtime: RuntimeInfo
  /** Session id to continue, when the Session is resumed. */
  resume?: string | undefined
  /** Receives Claude Code's stderr, to explain a crash. */
  stderr?: ((data: string) => void) | undefined
  /** Absent when the Session's cwd is in no Project: it then runs without canvas tools. */
  canvas?: CanvasAttachment | null | undefined
}

export function sessionOptions(input: SessionOptionsInput): Options {
  const options: Options = {
    cwd: input.cwd,
    env: input.env,
    settingSources: ['user', 'project', 'local'],
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    permissionMode: 'bypassPermissions',
    // Not required by SDK 0.3.289 (ticket 06, question 9), but documented as required with
    // bypassPermissions: passing it keeps a stricter SDK from silently falling back to prompts.
    allowDangerouslySkipPermissions: true,
    // Live text (stream_event deltas) and every hook run, including Stop hooks that block a turn.
    includePartialMessages: true,
    includeHookEvents: true,
  }
  const executable = claudeExecutablePath(input.runtime)
  if (executable !== undefined) options.pathToClaudeCodeExecutable = executable
  if (input.resume !== undefined) options.resume = input.resume
  if (input.stderr !== undefined) options.stderr = input.stderr
  if (input.canvas) {
    // Added to the user's own MCP servers from settingSources, not instead of them.
    options.mcpServers = { [CANVAS_SERVER_NAME]: input.canvas.server }
    options.additionalDirectories = [input.canvas.cardsDir]
    options.systemPrompt = { type: 'preset', preset: 'claude_code', append: input.canvas.instructions }
  }
  return options
}

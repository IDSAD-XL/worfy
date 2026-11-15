// What the query of the MCP inventory needs from the Project's record in the user's .claude.json (worfy-mcp-live
// ticket 14, audit finding 29). The inventory runs outside every Project — in <WORFY_DATA_DIR>/terminal-ai, like
// the Limits probe — so Claude Code registers no Session of the Project in ~/.claude/sessions and the Canvas shows
// no read-only Session Node for it. The Session's folder goes to it as `projectConfigRoot` (--project-config-root,
// options.ts inventoryOptions): Claude Code 2.1.322 (SDK 0.3.322) then reads the Project's .mcp.json, its settings
// and plugins from there and starts its stdio servers there, with CLAUDE_PROJECT_DIR set to it.
//
// One thing that flag does not move: Claude Code keys the Project's record in .claude.json (`projects[...]`: the
// local servers of `claude mcp add`, and `disabledMcpServers` of /mcp disable) by its working folder's canonical git
// root, never by the config root (binary: `Axe` reads `Ce()`, the original cwd, through `YH`, the canonical git root).
// So worfy reads that record itself, by the main repository root of the Session's folder (a worktree's record is
// the main checkout's, as Claude Code keys it), and:
//
// - hands its local servers, as written, to the query (mcpServers; Claude Code expands and checks them as it does
//   a local server), less the ones turned off; Claude Code reports a handed server as `dynamic`, and the answer
//   gives it back its scope `local` (withLocalScope);
// - names the turned-off ones as `disabledMcpjsonServers` of the query's flag settings, so a server of the
//   Project's .mcp.json turned off with /mcp is not started either. A user server turned off only in this
//   Project is not stopped: Claude Code takes no such setting from anything but that record (shortcut: it runs
//   for the inventory's seconds, redo when Claude Code takes disabledMcpServers from settings).
//
// Nothing here writes, and no server's configuration leaves memory.
import { readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import type { QueryHandle } from '../../agent/session/types'
import { repositoryRoot } from '../../mcp/canvas-server'

type Env = Readonly<Record<string, string | undefined>>

/** Not exported: an SDK type does not leave the driver's folder (test/contract/vendor-sdk-imports.test.ts). */
interface LocalMcp {
  /** The local servers of the Project's record that are not turned off, as written. */
  servers: Record<string, McpServerConfig>
  /** The servers turned off in the Project with /mcp (`disabledMcpServers` of its record). */
  disabled: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The user's .claude.json as Claude Code started with `env` reads it: in CLAUDE_CONFIG_DIR when set, else in HOME. */
function claudeJsonPath(env: Env): string {
  if (env.CLAUDE_CONFIG_DIR) return join(resolve(env.CLAUDE_CONFIG_DIR), '.claude.json')
  return join(env.HOME ?? homedir(), '.claude.json')
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** The key Claude Code files the folder's record under: the main repository root, or the folder outside git; NFC. */
async function recordKeys(folder: string, rootOf: (folder: string) => Promise<string | null>): Promise<string[]> {
  const root = (await rootOf(folder).catch(() => null)) ?? folder
  const real = await realpath(root).catch(() => root)
  return [...new Set([real, resolve(root)].map((key) => key.normalize('NFC')))]
}

/**
 * A server Claude Code can take on its command line, kept as written: a stdio one with a string command, a remote
 * one (http, sse, ws) with a string url. Any other shape is left out: Claude Code refuses the whole query for one.
 */
function takeable(config: unknown): config is McpServerConfig {
  if (!isRecord(config)) return false
  const type = config.type ?? 'stdio'
  if (type === 'stdio') return typeof config.command === 'string'
  return (type === 'http' || type === 'sse' || type === 'ws') && typeof config.url === 'string'
}

/**
 * The Project's record in the user's .claude.json for the folder `folder`: its local servers that are not turned
 * off, and the turned-off ones. `rootOf`: the main repository root of a folder (repositoryRoot by default).
 */
export async function projectLocalMcp(folder: string, env: Env, rootOf: (folder: string) => Promise<string | null> = repositoryRoot): Promise<LocalMcp> {
  const [claudeJson, keys] = await Promise.all([readJson(claudeJsonPath(env)), recordKeys(resolve(folder), rootOf)])
  const projects = isRecord(claudeJson?.projects) ? claudeJson.projects : {}
  const record = keys.map((key) => projects[key]).find(isRecord)
  if (record === undefined) return { servers: {}, disabled: [] }
  const disabled = Array.isArray(record.disabledMcpServers) ? record.disabledMcpServers.filter((name): name is string => typeof name === 'string') : []
  const servers: Record<string, McpServerConfig> = {}
  if (isRecord(record.mcpServers)) {
    for (const [name, config] of Object.entries(record.mcpServers)) if (!disabled.includes(name) && takeable(config)) servers[name] = config
  }
  return { servers, disabled }
}

/** `handle` whose mcpServerStatus() gives each server of `names` that Claude Code reports as `dynamic` (handed to it) its scope `local` back. */
export function withLocalScope(handle: QueryHandle, names: readonly string[]): QueryHandle {
  const status = handle.mcpServerStatus
  if (status === undefined || names.length === 0) return handle
  handle.mcpServerStatus = async () => {
    const answer: unknown = await status.call(handle)
    if (!Array.isArray(answer)) return answer
    return answer.map((entry: unknown) => {
      if (!isRecord(entry) || typeof entry.name !== 'string' || !names.includes(entry.name)) return entry
      if (entry.source !== undefined && entry.source !== 'dynamic') return entry
      return { ...entry, source: 'local', ...(entry.scope === undefined || entry.scope === 'dynamic' ? { scope: 'local' } : {}) }
    })
  }
  return handle
}

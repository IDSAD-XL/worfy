// The MCP servers a Project's folder brings to Claude Code (worfy-mcp-live ticket 14, audit finding 29). The
// query of the MCP inventory runs outside every Project — in <WORFY_DATA_DIR>/terminal-ai, like the Limits
// probe — so Claude Code registers no Session of the Project in ~/.claude/sessions, and the Canvas shows no
// read-only Session Node for it. Claude Code started there reads the user's servers and the claude.ai
// connectors as before, but not the ones it takes from the Project's folder; worfy reads those itself and
// hands them to the query (options.ts, inventoryOptions):
//
// - project scope: `mcpServers` of each `.mcp.json` from the folder up to the root of the disk, the nearer
//   file winning a name, less the names the user rejected (`disabledMcpjsonServers` of the user's settings,
//   the Project's `.claude/settings.json` and `.claude/settings.local.json`, or the folder's record in
//   .claude.json). A server nobody approved stays: Claude Code under the SDK starts it when the project
//   settings are read, as they are for a Session (settingSources project).
// - local scope: `mcpServers` of the folder's record in the user's .claude.json (`claude mcp add` in it).
//
// A local server wins a name over a project one, as in Claude Code. Claude Code reports a server handed to
// it so as `dynamic`; the inventory's answer gets its scope back (withProjectScopes), so its row still reads
// as the Project's. Nothing here writes, and no server's configuration leaves memory.
import { readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import type { QueryHandle } from '../../agent/session/types'

type Env = Readonly<Record<string, string | undefined>>

/** The scope Claude Code gives a server of the Project's folder when it reads the folder itself. */
export type ProjectScope = 'project' | 'local'

/** Not exported: an SDK type does not leave the driver's folder (test/contract/vendor-sdk-imports.test.ts). */
interface ProjectMcp {
  /** The servers by name, as the query's mcpServers. */
  servers: Record<string, McpServerConfig>
  /** The scope of each of them. */
  scopes: ReadonlyMap<string, ProjectScope>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isStringRecord = (value: unknown): value is Record<string, string> => isRecord(value) && Object.values(value).every((item) => typeof item === 'string')
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')

/** A JSON file as a record; null when it is missing, unreadable or not an object. */
async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** `${VAR}` and `${VAR:-default}` of `text` by `env`, as Claude Code expands a server of .mcp.json; an unset one without a default stays as written. */
function expand(text: string, env: Env): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (whole, name: string, fallback: string | undefined) => env[name] ?? fallback ?? whole)
}

/**
 * The server of one entry of a configuration, its strings expanded; null for a shape Claude Code would refuse
 * on its command line (one bad entry there would stop the whole query, not just leave the server out).
 */
function serverOf(config: unknown, env: Env): McpServerConfig | null {
  if (!isRecord(config)) return null
  const put = (text: string): string => expand(text, env)
  const type = config.type ?? 'stdio'
  if (type === 'stdio') {
    if (typeof config.command !== 'string' || (config.args !== undefined && !isStringArray(config.args)) || (config.env !== undefined && !isStringRecord(config.env))) return null
    return {
      type: 'stdio',
      command: put(config.command),
      ...(config.args === undefined ? {} : { args: config.args.map(put) }),
      ...(config.env === undefined ? {} : { env: Object.fromEntries(Object.entries(config.env).map(([key, value]) => [key, put(value)])) }),
    }
  }
  if (type === 'http' || type === 'sse') {
    if (typeof config.url !== 'string' || (config.headers !== undefined && !isStringRecord(config.headers))) return null
    return {
      type,
      url: put(config.url),
      ...(config.headers === undefined ? {} : { headers: Object.fromEntries(Object.entries(config.headers).map(([key, value]) => [key, put(value)])) }),
    }
  }
  return null
}

/** The servers of `mcpServers` of a record, each one Claude Code can take; the rest left out. */
function serversOf(record: Record<string, unknown> | null, env: Env): [string, McpServerConfig][] {
  if (record === null || !isRecord(record.mcpServers)) return []
  return Object.entries(record.mcpServers).flatMap(([name, config]): [string, McpServerConfig][] => {
    const server = serverOf(config, env)
    return server === null ? [] : [[name, server]]
  })
}

/** The folders from `folder` up to the root of the disk, the root first. */
function foldersUp(folder: string): string[] {
  const up = [folder]
  for (let at = folder; dirname(at) !== at; at = dirname(at)) up.push(dirname(at))
  return up.reverse()
}

/** Where Claude Code started with `env` keeps the user's config: its settings folder and its .claude.json. */
function claudeConfig(env: Env): { dir: string; json: string } {
  if (env.CLAUDE_CONFIG_DIR) return { dir: resolve(env.CLAUDE_CONFIG_DIR), json: join(resolve(env.CLAUDE_CONFIG_DIR), '.claude.json') }
  const home = env.HOME ?? homedir()
  return { dir: join(home, '.claude'), json: join(home, '.claude.json') }
}

/** The folder's record in .claude.json, by its path as given or as the disk has it (Claude Code keys it by its real cwd). */
async function folderRecord(claudeJson: Record<string, unknown> | null, folder: string): Promise<Record<string, unknown> | null> {
  const projects = claudeJson?.projects
  if (!isRecord(projects)) return null
  const real = await realpath(folder).catch(() => folder)
  const record = projects[real] ?? projects[folder]
  return isRecord(record) ? record : null
}

/** The MCP servers Claude Code would take from the folder `folder`, with `env` as the user's environment. */
export async function projectMcpServers(folder: string, env: Env): Promise<ProjectMcp> {
  const at = resolve(folder)
  const config = claudeConfig(env)
  const [mcpFiles, claudeJson, ...settings] = await Promise.all([
    Promise.all(foldersUp(at).map((dir) => readJson(join(dir, '.mcp.json')))),
    readJson(config.json),
    readJson(join(config.dir, 'settings.json')),
    readJson(join(at, '.claude', 'settings.json')),
    readJson(join(at, '.claude', 'settings.local.json')),
  ])
  const record = await folderRecord(claudeJson, at)
  const rejected = new Set([...settings, record].flatMap((source) => (source !== null && isStringArray(source.disabledMcpjsonServers) ? source.disabledMcpjsonServers : [])))
  const servers: Record<string, McpServerConfig> = {}
  const scopes = new Map<string, ProjectScope>()
  for (const file of mcpFiles) {
    for (const [name, server] of serversOf(file, env)) {
      if (rejected.has(name)) continue
      servers[name] = server
      scopes.set(name, 'project')
    }
  }
  for (const [name, server] of serversOf(record, env)) {
    servers[name] = server
    scopes.set(name, 'local')
  }
  return { servers, scopes }
}

/**
 * `handle` whose mcpServerStatus() gives each server of `scopes` that Claude Code reports as `dynamic` (handed
 * to it) its scope in the Project's folder back, in `source` and `scope`.
 */
export function withProjectScopes(handle: QueryHandle, scopes: ReadonlyMap<string, ProjectScope>): QueryHandle {
  const status = handle.mcpServerStatus
  if (status === undefined || scopes.size === 0) return handle
  handle.mcpServerStatus = async () => {
    const answer: unknown = await status.call(handle)
    if (!Array.isArray(answer)) return answer
    return answer.map((entry: unknown) => {
      if (!isRecord(entry) || typeof entry.name !== 'string') return entry
      const scope = scopes.get(entry.name)
      if (scope === undefined || (entry.source !== undefined && entry.source !== 'dynamic')) return entry
      return { ...entry, source: scope, ...(entry.scope === undefined || entry.scope === 'dynamic' ? { scope } : {}) }
    })
  }
  return handle
}

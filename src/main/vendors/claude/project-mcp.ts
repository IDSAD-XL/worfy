// What the query of the MCP inventory needs from the Project's record in the user's .claude.json (worfy-mcp-live
// ticket 14, audit finding 29). The inventory runs outside every Project — in <WORFY_DATA_DIR>/terminal-ai, like
// the Limits probe — so Claude Code registers no Session of the Project in ~/.claude/sessions and the Canvas shows
// no read-only Session Node for it. The Session's folder goes to it as `projectConfigRoot` (--project-config-root,
// options.ts inventoryOptions): Claude Code 2.1.322 (SDK 0.3.322) then reads the Project's .mcp.json, its settings
// and plugins from there and starts its stdio servers there, with CLAUDE_PROJECT_DIR set to it.
//
// One thing that flag does not move: Claude Code keys the Project's record in .claude.json (`projects[...]`: the
// local servers of `claude mcp add`, and `disabledMcpServers` of /mcp disable) by its working folder, never by the
// config root (binary: `Axe` keys it by `E8(YH(Ce()))`, Ce() being the original cwd). So worfy reads that record
// itself, under the key Claude Code would have used in the Session's folder (claudeConfigKey), and:
//
// - hands its local servers, as written, to the query (mcpServers; Claude Code expands and checks them as it does a
//   local server), less the ones turned off. Their rows read as user config, as a local server's always did;
// - names the turned-off ones as `disabledMcpjsonServers` of the query's flag settings. That setting only rejects a
//   server of the Project's .mcp.json: a user server or a claude.ai connector turned off with /mcp in this Project
//   still connects for the inventory's seconds, since Claude Code reads `disabledMcpServers` from the cwd's record
//   alone (shortcut: such a server runs during the inventory, redo when Claude Code takes disabledMcpServers from
//   settings or from the config root).
//
// Nothing here writes, and no server's configuration leaves memory.
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'

type Env = Readonly<Record<string, string | undefined>>

/** Not exported: an SDK type does not leave the driver's folder (test/contract/vendor-sdk-imports.test.ts). */
interface LocalMcp {
  /** The local servers of the Project's record that are not turned off, as written. */
  servers: Record<string, McpServerConfig>
  /** The servers turned off in the Project with /mcp (`disabledMcpServers` of its record). */
  disabled: string[]
}

/** What claudeConfigKey reads of the disk: whether a path exists, a file's text (null when it cannot be read), a real path. */
export interface KeyDisk {
  exists(path: string): boolean
  read(path: string): string | null
  /** The path as the disk has it; the path itself when that cannot be read. */
  real(path: string): string
}

const nodeDisk: KeyDisk = {
  exists: (path) => existsSync(path),
  read: (path) => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null
    }
  },
  real: (path) => {
    try {
      return realpathSync.native(path)
    } catch {
      return path
    }
  },
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The canonical root of the git root `root`, as Claude Code finds it (binary: `cr` under `kt`): a linked worktree
 * (`.git` a file `gitdir: <common>/worktrees/<name>` whose `gitdir` points back at it) stands for the repository
 * it belongs to — the main checkout when the common folder is `<main>/.git`, else the bare repository's folder
 * (`repo.git`, `repo/.bare`), unless that folder has a `.git` of its own; anything else stands for itself.
 */
function canonicalRoot(root: string, path: typeof posix, disk: KeyDisk): string {
  const text = disk.read(path.join(root, '.git'))?.trim()
  if (text === undefined || !text.startsWith('gitdir:')) return root
  const gitDir = path.resolve(root, text.slice('gitdir:'.length).trim())
  const common = disk.read(path.join(gitDir, 'commondir'))?.trim()
  if (common === undefined || common === '') return root
  const commonDir = path.resolve(gitDir, common)
  if (path.resolve(path.dirname(gitDir)) !== path.join(commonDir, 'worktrees')) return root
  const back = disk.read(path.join(gitDir, 'gitdir'))?.trim()
  if (back === undefined || back === '' || disk.real(path.resolve(gitDir, back)) !== path.join(disk.real(root), '.git')) return root
  if (path.basename(commonDir) !== '.git') return disk.exists(path.join(commonDir, '.git')) ? root : commonDir.normalize('NFC')
  return path.dirname(commonDir).normalize('NFC')
}

/** The nearest folder from `start` up that holds a `.git` (binary: `lr`); null outside git. */
function gitRoot(start: string, path: typeof posix, disk: KeyDisk): string | null {
  for (let at = start; ; at = path.dirname(at)) {
    if (disk.exists(path.join(at, '.git'))) return at.normalize('NFC')
    if (path.dirname(at) === at) return null
  }
}

/**
 * The key of the record Claude Code keeps in .claude.json for a session started in the folder `cwd` (binary: `Axe`):
 * the canonical root of its git root, else the folder itself (NFC), normalised (`E8`) — with forward slashes on
 * Windows, so `D:\work\proj` is `D:/work/proj`.
 */
export function claudeConfigKey(cwd: string, platform: NodeJS.Platform = process.platform, disk: KeyDisk = nodeDisk): string {
  const path = platform === 'win32' ? win32 : posix
  const start = path.resolve(cwd)
  const root = gitRoot(start, path, disk)
  const key = path.normalize(root === null ? start.normalize('NFC') : canonicalRoot(root, path, disk))
  return platform === 'win32' ? key.replaceAll('\\', '/') : key
}

/** The user's .claude.json as Claude Code started with `env` reads it: in CLAUDE_CONFIG_DIR when set, else in HOME. */
function claudeJsonPath(env: Env): string {
  const path = process.platform === 'win32' ? win32 : posix
  if (env.CLAUDE_CONFIG_DIR) return path.join(path.resolve(env.CLAUDE_CONFIG_DIR), '.claude.json')
  return path.join(env.HOME ?? homedir(), '.claude.json')
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
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
 * The Project's record in the user's .claude.json for a Session in the folder `folder`: its local servers that are
 * not turned off, and the turned-off ones. The folder is keyed as given and as the disk has it, since Claude Code's
 * cwd is the real one.
 */
export function projectLocalMcp(folder: string, env: Env): LocalMcp {
  const claudeJson = readJson(claudeJsonPath(env))
  const projects = isRecord(claudeJson?.projects) ? claudeJson.projects : {}
  const record = [...new Set([nodeDisk.real(folder), folder].map((at) => claudeConfigKey(at)))].map((key) => projects[key]).find(isRecord)
  if (record === undefined) return { servers: {}, disabled: [] }
  const disabled = Array.isArray(record.disabledMcpServers) ? record.disabledMcpServers.filter((name): name is string => typeof name === 'string') : []
  const servers: Record<string, McpServerConfig> = {}
  if (isRecord(record.mcpServers)) {
    for (const [name, config] of Object.entries(record.mcpServers)) if (!disabled.includes(name) && takeable(config)) servers[name] = config
  }
  return { servers, disabled }
}

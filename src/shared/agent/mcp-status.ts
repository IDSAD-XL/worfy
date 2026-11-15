// The MCP servers of a Session as the renderer draws them (worfy-mcp-live ticket 02): one row per
// server, the same for every Vendor. main builds the rows — the driver of each Vendor decides which
// actions a row offers — and the renderer only draws them, a button per action.
//
// A row says nothing of the server's config: its URL and headers stay in the driver (spec
// worfy-mcp-live, the privacy decision). Names and errors of the user's servers are shown on the user's own
// screen only; they are not written to the Autopilot journal or to a log.
import { z } from 'zod'
import { BROWSER_SERVER_NAME } from '../browser/tools'
import { CANVAS_SERVER_NAME } from '../canvas/tools'
import { MIND_MAP_SERVER_NAME } from '../product/tools'

/**
 * How the server is: the Vendor's statuses, `not-allowed` for a server outside the Project's list (Claude,
 * ticket 05), and `not-started` for one the list names that the Vendor did not start in the Session at all
 * (Claude: a server of the user the MCP inventory finds, absent from the Session's own status).
 */
export const MCP_SERVER_STATUSES = ['connected', 'failed', 'needs-auth', 'pending', 'disabled', 'not-allowed', 'not-started'] as const

/** Where the server came from: a claude.ai connector, the user's config, the Project's, or worfy's own (and plugins'). */
export const MCP_SERVER_SOURCES = ['claudeai', 'user', 'project', 'worfy'] as const
export type McpServerSource = (typeof MCP_SERVER_SOURCES)[number]

/**
 * What a person may do with a server. `reconnect` comes with ticket 02; `turn-off`, `turn-on` and
 * `restart` with the Restart of ticket 03, `allow` and `sign-in` with ticket 05.
 */
export const MCP_SERVER_ACTIONS = ['reconnect', 'turn-off', 'turn-on', 'allow', 'sign-in', 'restart'] as const
export const mcpServerActionSchema = z.enum(MCP_SERVER_ACTIONS)
export type McpServerAction = z.infer<typeof mcpServerActionSchema>

export const mcpServerRowSchema = z.object({
  name: z.string().min(1),
  status: z.enum(MCP_SERVER_STATUSES),
  /** How many tools the server gives; null when the Vendor did not say (not connected, or a list without tools). */
  tools: z.number().int().nonnegative().nullable(),
  /** Why the server failed, in the Vendor's words; null when it did not fail or did not say. */
  error: z.string().nullable(),
  source: z.enum(MCP_SERVER_SOURCES),
  /** The Vendor's own word for a source worfy shows as user config without knowing it (`managed`, …), for a tooltip; null otherwise. */
  sourceWord: z.string().nullable(),
  actions: z.array(mcpServerActionSchema),
})
export type McpServerRow = z.infer<typeof mcpServerRowSchema>

/** The Vendor's `source` words worfy knows, and the source each one is shown as. */
const KNOWN_SOURCES: Readonly<Record<string, McpServerSource>> = {
  claudeai: 'claudeai',
  user: 'user',
  local: 'user',
  // A server of the user's config that Claude Code took in while it ran (reloadPlugins) says `dynamic`.
  dynamic: 'user',
  project: 'project',
  // An in-process server of the host — worfy's own (sdk) — and a server of a Claude Code plugin the user
  // installed (plugin). The Harness's qmd server is neither: Claude Code reports it as `dynamic`, user config.
  sdk: 'worfy',
  plugin: 'worfy',
}

/** The MCP servers worfy itself registers in a Session: its in-process servers. */
export const WORFY_SERVER_NAMES: readonly string[] = [CANVAS_SERVER_NAME, BROWSER_SERVER_NAME, MIND_MAP_SERVER_NAME]

/**
 * Whether `row` is one of worfy's own servers (worfy-mcp-live ticket 09, owner's Q2): source worfy and a name
 * worfy registers. Such a server is never turned off for a Session. A server of a plugin the user installed
 * shows as source worfy too, and keeps Turn off.
 */
export const isWorfyOwnServer = (row: Pick<McpServerRow, 'name' | 'source'>): boolean => row.source === 'worfy' && WORFY_SERVER_NAMES.includes(row.name)

/**
 * The source of a server by the Vendor's word for it. A word worfy does not know by name (`managed`,
 * `enterprise`, `agent`, a new one) is user config, with the word kept for the tooltip; no word at all
 * (a Claude Code older than the field) is user config too.
 */
export function mcpSourceOf(word: string | null | undefined): { source: McpServerSource; sourceWord: string | null } {
  if (word === null || word === undefined || word === '') return { source: 'user', sourceWord: null }
  const known = Object.hasOwn(KNOWN_SOURCES, word) ? KNOWN_SOURCES[word] : undefined
  return known === undefined ? { source: 'user', sourceWord: word } : { source: known, sourceWord: null }
}

/** The word Claude Code puts before the name of a claude.ai connector, with its space. */
const CLAUDEAI_PREFIX = 'claude.ai '

/**
 * The name the popover shows for `row` (worfy-mcp-live ticket 10): a claude.ai connector's name without the
 * leading «claude.ai », which its source already says; every other name whole. The row keeps its full name:
 * the actions go to main by it, and the popover shows it in a tooltip.
 */
export function mcpShownName(row: Pick<McpServerRow, 'name' | 'source'>): string {
  const rest = row.name.slice(CLAUDEAI_PREFIX.length)
  return row.source === 'claudeai' && row.name.startsWith(CLAUDEAI_PREFIX) && rest.trim() !== '' ? rest : row.name
}

/** Whether two lists of rows are the same; null is "no data". */
export function sameMcpRows(a: readonly McpServerRow[] | null, b: readonly McpServerRow[] | null): boolean {
  if (a === null || b === null) return a === b
  return JSON.stringify(a) === JSON.stringify(b)
}

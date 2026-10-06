// The slash commands and skills of a Session for the slash menu (ticket 20).
//
// Two sources, both from Claude Code itself, so the user's own skills under ~/.claude and the
// Project's commands are there as Claude Code sees them (worfy only reads, it never lists the
// folders itself):
// - supportedCommands() of the live query: every command with its description and argument hint;
//   it follows the latest system/commands_changed;
// - the names of the last system/init (`slash_commands`, `skills`) and the rows of the last
//   system/commands_changed: what is known without a live query, and which names are skills.
// A row of supportedCommands() wins over a bare name; a name only system/init gives is listed
// without a description.
//
// The two sources spell some names differently (Claude Code 2.1.291; worfy-daily ticket 25).
// system/init and `skills` carry the command's own name; supportedCommands() carries the name
// Claude Code's menu shows, with the own name among `aliases` when that one holds a `:`:
// - a plugin skill: `anthropic-skills:docs` in system/init, `docs` (alias `anthropic-skills:docs`)
//   in supportedCommands();
// - an MCP prompt: `mcp__github__AssignCodingAgent` in system/init,
//   `github:AssignCodingAgent (MCP)` in supportedCommands(), no alias.
// A row and a name of system/init that spell one command make one entry: the row's description and
// hint, under the system/init name (the command's own name, which `/name` always runs, and never a
// space in it), marked `skill` when system/init lists it under `skills`.
import type { SlashCommand } from '../../shared/agent/commands'

/** A row of supportedCommands() or system/commands_changed (SlashCommand of SDK 0.3.289), as far as worfy reads it. */
export interface CommandInfoLike {
  name: string
  description?: string | undefined
  argumentHint?: string | undefined
  /** Other names that run the command; Claude Code puts the command's own name here when the row shows another. */
  aliases?: string[] | undefined
}

/** The part of a query the catalog asks; supportedCommands() is optional so older doubles still fit. */
export interface CommandSource {
  supportedCommands?: (() => Promise<CommandInfoLike[]>) | undefined
}

const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null)

const names = (value: unknown): string[] => (Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string' && each !== '') : [])

const rows = (value: unknown): CommandInfoLike[] =>
  Array.isArray(value)
    ? value.flatMap((each) => {
        const row = record(each)
        if (row === null || typeof row.name !== 'string' || row.name === '') return []
        return [
          {
            name: row.name,
            description: typeof row.description === 'string' ? row.description : '',
            argumentHint: typeof row.argumentHint === 'string' ? row.argumentHint : '',
            aliases: names(row.aliases),
          },
        ]
      })
    : []

const bare = (name: string): string => name.replace(/^\/+/, '')

const MCP_SUFFIX = ' (MCP)'

/** The server part of an MCP command's own name, as Claude Code 2.1.291 writes it (`mcp__<server>__<prompt>`). */
const mcpServerPart = (server: string): string => {
  const replaced = server.replace(/[^a-zA-Z0-9_-]/g, '_')
  return server.startsWith('claude.ai ') ? replaced.replace(/_+/g, '_').replace(/^_|_$/g, '') : replaced
}

/** `mcp__github__AssignCodingAgent` for `github:AssignCodingAgent (MCP)`; null for a name of another shape. */
const mcpOwnName = (shown: string): string | null => {
  if (!shown.endsWith(MCP_SUFFIX)) return null
  const name = shown.slice(0, -MCP_SUFFIX.length)
  const colon = name.indexOf(':')
  if (colon <= 0 || colon === name.length - 1) return null
  return `mcp__${mcpServerPart(name.slice(0, colon))}__${name.slice(colon + 1)}`
}

/** The names other than its shown one that may be a row's own name: its aliases and the MCP spelling of each. */
const otherSpellings = (row: CommandInfoLike): string[] => {
  const spellings = [row.name, ...(row.aliases ?? [])].map(bare).flatMap((each) => [each, mcpOwnName(each)].filter((one): one is string => one !== null && one !== ''))
  const shown = bare(row.name)
  return [...new Set(spellings)].filter((each) => each !== shown)
}

export class CommandCatalog {
  private initNames: string[] = []
  private skills = new Set<string>()
  private changed: CommandInfoLike[] | null = null

  /** Takes what a raw SDK message says about the commands: system/init and system/commands_changed. */
  observe(message: unknown): void {
    const m = record(message)
    if (m === null || m.type !== 'system') return
    if (m.subtype === 'init') {
      this.initNames = names(m.slash_commands).map(bare)
      this.skills = new Set(names(m.skills).map(bare))
    } else if (m.subtype === 'commands_changed') {
      this.changed = rows(m.commands)
    }
  }

  /** The commands for the slash menu: those of the live query when it answers, with what the messages said. */
  async list(query: CommandSource | null): Promise<SlashCommand[]> {
    let supported: CommandInfoLike[] | null = null
    if (query?.supportedCommands) {
      try {
        supported = rows(await query.supportedCommands())
      } catch (error) {
        console.warn('[agent] supportedCommands failed', error)
      }
    }
    const described = supported ?? this.changed ?? []
    const initNames = new Set(this.initNames)
    // An alias that is the shown name of another row names that command, not this one (`/cost`
    // of `/usage` while a `/cost` row exists).
    const shownNames = new Set(described.map((row) => bare(row.name)))
    const listed = new Map<string, SlashCommand>()
    const add = (name: string, row: CommandInfoLike, others: string[]) => {
      if (name === '' || listed.has(name)) return
      const kind = [name, ...others].some((each) => this.skills.has(each)) ? 'skill' : 'command'
      listed.set(name, { name, description: row.description ?? '', argumentHint: row.argumentHint ?? '', kind })
    }
    for (const row of described) {
      const shown = bare(row.name)
      const others = otherSpellings(row).filter((each) => !shownNames.has(each))
      const own = others.find((each) => initNames.has(each) && !listed.has(each)) ?? mcpOwnName(shown) ?? shown
      add(own, row, others)
    }
    for (const name of this.initNames) add(name, { name }, [])
    return [...listed.values()]
  }
}

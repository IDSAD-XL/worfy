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
import type { SlashCommand } from '../../shared/agent/commands'

/** A row of supportedCommands() or system/commands_changed (SlashCommand of SDK 0.3.289), as far as worfy reads it. */
export interface CommandInfoLike {
  name: string
  description?: string | undefined
  argumentHint?: string | undefined
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
        return [{ name: row.name, description: typeof row.description === 'string' ? row.description : '', argumentHint: typeof row.argumentHint === 'string' ? row.argumentHint : '' }]
      })
    : []

const bare = (name: string): string => name.replace(/^\/+/, '')

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
    const listed = new Map<string, SlashCommand>()
    const add = (row: CommandInfoLike) => {
      const name = bare(row.name)
      if (name === '' || listed.has(name)) return
      listed.set(name, { name, description: row.description ?? '', argumentHint: row.argumentHint ?? '', kind: this.skills.has(name) ? 'skill' : 'command' })
    }
    for (const row of supported ?? this.changed ?? []) add(row)
    for (const name of this.initNames) add({ name })
    return [...listed.values()]
  }
}

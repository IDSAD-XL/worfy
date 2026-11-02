// The commands part of a Vendor driver (ADR-0094 item 2): the rows of a Session's slash menu.
import type { SlashCommand } from '../../shared/agent/commands'
import type { CommandSource } from '../agent/commands'

/** What a Session knows of its slash commands; one per Session. */
export interface SlashCatalog {
  /** Takes what a message of the Vendor says about the commands. */
  observe(message: unknown): void
  /**
   * The rows of the slash menu, asking the live agent when there is one.
   * shortcut: the source is Claude Code's Query, redo when ticket 14 (worfy-multi-vendor) has the
   * SessionHandle give the commands as events.
   */
  list(source: CommandSource | null): Promise<SlashCommand[]>
}

export interface CommandsPart {
  /** A new catalog, for one Session. */
  catalog(): SlashCatalog
}

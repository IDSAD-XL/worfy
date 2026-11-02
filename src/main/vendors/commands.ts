// The commands part of a Vendor driver (ADR-0094 item 2): the rows of a Session's slash menu.
import type { SlashCommand } from '../../shared/agent/commands'
import type { SessionHandle } from './session'

export interface CommandsPart {
  /** The rows of the slash menu of the live Session `session`, a handle of this driver's. */
  list(session: SessionHandle): Promise<SlashCommand[]>
}

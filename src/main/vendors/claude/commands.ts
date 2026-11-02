// The commands part of the Claude driver: the catalog of supportedCommands() and system/init that
// each Session keeps today (src/main/agent/commands.ts).
import { CommandCatalog } from '../../agent/commands'
import type { CommandsPart } from '../commands'

export const claudeCommands: CommandsPart = {
  catalog: () => new CommandCatalog(),
}

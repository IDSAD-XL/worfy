// The commands part of the Claude driver: the catalog of supportedCommands() and system/init that
// each Claude Session keeps (src/main/agent/commands.ts), as Session.commands() lists it today.
import type { CommandsPart } from '../commands'
import { PartNotWired } from '../driver'
import { claudeLive } from './session'

export const claudeCommands: CommandsPart = {
  list(session) {
    const live = claudeLive(session)
    if (live === null) return Promise.reject(new PartNotWired('claude', 'commands.list', 'it takes the SessionHandle of the Claude driver: worfy-multi-vendor ticket 14'))
    return live.catalog.list(live.query)
  },
}

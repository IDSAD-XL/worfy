// The commands part of the Codex driver (ADR-0094 item 2): a stub until worfy-multi-vendor ticket 22
// lists the skills and the commands the app server runs. That ticket replaces this file only.
import type { CommandsPart } from '../commands'
import { PartNotWired } from '../driver'

export const codexCommands: CommandsPart = {
  list: () => Promise.reject(new PartNotWired('codex', 'commands', 'worfy-multi-vendor ticket 22')),
}

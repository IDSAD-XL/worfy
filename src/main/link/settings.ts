// The link settings of this Machine (worfy-link tickets 02 and 14; ADR-0052, point 6):
// link/settings.json in worfy's data folder. Two switches:
// - "Linked machines can work with my Projects" (`projectsAccess`): off for a fresh data folder and
//   off when the file is missing or unreadable. worfy-link ticket 08 applies it to the channels a
//   Linked machine may call.
// - "Keep this computer awake while linked machines are connected" (`keepAwake`, ticket 14): on by
//   default — the owner's decision is that a Project machine does not sleep while it is used —
//   and also on in a file written before it existed. keep-awake.ts applies it.
// This module only keeps and announces them.
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { z } from 'zod'
import { readJsonFile, writeJsonFile } from '../storage/json-file'

const settingsFileSchema = z.object({
  version: z.literal(1),
  projectsAccess: z.boolean(),
  /** Absent in a file written before worfy-link ticket 14: the default then. */
  keepAwake: z.boolean().optional(),
})

export interface LinkSettingsValue {
  /** "Linked machines can work with my Projects". */
  projectsAccess: boolean
  /** "Keep this computer awake while linked machines are connected". */
  keepAwake: boolean
}

export const DEFAULT_LINK_SETTINGS: Readonly<LinkSettingsValue> = Object.freeze({ projectsAccess: false, keepAwake: true })

export class LinkSettings extends EventEmitter<{ changed: [LinkSettingsValue] }> {
  private readonly file: string
  private value: LinkSettingsValue

  constructor(linkDir: string, warn: (message: string) => void = (message) => console.warn(message)) {
    super()
    this.file = join(linkDir, 'settings.json')
    let stored: z.output<typeof settingsFileSchema> | undefined
    try {
      stored = readJsonFile(this.file, settingsFileSchema)
    } catch (error) {
      // Access stays off when the file cannot be read: the safe side of the switch.
      warn(`[link] ${this.file} could not be read, access stays off: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.value =
      stored === undefined
        ? { ...DEFAULT_LINK_SETTINGS }
        : { projectsAccess: stored.projectsAccess, keepAwake: stored.keepAwake ?? DEFAULT_LINK_SETTINGS.keepAwake }
  }

  get(): LinkSettingsValue {
    return { ...this.value }
  }

  /** Saves a change and announces it; nothing is written or announced when nothing changes. */
  set(change: Partial<LinkSettingsValue>): LinkSettingsValue {
    const next = { ...this.value, ...change }
    if (next.projectsAccess === this.value.projectsAccess && next.keepAwake === this.value.keepAwake) return this.get()
    writeJsonFile(this.file, settingsFileSchema, { version: 1, projectsAccess: next.projectsAccess, keepAwake: next.keepAwake })
    this.value = next
    this.emit('changed', this.get())
    return this.get()
  }
}

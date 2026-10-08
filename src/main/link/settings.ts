// The link settings of this Machine (worfy-link ticket 02; ADR-0052, point 6): link/settings.json
// in worfy's data folder. Today one switch, "Linked machines can work with my Projects", off for a
// fresh data folder and off when the file is missing or unreadable. This module only keeps and
// announces it; worfy-link ticket 08 applies it to the channels a Linked machine may call. The
// switch of worfy-link ticket 14 is meant to sit next to it in the same file.
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { z } from 'zod'
import { readJsonFile, writeJsonFile } from '../storage/json-file'

const settingsFileSchema = z.object({
  version: z.literal(1),
  projectsAccess: z.boolean(),
})

export interface LinkSettingsValue {
  /** "Linked machines can work with my Projects". */
  projectsAccess: boolean
}

export const DEFAULT_LINK_SETTINGS: Readonly<LinkSettingsValue> = Object.freeze({ projectsAccess: false })

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
    this.value = stored === undefined ? { ...DEFAULT_LINK_SETTINGS } : { projectsAccess: stored.projectsAccess }
  }

  get(): LinkSettingsValue {
    return { ...this.value }
  }

  /** Saves a change and announces it; nothing is written or announced when nothing changes. */
  set(change: Partial<LinkSettingsValue>): LinkSettingsValue {
    const next = { ...this.value, ...change }
    if (next.projectsAccess === this.value.projectsAccess) return this.get()
    writeJsonFile(this.file, settingsFileSchema, { version: 1, ...next })
    this.value = next
    this.emit('changed', this.get())
    return this.get()
  }
}

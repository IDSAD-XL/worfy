// The link settings of this Machine (worfy-link tickets 02, 14 and 18; ADR-0052, point 6; ADR-0066):
// link/settings.json in worfy's data folder.
// - "Linked machines can work with my Projects" (`projectsAccess`): off for a fresh data folder and
//   off when the file is missing or unreadable. Off turns access off for every Linked machine.
// - The access level of each Linked machine (`machines`, ticket 18): `read` or `all`; a Machine not
//   named there is `off`, and so is every newly linked one. It applies while `projectsAccess` is on.
//   worfy-link ticket 08 and ADR-0066 apply both to the channels a Linked machine may call.
// - "Keep this computer awake while linked machines are connected" (`keepAwake`, ticket 14): on by
//   default — the owner's decision is that a Project machine does not sleep while it is used —
//   and also on in a file written before it existed. keep-awake.ts applies it.
// - "Link through Tailscale" (`tailscale`, worfy-link ticket 27; ADR-0070, point 3): off for a fresh
//   data folder and off in a file written before it existed. The link server reads it on every
//   connection (checks.ts, isAllowedPeer); service.ts closes the connections from Tailscale addresses
//   when it goes off.
// This module only keeps and announces them.
//
// A file of version 1 (before ticket 18) had one switch for all Linked machines. It reads as the
// same access: on gives `all` to every Machine linked at that moment, off gives none; the file is
// written again as version 2 at once, so a Machine linked later never inherits the old switch.
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { z } from 'zod'
import { accessLevelSchema, type AccessLevel } from '../../shared/ipc/link'
import { readJsonFile, writeJsonFile } from '../storage/json-file'

const versionOne = z.object({
  version: z.literal(1),
  projectsAccess: z.boolean(),
  /** Absent in a file written before worfy-link ticket 14: the default then. */
  keepAwake: z.boolean().optional(),
})

const versionTwo = z.object({
  version: z.literal(2),
  projectsAccess: z.boolean(),
  machines: z.record(z.uuid(), accessLevelSchema),
  keepAwake: z.boolean(),
  /** Absent in a file written before worfy-link ticket 27: off then. */
  tailscale: z.boolean().optional(),
})

const settingsFileSchema = z.discriminatedUnion('version', [versionOne, versionTwo])

/** A level other than `off`: what `machines` keeps. */
export type GrantedLevel = Exclude<AccessLevel, 'off'>

export interface LinkSettingsValue {
  /** "Linked machines can work with my Projects": off is off for every Linked machine. */
  projectsAccess: boolean
  /** The level of each Linked machine that has one; any other Machine is `off`. */
  machines: Readonly<Record<string, GrantedLevel>>
  /** "Keep this computer awake while linked machines are connected". */
  keepAwake: boolean
  /** "Link through Tailscale": peers in the Tailscale ranges may connect on the Tailscale interface. */
  tailscale: boolean
}

export const DEFAULT_LINK_SETTINGS: Readonly<LinkSettingsValue> = Object.freeze({ projectsAccess: false, machines: Object.freeze({}), keepAwake: true, tailscale: false })

/** `machines` without the `off` entries, in a fresh object. */
function granted(machines: Readonly<Record<string, AccessLevel>>): Record<string, GrantedLevel> {
  const result: Record<string, GrantedLevel> = {}
  for (const [id, level] of Object.entries(machines)) if (level !== 'off') result[id] = level
  return result
}

function sameMachines(a: Readonly<Record<string, GrantedLevel>>, b: Readonly<Record<string, GrantedLevel>>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((id) => a[id] === b[id])
}

export interface LinkSettingsOptions {
  warn?: (message: string) => void
  /** The ids of the Machines linked now: a version 1 file with access on gives each of them `all`. */
  linked?: () => readonly string[]
}

export class LinkSettings extends EventEmitter<{ changed: [LinkSettingsValue] }> {
  private readonly file: string
  private value: LinkSettingsValue

  constructor(linkDir: string, options: LinkSettingsOptions = {}) {
    super()
    const warn = options.warn ?? ((message: string) => console.warn(message))
    this.file = join(linkDir, 'settings.json')
    let stored: z.output<typeof settingsFileSchema> | undefined
    try {
      stored = readJsonFile(this.file, settingsFileSchema)
    } catch (error) {
      // Access stays off when the file cannot be read: the safe side of the switch.
      warn(`[link] ${this.file} could not be read, access stays off: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (stored === undefined) {
      this.value = { ...DEFAULT_LINK_SETTINGS, machines: {} }
    } else if (stored.version === 2) {
      this.value = { projectsAccess: stored.projectsAccess, machines: granted(stored.machines), keepAwake: stored.keepAwake, tailscale: stored.tailscale ?? DEFAULT_LINK_SETTINGS.tailscale }
    } else {
      const machines: Record<string, GrantedLevel> = {}
      if (stored.projectsAccess) for (const id of options.linked?.() ?? []) machines[id] = 'all'
      this.value = { projectsAccess: stored.projectsAccess, machines, keepAwake: stored.keepAwake ?? DEFAULT_LINK_SETTINGS.keepAwake, tailscale: DEFAULT_LINK_SETTINGS.tailscale }
      try {
        this.write(this.value)
      } catch (error) {
        // Read again from version 1 next time; until then the Machines linked now keep what they had.
        warn(`[link] ${this.file} could not be written as version 2: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  get(): LinkSettingsValue {
    return { ...this.value, machines: { ...this.value.machines } }
  }

  /** The level Linked machine `id` has now: `off` while `projectsAccess` is off. */
  levelOf(id: string): AccessLevel {
    return this.value.projectsAccess ? (this.value.machines[id] ?? 'off') : 'off'
  }

  /**
   * Saves a change and announces it; nothing is written or announced when nothing changes.
   * `machines`, when given, replaces the whole list.
   */
  set(change: Partial<{ projectsAccess: boolean; machines: Readonly<Record<string, AccessLevel>>; keepAwake: boolean; tailscale: boolean }>): LinkSettingsValue {
    const next: LinkSettingsValue = {
      projectsAccess: change.projectsAccess ?? this.value.projectsAccess,
      machines: change.machines === undefined ? this.value.machines : granted(change.machines),
      keepAwake: change.keepAwake ?? this.value.keepAwake,
      tailscale: change.tailscale ?? this.value.tailscale,
    }
    if (
      next.projectsAccess === this.value.projectsAccess &&
      next.keepAwake === this.value.keepAwake &&
      next.tailscale === this.value.tailscale &&
      sameMachines(next.machines, this.value.machines)
    )
      return this.get()
    this.write(next)
    this.value = next
    this.emit('changed', this.get())
    return this.get()
  }

  /** Sets the level of Linked machine `id`; `off` removes it from the list. */
  setLevel(id: string, level: AccessLevel): LinkSettingsValue {
    return this.set({ machines: { ...this.value.machines, [id]: level } })
  }

  private write(value: LinkSettingsValue): void {
    writeJsonFile(this.file, settingsFileSchema, { version: 2, projectsAccess: value.projectsAccess, machines: { ...value.machines }, keepAwake: value.keepAwake, tailscale: value.tailscale })
  }
}

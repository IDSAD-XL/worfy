// The app settings of this Machine in app-settings.json of worfy's data folder (ADR-0005), read and
// written through src/main/storage/json-file.ts: no file or an unreadable one (set aside as
// `app-settings.json.unreadable-<time>`) gives the defaults, a field outside the schema is dropped,
// an `interfaceScale` or an autocompact window out of range is brought into it. A file of an older
// version that lacks a field takes the default for that field.
//
// One file for the Machine: every window shares it. The store announces `changed` with each new
// state; the IPC module (src/main/ipc/app-settings.ts) passes it on to every window, and the modules
// of main that act on a setting (the window's zoom) listen here too.
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { z } from 'zod'
import {
  appSettingsSchema,
  AUTO_COMPACT_WINDOW_DEFAULTS,
  clampAutoCompactWindow,
  clampScale,
  defaultAppSettings,
  INTERFACE_SCALE_DEFAULT,
  sectionIdSchema,
  type AppSettings,
  type AppSettingsPatch,
} from '../../shared/settings/app-settings'
import { readJsonFile, writeJsonFile, type ReadOptions } from '../storage/json-file'
import { dataRoot } from '../storage/paths'

export const APP_SETTINGS_FILE = 'app-settings.json'

/**
 * app-settings.json as it is read: lenient where the state schema is strict. A missing field takes
 * its default, a scale out of range is clamped. A field of the wrong type still makes the file
 * unreadable, so it is set aside rather than silently half-read.
 */
const appSettingsFileSchema = z.object({
  interfaceScale: z.number().transform(clampScale).default(INTERFACE_SCALE_DEFAULT),
  sidebar: z
    .object({
      collapsed: z.record(sectionIdSchema, z.boolean()).default(() => ({})),
      visible: z
        .object({ normal: z.boolean().default(true), focus: z.boolean().default(true) })
        .default(() => ({ normal: true, focus: true })),
    })
    .default(() => defaultAppSettings().sidebar),
  autoCompactWindow: z
    .object({
      orchestrator: z.number().nullable().transform(clampAutoCompactWindow).default(AUTO_COMPACT_WINDOW_DEFAULTS.orchestrator),
      other: z.number().nullable().transform(clampAutoCompactWindow).default(AUTO_COMPACT_WINDOW_DEFAULTS.other),
    })
    .default(() => ({ ...AUTO_COMPACT_WINDOW_DEFAULTS })),
  revision: z.number().int().nonnegative().default(0),
})

function copy(settings: AppSettings): AppSettings {
  return {
    interfaceScale: settings.interfaceScale,
    sidebar: { collapsed: { ...settings.sidebar.collapsed }, visible: { ...settings.sidebar.visible } },
    autoCompactWindow: { ...settings.autoCompactWindow },
    revision: settings.revision,
  }
}

/** A window of the patch brought into range; the current one when the patch leaves it out. */
function windowAfter(current: number | null, patched: number | null | undefined): number | null {
  return patched === undefined ? current : clampAutoCompactWindow(patched)
}

/** The settings after `patch`, with the revision unchanged. */
function merge(current: AppSettings, patch: AppSettingsPatch): AppSettings {
  return {
    interfaceScale: patch.interfaceScale === undefined ? current.interfaceScale : clampScale(patch.interfaceScale),
    sidebar: {
      collapsed: { ...current.sidebar.collapsed, ...patch.sidebar?.collapsed },
      visible: { ...current.sidebar.visible, ...patch.sidebar?.visible },
    },
    autoCompactWindow: {
      orchestrator: windowAfter(current.autoCompactWindow.orchestrator, patch.autoCompactWindow?.orchestrator),
      other: windowAfter(current.autoCompactWindow.other, patch.autoCompactWindow?.other),
    },
    revision: current.revision,
  }
}

function sameRecord(a: Readonly<Record<string, boolean>>, b: Readonly<Record<string, boolean>>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key])
}

function same(a: AppSettings, b: AppSettings): boolean {
  return (
    a.interfaceScale === b.interfaceScale &&
    a.sidebar.visible.normal === b.sidebar.visible.normal &&
    a.sidebar.visible.focus === b.sidebar.visible.focus &&
    a.autoCompactWindow.orchestrator === b.autoCompactWindow.orchestrator &&
    a.autoCompactWindow.other === b.autoCompactWindow.other &&
    sameRecord(a.sidebar.collapsed, b.sidebar.collapsed)
  )
}

export class AppSettingsStore extends EventEmitter<{ changed: [AppSettings] }> {
  private value: AppSettings | undefined

  /**
   * Over `file`, read on first use: creating the store does no I/O. `options.now` names the
   * set-aside copy of an unreadable file in tests.
   */
  constructor(
    private readonly file: string,
    private readonly options: ReadOptions = {},
  ) {
    super()
  }

  private current(): AppSettings {
    if (this.value !== undefined) return this.value
    let stored: z.output<typeof appSettingsFileSchema> | undefined
    try {
      stored = readJsonFile(this.file, appSettingsFileSchema, this.options)
    } catch (error) {
      // Not a parse problem (those are set aside above) but an I/O one, such as no permission: the
      // window still opens, with the defaults.
      console.warn(`worfy: ${this.file} could not be read, the app settings start from the defaults: ${error instanceof Error ? error.message : String(error)}`)
    }
    // Parsed once more with the state schema: what the store holds is exactly what the channels send.
    this.value = stored === undefined ? defaultAppSettings() : appSettingsSchema.parse(stored)
    return this.value
  }

  /** A copy of the settings. */
  get(): AppSettings {
    return copy(this.current())
  }

  /**
   * Applies a change in parts, writes the file, then announces `changed`; answers the new state.
   * A change that changes nothing writes and announces nothing and keeps the revision. When the
   * write throws, the settings stay as they were.
   */
  set(patch: AppSettingsPatch): AppSettings {
    const current = this.current()
    const merged = merge(current, patch)
    if (same(merged, current)) return this.get()
    const next: AppSettings = { ...merged, revision: current.revision + 1 }
    writeJsonFile(this.file, appSettingsSchema, next)
    this.value = next
    this.emit('changed', this.get())
    return this.get()
  }
}

let shared: AppSettingsStore | undefined

/** The store of the running app, over dataRoot(). Created on first use; creating it does no I/O. */
export function appSettingsStore(): AppSettingsStore {
  shared ??= new AppSettingsStore(join(dataRoot(), APP_SETTINGS_FILE))
  return shared
}

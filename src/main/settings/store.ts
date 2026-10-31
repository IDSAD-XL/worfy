// The app settings of this Machine in app-settings.json of worfy's data folder (ADR-0005), read and
// written through src/main/storage/json-file.ts: no file or an unreadable one (set aside as
// `app-settings.json.unreadable-<time>`) gives the defaults, a field outside the schema is dropped,
// an `interfaceScale` or an autocompact window out of range is brought into it. A file of an older
// version that lacks a field takes the default for that field. Which autocompact window the person
// chose is kept apart from worfy's default (`autoCompactWindowChosen`, worfy-polish ticket 29): a
// window named by a change is chosen, even at the default value; one not chosen stays at worfy's
// default, and the mark is written only while a window is chosen. `memoryIndicator` (worfy-ui
// ticket 20) is on in a file written before it existed. `sessionArchive` (worfy-canvas ticket 08)
// keeps only the fields a change named, so a choice outlives a later change of the defaults; an
// `after` this version does not know (written by a newer one) reads as not chosen. `browserSleep`
// (worfy-browser ticket 05) keeps only the fields a change named too; a value outside its bounds —
// a file edited by hand — reads as not chosen, and the rest of the file stays. `autopilotBudget`
// (worfy-throughput ticket 41) is kept the same way. `autoUpdate` ("Update automatically",
// worfy-update ticket 03) is on in a file written before it existed, as `memoryIndicator` is.
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
  AUTO_COMPACT_WINDOW_WORFY_DEFAULT,
  autoCompactWindowChosen,
  autoUpdateOf,
  clampAutoCompactWindow,
  clampScale,
  defaultAppSettings,
  INTERFACE_SCALE_DEFAULT,
  sectionIdSchema,
  sessionArchiveAfterSchema,
  browserSleepChoiceSchema,
  autopilotBudgetChoiceSchema,
  type AppSettings,
  type AutoCompactRole,
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
  autoCompactWindowChosen: z.object({ orchestrator: z.boolean().default(false), other: z.boolean().default(false) }).optional(),
  memoryIndicator: z.boolean().default(true),
  autoUpdate: z.boolean().default(true),
  sessionArchive: z.object({ after: sessionArchiveAfterSchema.optional().catch(undefined), ticketDone: z.boolean().optional() }).optional(),
  browserSleep: z
    .object({
      maxLive: browserSleepChoiceSchema.shape.maxLive.catch(undefined),
      offscreenSeconds: browserSleepChoiceSchema.shape.offscreenSeconds.catch(undefined),
      idleMinutes: browserSleepChoiceSchema.shape.idleMinutes.catch(undefined),
      zoom: browserSleepChoiceSchema.shape.zoom.catch(undefined),
    })
    .optional()
    .catch(undefined),
  autopilotBudget: z
    .object({
      enabled: autopilotBudgetChoiceSchema.shape.enabled.catch(undefined),
      reservePercent: autopilotBudgetChoiceSchema.shape.reservePercent.catch(undefined),
    })
    .optional()
    .catch(undefined),
  revision: z.number().int().nonnegative().default(0),
})

type ArchiveChoice = AppSettings['sessionArchive']

/** The archive choice after `patch`, with only its chosen fields, or nothing while none is chosen. */
function archiveChoice(current: ArchiveChoice, patch?: ArchiveChoice): Pick<AppSettings, 'sessionArchive'> {
  const after = patch?.after ?? current?.after
  const ticketDone = patch?.ticketDone ?? current?.ticketDone
  if (after === undefined && ticketDone === undefined) return {}
  return { sessionArchive: { ...(after === undefined ? {} : { after }), ...(ticketDone === undefined ? {} : { ticketDone }) } }
}

type SleepChoice = AppSettings['browserSleep']
const SLEEP_FIELDS = ['maxLive', 'offscreenSeconds', 'idleMinutes', 'zoom'] as const

/** The Browser sleep choice after `patch`, with only its chosen fields, or nothing while none is chosen. */
function sleepChoice(current: SleepChoice, patch?: SleepChoice): Pick<AppSettings, 'browserSleep'> {
  const chosen: NonNullable<SleepChoice> = {}
  for (const field of SLEEP_FIELDS) {
    const value = patch?.[field] ?? current?.[field]
    if (value !== undefined) chosen[field] = value
  }
  return Object.keys(chosen).length === 0 ? {} : { browserSleep: chosen }
}

type BudgetChoice = AppSettings['autopilotBudget']

/** The Autopilot budget choice after `patch`, with only its chosen fields, or nothing while none is chosen. */
function budgetChoice(current: BudgetChoice, patch?: BudgetChoice): Pick<AppSettings, 'autopilotBudget'> {
  const enabled = patch?.enabled ?? current?.enabled
  const reservePercent = patch?.reservePercent ?? current?.reservePercent
  if (enabled === undefined && reservePercent === undefined) return {}
  return { autopilotBudget: { ...(enabled === undefined ? {} : { enabled }), ...(reservePercent === undefined ? {} : { reservePercent }) } }
}

/** One window and whether the person chose it. */
interface RoleWindow {
  window: number | null
  chosen: boolean
}

/**
 * The two windows as the store holds them: one not chosen at worfy's default, the mark only while a
 * window is chosen. A file whose mark says "not chosen" for a window off the default — edited by
 * hand — keeps that window, as chosen.
 */
function windows(orchestrator: RoleWindow, other: RoleWindow): Pick<AppSettings, 'autoCompactWindow' | 'autoCompactWindowChosen'> {
  const windowOf = (role: AutoCompactRole, each: RoleWindow): number | null => (each.chosen ? each.window : AUTO_COMPACT_WINDOW_DEFAULTS[role])
  return {
    autoCompactWindow: { orchestrator: windowOf('orchestrator', orchestrator), other: windowOf('other', other) },
    ...(orchestrator.chosen || other.chosen ? { autoCompactWindowChosen: { orchestrator: orchestrator.chosen, other: other.chosen } } : {}),
  }
}

/** The window of `role` as `settings` hold it. */
function roleWindow(settings: Pick<AppSettings, 'autoCompactWindow' | 'autoCompactWindowChosen'>, role: AutoCompactRole): RoleWindow {
  return { window: settings.autoCompactWindow[role], chosen: autoCompactWindowChosen(settings, role) }
}

function copy(settings: AppSettings): AppSettings {
  return {
    interfaceScale: settings.interfaceScale,
    sidebar: { collapsed: { ...settings.sidebar.collapsed }, visible: { ...settings.sidebar.visible } },
    ...windows(roleWindow(settings, 'orchestrator'), roleWindow(settings, 'other')),
    memoryIndicator: settings.memoryIndicator,
    autoUpdate: autoUpdateOf(settings),
    ...archiveChoice(settings.sessionArchive),
    ...sleepChoice(settings.browserSleep),
    ...budgetChoice(settings.autopilotBudget),
    revision: settings.revision,
  }
}

/**
 * A window of the patch brought into range and chosen; worfy's default, not chosen, for
 * AUTO_COMPACT_WINDOW_WORFY_DEFAULT; the current one when the patch leaves it out.
 */
function windowAfter(current: AppSettings, role: AutoCompactRole, patched: number | null | typeof AUTO_COMPACT_WINDOW_WORFY_DEFAULT | undefined): RoleWindow {
  if (patched === undefined) return roleWindow(current, role)
  if (patched === AUTO_COMPACT_WINDOW_WORFY_DEFAULT) return { window: AUTO_COMPACT_WINDOW_DEFAULTS[role], chosen: false }
  return { window: clampAutoCompactWindow(patched), chosen: true }
}

/** The settings after `patch`, with the revision unchanged. */
function merge(current: AppSettings, patch: AppSettingsPatch): AppSettings {
  return {
    interfaceScale: patch.interfaceScale === undefined ? current.interfaceScale : clampScale(patch.interfaceScale),
    sidebar: {
      collapsed: { ...current.sidebar.collapsed, ...patch.sidebar?.collapsed },
      visible: { ...current.sidebar.visible, ...patch.sidebar?.visible },
    },
    ...windows(windowAfter(current, 'orchestrator', patch.autoCompactWindow?.orchestrator), windowAfter(current, 'other', patch.autoCompactWindow?.other)),
    memoryIndicator: patch.memoryIndicator ?? current.memoryIndicator,
    autoUpdate: patch.autoUpdate ?? autoUpdateOf(current),
    ...archiveChoice(current.sessionArchive, patch.sessionArchive),
    ...sleepChoice(current.browserSleep, patch.browserSleep),
    ...budgetChoice(current.autopilotBudget, patch.autopilotBudget),
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
    a.memoryIndicator === b.memoryIndicator &&
    a.autoUpdate === b.autoUpdate &&
    a.sessionArchive?.after === b.sessionArchive?.after &&
    a.sessionArchive?.ticketDone === b.sessionArchive?.ticketDone &&
    SLEEP_FIELDS.every((field) => a.browserSleep?.[field] === b.browserSleep?.[field]) &&
    a.autopilotBudget?.enabled === b.autopilotBudget?.enabled &&
    a.autopilotBudget?.reservePercent === b.autopilotBudget?.reservePercent &&
    a.autoCompactWindow.orchestrator === b.autoCompactWindow.orchestrator &&
    a.autoCompactWindow.other === b.autoCompactWindow.other &&
    autoCompactWindowChosen(a, 'orchestrator') === autoCompactWindowChosen(b, 'orchestrator') &&
    autoCompactWindowChosen(a, 'other') === autoCompactWindowChosen(b, 'other') &&
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
    // copy() brings the windows to the form a write leaves them in, so a file written before the mark
    // existed reads as the same state it is next written as.
    this.value = stored === undefined ? defaultAppSettings() : copy(appSettingsSchema.parse(stored))
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

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
// (worfy-throughput ticket 41) is kept the same way, and so is `autopilotRun` (the default Run mode and
// the Start window, worfy-resource-planner ticket 04); a window whose edges meet in the file reads as
// not chosen, and a change that would make them meet is refused. `autoUpdate` ("Update automatically",
// worfy-update ticket 03) is on in a file written before it existed, as `memoryIndicator` is.
// `guideLanguage` (worfy-guide ticket 03) is absent until the person picks EN or RU in the Guide; a
// language this version does not know reads as not chosen. `autoApproval` (worfy-auto-approve ticket
// 06) holds the Auto-approval mode of each Project that is not Off; an entry with a mode outside Off /
// Shadow / On or a key that is no Project id is dropped (reads as Off), and so is the whole field when
// it is not a record. Only setAutoApproval() writes it — the `autoApproval` IPC domain, the switch of
// the Orchestrator: `project` channels, its write `write`, so a Linked machine with full access sets it
// and one with read-only access only reads it (worfy-retry ticket 13) — never set(): the patch has no
// such field. `autoContinue` (worfy-retry
// ticket 02) holds the Projects with Auto-continue on, kept the same way: an entry that is not a Project
// id with `true` is dropped (reads as off); only setAutoContinue() writes it, through the `autoContinue`
// IPC domain. `productSession` (worfy-product-session ticket 07) holds the share of the Product Session
// divider the person chose; absent until the first drag, and a share outside 0.1–0.9 or of the wrong
// type in the file reads as not chosen (60 / 40), the rest of the file stays. Its `liveSummary`
// (ticket 32) is the switch of the live summary in Settings → Sessions; absent or not a boolean reads as on.
// `prInboxNotify` and `prInboxDigest` (worfy-pr-inbox ticket 07) are the switches of Settings → Pull requests, kept
// only once chosen; absent or not a boolean reads as on.
//
// The file is read once, on first use; the store then answers from memory and every write puts the
// whole state back. An edit of the file made outside worfy (by hand, or by an agent's shell command)
// is therefore not seen until worfy starts again, and the next write of the running app replaces it
// (spec of worfy-auto-approve, "security", item 5).
//
// One file for the Machine: every window shares it. The store announces `changed` with each new
// state; the IPC module (src/main/ipc/app-settings.ts) passes it on to every window, and the modules
// of main that act on a setting (the window's zoom) listen here too.
import { EventEmitter } from 'node:events'
import { url as inspectorUrl } from 'node:inspector'
import { app } from 'electron'
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
  autopilotRunChoiceSchema,
  guideLanguageSchema,
  productSessionSplitSchema,
  START_WINDOW_SAME_HOURS,
  startWindowValid,
  type GuideLanguage,
  type AppSettings,
  type AutoCompactRole,
  type AppSettingsPatch,
  autoApprovalModeSchema,
  autoApprovalOf,
  autoApprovalProjectIdSchema,
  type AutoApprovalMode,
  autoContinueOf,
} from '../../shared/settings/app-settings'
import { readJsonFile, writeJsonFile, type ReadOptions } from '../storage/json-file'
import { dataRoot } from '../storage/paths'

export const APP_SETTINGS_FILE = 'app-settings.json'

/**
 * The Auto-approval modes worth keeping from `entries`: a Project id with Shadow or On; Off is no
 * entry. A key that is no Project id — `__proto__` among them — is dropped. Nothing left: undefined.
 */
function modesOf(entries: Readonly<Record<string, unknown>>): Record<string, Exclude<AutoApprovalMode, 'off'>> | undefined {
  const kept: Record<string, Exclude<AutoApprovalMode, 'off'>> = {}
  for (const [projectId, mode] of Object.entries(entries)) {
    if (!autoApprovalProjectIdSchema.safeParse(projectId).success) continue
    if (mode === 'shadow' || mode === 'on') kept[projectId] = mode
  }
  return Object.keys(kept).length === 0 ? undefined : kept
}

/** The modes field of a state: present only while a Project is not Off. */
function modesChoice(modes: AppSettings['autoApproval']): Pick<AppSettings, 'autoApproval'> {
  const kept = modes === undefined ? undefined : modesOf(modes)
  return kept === undefined ? {} : { autoApproval: kept }
}

/**
 * The Projects with Auto-continue on, kept from `entries`: a Project id with `true`. A key that is no
 * Project id — `__proto__` among them — is dropped. Nothing left: undefined.
 */
function continuesOf(entries: Readonly<Record<string, unknown>>): Record<string, true> | undefined {
  const kept: Record<string, true> = {}
  for (const [projectId, on] of Object.entries(entries)) {
    if (on === true && autoApprovalProjectIdSchema.safeParse(projectId).success) kept[projectId] = true
  }
  return Object.keys(kept).length === 0 ? undefined : kept
}

/** The Auto-continue field of a state: present only while it is on for a Project. */
function continuesChoice(on: AppSettings['autoContinue']): Pick<AppSettings, 'autoContinue'> {
  const kept = on === undefined ? undefined : continuesOf(on)
  return kept === undefined ? {} : { autoContinue: kept }
}

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
  autopilotRun: z
    .object({
      mode: autopilotRunChoiceSchema.shape.mode.catch(undefined),
      windowFrom: autopilotRunChoiceSchema.shape.windowFrom.catch(undefined),
      windowTo: autopilotRunChoiceSchema.shape.windowTo.catch(undefined),
    })
    // Edges that meet — the file edited by hand — read as no window chosen; the mode stays.
    .transform(({ mode, windowFrom, windowTo }) => (startWindowValid({ windowFrom, windowTo }) ? { mode, windowFrom, windowTo } : { mode }))
    .optional()
    .catch(undefined),
  guideLanguage: guideLanguageSchema.optional().catch(undefined),
  // Each entry on its own: one that is not a Project id with Shadow or On is dropped, so it reads as Off.
  autoApproval: z
    .record(z.string(), z.unknown())
    .transform(modesOf)
    .optional()
    .catch(undefined),
  // The same way: an entry that is not a Project id with `true` is dropped, so it reads as off.
  autoContinue: z
    .record(z.string(), z.unknown())
    .transform(continuesOf)
    .optional()
    .catch(undefined),
  productSession: z
    .object({ split: productSessionSplitSchema.optional().catch(undefined), liveSummary: z.boolean().optional().catch(undefined) })
    .optional()
    .catch(undefined),
  prInboxNotify: z.boolean().optional().catch(undefined),
  prInboxDigest: z.boolean().optional().catch(undefined),
  revision: z.number().int().nonnegative().default(0),
})

/** The PR inbox switches after `patch`: each one chosen, the others absent (on). */
function prInboxChoice(current: Pick<AppSettings, 'prInboxNotify' | 'prInboxDigest'>, patch: Pick<AppSettings, 'prInboxNotify' | 'prInboxDigest'> = {}): Pick<AppSettings, 'prInboxNotify' | 'prInboxDigest'> {
  const notify = patch.prInboxNotify ?? current.prInboxNotify
  const digest = patch.prInboxDigest ?? current.prInboxDigest
  return { ...(notify === undefined ? {} : { prInboxNotify: notify }), ...(digest === undefined ? {} : { prInboxDigest: digest }) }
}

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

type RunChoice = AppSettings['autopilotRun']

/** The Run choice after `patch`, with only its chosen fields, or nothing while none is chosen. */
function runChoice(current: RunChoice, patch?: RunChoice): Pick<AppSettings, 'autopilotRun'> {
  const mode = patch?.mode ?? current?.mode
  const windowFrom = patch?.windowFrom ?? current?.windowFrom
  const windowTo = patch?.windowTo ?? current?.windowTo
  if (mode === undefined && windowFrom === undefined && windowTo === undefined) return {}
  return {
    autopilotRun: {
      ...(mode === undefined ? {} : { mode }),
      ...(windowFrom === undefined ? {} : { windowFrom }),
      ...(windowTo === undefined ? {} : { windowTo }),
    },
  }
}

/** The language of the Guide after `patch`: once chosen, it stays chosen. */
function guideLanguageAfter(current: GuideLanguage | undefined, patched: GuideLanguage | undefined): Pick<AppSettings, 'guideLanguage'> {
  const language = patched ?? current
  return language === undefined ? {} : { guideLanguage: language }
}

/** The Product Session choice after `patch`, or nothing while neither a share nor the live summary is chosen. */
function productSessionChoice(current: AppSettings['productSession'], patch?: AppSettings['productSession']): Pick<AppSettings, 'productSession'> {
  const split = patch?.split ?? current?.split
  const liveSummary = patch?.liveSummary ?? current?.liveSummary
  if (split === undefined && liveSummary === undefined) return {}
  return { productSession: { ...(split === undefined ? {} : { split }), ...(liveSummary === undefined ? {} : { liveSummary }) } }
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
    ...runChoice(settings.autopilotRun),
    ...(settings.guideLanguage === undefined ? {} : { guideLanguage: settings.guideLanguage }),
    ...productSessionChoice(settings.productSession),
    ...prInboxChoice(settings),
    ...modesChoice(settings.autoApproval),
    ...continuesChoice(settings.autoContinue),
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
    ...runChoice(current.autopilotRun, patch.autopilotRun),
    ...guideLanguageAfter(current.guideLanguage, patch.guideLanguage),
    ...productSessionChoice(current.productSession, patch.productSession),
    ...prInboxChoice(current, patch),
    // Never from the patch: setAutoApproval() is the one way to change a mode.
    ...modesChoice(current.autoApproval),
    // Nor Auto-continue: setAutoContinue() is the one way to change it.
    ...continuesChoice(current.autoContinue),
    revision: current.revision,
  }
}

function sameRecord(a: Readonly<Record<string, boolean>>, b: Readonly<Record<string, boolean>>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key])
}

function sameModes(a: AppSettings['autoApproval'], b: AppSettings['autoApproval']): boolean {
  const keys = Object.keys(a ?? {})
  return keys.length === Object.keys(b ?? {}).length && keys.every((key) => autoApprovalOf({ autoApproval: a }, key) === autoApprovalOf({ autoApproval: b }, key))
}

function sameContinues(a: AppSettings['autoContinue'], b: AppSettings['autoContinue']): boolean {
  const keys = Object.keys(a ?? {})
  return keys.length === Object.keys(b ?? {}).length && keys.every((key) => autoContinueOf({ autoContinue: b }, key))
}

function same(a: AppSettings, b: AppSettings): boolean {
  return (
    sameModes(a.autoApproval, b.autoApproval) &&
    sameContinues(a.autoContinue, b.autoContinue) &&
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
    a.autopilotRun?.mode === b.autopilotRun?.mode &&
    a.autopilotRun?.windowFrom === b.autopilotRun?.windowFrom &&
    a.autopilotRun?.windowTo === b.autopilotRun?.windowTo &&
    a.guideLanguage === b.guideLanguage &&
    a.productSession?.split === b.productSession?.split &&
    a.productSession?.liveSummary === b.productSession?.liveSummary &&
    a.prInboxNotify === b.prInboxNotify &&
    a.prInboxDigest === b.prInboxDigest &&
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
   * write throws, the settings stay as they were. A change that leaves the Start window starting and
   * ending at the same hour throws and changes nothing.
   */
  set(patch: AppSettingsPatch): AppSettings {
    const current = this.current()
    const merged = merge(current, patch)
    if (!startWindowValid(merged.autopilotRun)) throw new Error(START_WINDOW_SAME_HOURS)
    return this.write(current, merged)
  }

  /** The Auto-approval mode of Project `projectId`, as the store holds it: Off without an entry. */
  autoApproval(projectId: string): AutoApprovalMode {
    return autoApprovalOf(this.current(), projectId)
  }

  /**
   * Sets the Auto-approval mode of Project `projectId` and leaves everything else as it is: the
   * other Projects' modes and every other setting. Off removes the entry. Writes and announces as
   * set() does; a mode already in force writes nothing. A mode outside the three or an id that is
   * no Project id throws and changes nothing.
   */
  setAutoApproval(projectId: string, mode: AutoApprovalMode): AppSettings {
    const id = autoApprovalProjectIdSchema.parse(projectId)
    const chosen = autoApprovalModeSchema.parse(mode)
    const current = this.current()
    const others = Object.entries(current.autoApproval ?? {}).filter(([key]) => key !== id)
    const modes = Object.fromEntries(chosen === 'off' ? others : [...others, [id, chosen]])
    return this.write(current, { ...copy(current), autoApproval: modes })
  }

  /** Whether Auto-continue is on for Project `projectId`, as the store holds it: off without an entry. */
  autoContinue(projectId: string): boolean {
    return autoContinueOf(this.current(), projectId)
  }

  /**
   * Turns Auto-continue of Project `projectId` on or off and leaves everything else as it is: the other
   * Projects and every other setting. Off removes the entry. Writes and announces as set() does; a
   * value already in force writes nothing. An id that is no Project id, or a value that is no boolean,
   * throws and changes nothing.
   */
  setAutoContinue(projectId: string, on: boolean): AppSettings {
    const id = autoApprovalProjectIdSchema.parse(projectId)
    const chosen = z.boolean().parse(on)
    const current = this.current()
    const others = Object.entries(current.autoContinue ?? {}).filter(([key]) => key !== id)
    const entries: Record<string, true> = Object.fromEntries(chosen ? [...others, [id, true]] : others)
    return this.write(current, { ...copy(current), autoContinue: entries })
  }

  /** Writes `merged` over `current` unless it changes nothing; answers the state after it. */
  private write(current: AppSettings, merged: AppSettings): AppSettings {
    const tidy = copy(merged)
    if (same(tidy, current)) return this.get()
    const next: AppSettings = { ...tidy, revision: current.revision + 1 }
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

/** A Chromium switch that opens the DevTools protocol to other processes: `-`, `--` or `/` before it, any case. */
const DEBUGGING_SWITCH = /^(?:--?|\/)remote-debugging-(port|pipe)(?:=|$)/iu
/** A Node flag that opens the inspector of main. */
const INSPECT_FLAG = /^--inspect(?:-brk)?(?:=|$)/u

/**
 * Why Auto-approval cannot be trusted in this run of worfy, or null. With a debugging port (or pipe)
 * open, any process of this Machine — an agent's shell command in an unattended Run among them — can
 * run script in worfy's window and call its IPC as the window does, the switch's `autoApproval.set`
 * included; with the Node inspector of main open, it can run code in main itself. `argv` is the
 * command line of main, `inspector` the address of its inspector (undefined while closed): the
 * inspector can also be opened after start. `hasSwitch` asks Chromium's own command line: code that
 * runs before worfy's (a loader given with `-r`, as Playwright's) can take a switch out of
 * process.argv, not out of Chromium's.
 */
export function debugAccessOf(argv: readonly string[], inspector: string | undefined, hasSwitch: (name: string) => boolean = () => false): string | null {
  const switched = (['port', 'pipe'] as const).find((kind) => hasSwitch(`remote-debugging-${kind}`))
  const debugging = switched ?? argv.map((arg) => DEBUGGING_SWITCH.exec(arg)?.[1]?.toLowerCase()).find((kind) => kind !== undefined)
  if (debugging !== undefined) return `worfy runs with a debugging ${debugging} open (--remote-debugging-${debugging})`
  if (inspector !== undefined || argv.some((arg) => INSPECT_FLAG.test(arg))) return 'worfy runs with the Node inspector open (--inspect)'
  return null
}

/** debugAccessOf() of this run of worfy: its command line, Chromium's switches and its inspector now. */
export function debugAccess(): string | null {
  return debugAccessOf(process.argv, inspectorUrl(), (name) => app.commandLine.hasSwitch(name))
}

/**
 * The Auto-approval mode in force for Project `projectId` on this Machine, for the driver of an
 * unattended Run (worfy-auto-approve ticket 04): what the switch of the Orchestrator last wrote, Off
 * without an entry — and Off whatever was written while debugAccess() names a reason. Read from the
 * store's memory, not from the file (see the head of this file).
 */
export function autoApprovalMode(projectId: string, debug: () => string | null = debugAccess): AutoApprovalMode {
  return debug() === null ? appSettingsStore().autoApproval(projectId) : 'off'
}

/**
 * Whether Auto-continue is on for Project `projectId` on this Machine, for the retry of the Orchestrator's
 * turn (worfy-retry tickets 04–06): what the Auto-continue item of the Modes menu last wrote, off without an
 * entry. Read from the store's memory, not from the file (see the head of this file).
 */
export function autoContinueOn(projectId: string): boolean {
  return appSettingsStore().autoContinue(projectId)
}

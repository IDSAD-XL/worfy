// The app settings of one Machine: what the window looks like on this machine's screens, kept in
// app-settings.json in worfy's data folder (src/main/settings/store.ts; ADR-0005) and shared by every
// window of the Machine through the `appSettings` IPC domain (src/shared/ipc/app-settings.ts).
// The schema holds every field the interface settings need at once, so the features that use them
// add no field here:
// - `interfaceScale` — the zoom of the whole window, 0.8–1.5 by steps of 0.1;
// - `sidebar.collapsed` — which sidebar sections are collapsed, by section id (the section's file
//   name without the extension, as ShellExtension.id in src/renderer/shell/registry.ts); a section
//   with no key keeps its own default;
// - `sidebar.visible` — whether the sidebar is shown, apart for the normal view and the focus mode;
// - `autoCompactWindow` — the autocompact window of a Session in tokens (worfy-polish ticket 24):
//   `orchestrator` for a Project's Orchestrator, Autopilot's included, and its Subagents;
//   `other` for every other Session of worfy. null — "Claude Code default": worfy passes nothing,
//   the user's settings.json and Claude Code decide. Main reads it at every start of a Session's
//   Claude Code (src/main/agent/app-registry.ts); a running process keeps the window it started with;
// - `autoCompactWindowChosen` — which of the two windows the person chose in Settings (worfy-polish
//   ticket 29). A window not chosen is worfy's default and gives way to `autoCompactWindow` of the
//   user's ~/.claude/settings.json (autoCompactWindowSource). A window off worfy's default counts as
//   chosen with or without the mark, so a file written before the mark existed keeps its choices; the
//   mark is what tells "Custom" at the default value from the default itself. Absent while neither is
//   chosen;
// - `memoryIndicator` — whether the toolbar shows how much memory worfy's own processes use
//   (worfy-ui ticket 20); on by default. Main samples the memory only while it is on
//   (src/main/diagnostics/memory.ts);
// - `sessionArchive` — the automatic archive of finished Sessions (worfy-canvas ticket 08,
//   ADR-0076, point 7): `after` — how long a finished Session stays on the Canvas, «Never» turning
//   the timer off; `ticketDone` — also archive a finished Session of a done Ticket. The field holds
//   only what the person chose in Settings → Canvas; sessionArchiveOf() fills the rest with
//   SESSION_ARCHIVE_DEFAULTS, so a choice outlives a later change of the defaults. Main reads it at
//   every run of the archive (src/main/layout/archive.ts);
// - `browserSleep` — when a Live Browser goes to sleep (worfy-browser ticket 05, ADR-0078 items 6
//   and 7): `maxLive` — how many Browsers of this Machine are Live at once; `offscreenSeconds` — how
//   long a Browser no screen shows at a readable zoom stays Live; `idleMinutes` — how long one
//   without the focus and without a Session's call stays Live; `zoom` — the zoom of the Canvas below
//   which a page counts as unreadable. Like `sessionArchive`, it holds only what the person chose in
//   Settings → Browser; browserSleepOf() fills the rest with BROWSER_SLEEP_DEFAULTS. Main reads it at
//   every check of the sleep rules (src/main/browser/live.ts);
// - `autopilotBudget` — the budget of the Limits for Autopilot (worfy-throughput ticket 41,
//   src/shared/autopilot/budget.ts): `enabled` — whether a run starts no Wave once today's share of
//   the week is used; `reservePercent` — the share of the week kept for the person's own work. Like
//   `sessionArchive`, it holds only what the person chose in Settings → Autopilot (off by default);
//   autopilotBudgetOf() fills the rest with AUTOPILOT_BUDGET_DEFAULTS. Main reads it before every
//   Wave of a run (src/main/ipc/autopilot.ts);
// - `autopilotRun` — the default Run mode and the Start window (worfy-resource-planner ticket 04,
//   src/shared/autopilot/run-mode.ts): `mode` — Fastest, Budget-aware or Start window; `windowFrom`
//   and `windowTo` — the whole local hours the window starts and ends at, never the same. Like
//   `autopilotBudget`, it holds only what the person chose in Settings → Autopilot; autopilotRunOf()
//   fills the rest: the window 23:00–07:00, and while no mode is chosen, Budget-aware with the budget
//   on and Fastest with it off, so a Run goes as it did before the modes;
// - `guideLanguage` — the language the worfy Guide is read in, EN or RU (worfy-guide ticket 03,
//   ADR-0090): set by the switch in the Guide's header; absent while the person has not chosen, and
//   the Guide follows the system language (src/renderer/guide/language.ts). The rest of the window
//   stays English;
// - `revision` — grows with every write, so a renderer keeps the newest of the states it hears.
import { z } from 'zod'
import { DEFAULT_START_WINDOW, RUN_MODES, type RunMode, type StartWindow } from '../autopilot/run-mode'

/** The languages of the worfy Guide (ADR-0090): English, the main one, and Russian. */
export const GUIDE_LANGUAGES = ['en', 'ru'] as const
export const guideLanguageSchema = z.enum(GUIDE_LANGUAGES)
export type GuideLanguage = z.output<typeof guideLanguageSchema>

export const INTERFACE_SCALE_MIN = 0.8
export const INTERFACE_SCALE_MAX = 1.5
/** The step of the scale: a tenth (clampScale counts in tenths). */
export const INTERFACE_SCALE_STEP = 0.1
export const INTERFACE_SCALE_DEFAULT = 1

/**
 * Brings a scale into INTERFACE_SCALE_MIN–INTERFACE_SCALE_MAX, rounded to the nearest step:
 * 3 → 1.5, 0.83 → 0.8, 1.25 → 1.3. A value that is not a number becomes the default.
 */
export function clampScale(value: number): number {
  if (Number.isNaN(value)) return INTERFACE_SCALE_DEFAULT
  const bounded = Math.min(INTERFACE_SCALE_MAX, Math.max(INTERFACE_SCALE_MIN, value))
  // Counted in whole tenths, so the result carries no binary tail (0.7 + 0.2 is 0.8999999999999999).
  // Multiplied rather than divided by the step: 1.15 / 0.1 is 11.499999999999998, 1.15 * 10 is 11.5.
  return Math.round(bounded * 10) / 10
}

/** The bounds of the autocompact window Claude Code takes (Settings.autoCompactWindow of the SDK), in tokens. */
export const AUTO_COMPACT_WINDOW_MIN = 100_000
export const AUTO_COMPACT_WINDOW_MAX = 1_000_000
/** The step of the window in Settings: 10K. */
export const AUTO_COMPACT_WINDOW_STEP = 10_000
/**
 * The windows of a Machine that never changed them (decision of the owner, 2026-10-15): 400K for
 * the Orchestrator, which suits both it and the implementers that inherit it; 500K for the others.
 */
export const AUTO_COMPACT_WINDOW_DEFAULTS: Readonly<{ orchestrator: number; other: number }> = Object.freeze({ orchestrator: 400_000, other: 500_000 })

/**
 * Brings a window into AUTO_COMPACT_WINDOW_MIN–AUTO_COMPACT_WINDOW_MAX, rounded to the nearest
 * step: 95 000 → 100 000, 404 999 → 400 000, 2 000 000 → 1 000 000. null stays null ("Claude Code
 * default"); a value that is not a finite number becomes null too.
 */
export function clampAutoCompactWindow(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  const bounded = Math.min(AUTO_COMPACT_WINDOW_MAX, Math.max(AUTO_COMPACT_WINDOW_MIN, value))
  return Math.round(bounded / AUTO_COMPACT_WINDOW_STEP) * AUTO_COMPACT_WINDOW_STEP
}

/** Which window: a Project's Orchestrator, or any other Session. */
export type AutoCompactRole = 'orchestrator' | 'other'

/** In a change, takes a window back to worfy's default, not chosen: settings.json wins over it again. */
export const AUTO_COMPACT_WINDOW_WORFY_DEFAULT = 'worfy-default'

/** A window in tokens within the bounds and on a step, or null for "Claude Code default". */
export const autoCompactWindowSchema = z
  .number()
  .int()
  .min(AUTO_COMPACT_WINDOW_MIN)
  .max(AUTO_COMPACT_WINDOW_MAX)
  .multipleOf(AUTO_COMPACT_WINDOW_STEP)
  .nullable()

/**
 * A sidebar section id: a file name without the extension (`MachinesSection`). The pattern also
 * keeps keys such as `__proto__` out of the record a change is merged into.
 */
export const sectionIdSchema = z.string().regex(/^[A-Za-z0-9][\w-]{0,99}$/, 'a section id is a file name without the extension')

export const sidebarVisibilitySchema = z.object({
  /** The sidebar in the normal view. */
  normal: z.boolean(),
  /** The sidebar in the focus mode. */
  focus: z.boolean(),
})

/** How long a finished Session stays on the Canvas before the automatic archive takes it; `never` — the timer is off. */
export const SESSION_ARCHIVE_AFTER = ['never', '6h', '24h', '3d', '7d'] as const
export const sessionArchiveAfterSchema = z.enum(SESSION_ARCHIVE_AFTER)
export type SessionArchiveAfter = z.output<typeof sessionArchiveAfterSchema>

/** What the person chose in Settings → Canvas: each field only once chosen. */
export const sessionArchiveChoiceSchema = z.object({ after: sessionArchiveAfterSchema.optional(), ticketDone: z.boolean().optional() })
export type SessionArchiveChoice = z.output<typeof sessionArchiveChoiceSchema>

/** The archive settings in force: the person's choice, else the default. */
export type SessionArchive = { [K in keyof SessionArchiveChoice]-?: NonNullable<SessionArchiveChoice[K]> }

/**
 * The archive of a Machine whose person chose nothing: 24 h, and a done Ticket's Sessions too
 * (ADR-0076, points 7 and 10). It was «Never» until the toast with Undo came (worfy-canvas ticket
 * 10); a person who chose «Never» then keeps it.
 */
export const SESSION_ARCHIVE_DEFAULTS: Readonly<SessionArchive> = Object.freeze({ after: '24h', ticketDone: true })

/** The bounds of each Browser sleep setting; a value outside them is refused in a change and read as not chosen from the file. */
export const BROWSER_SLEEP_BOUNDS = Object.freeze({
  maxLive: Object.freeze({ min: 1, max: 10 }),
  offscreenSeconds: Object.freeze({ min: 1, max: 3600 }),
  idleMinutes: Object.freeze({ min: 1, max: 240 }),
  zoom: Object.freeze({ min: 0.1, max: 1 }),
})

/** What the person chose in Settings → Browser: each field only once chosen. */
export const browserSleepChoiceSchema = z.object({
  maxLive: z.number().int().min(BROWSER_SLEEP_BOUNDS.maxLive.min).max(BROWSER_SLEEP_BOUNDS.maxLive.max).optional(),
  offscreenSeconds: z.number().int().min(BROWSER_SLEEP_BOUNDS.offscreenSeconds.min).max(BROWSER_SLEEP_BOUNDS.offscreenSeconds.max).optional(),
  idleMinutes: z.number().int().min(BROWSER_SLEEP_BOUNDS.idleMinutes.min).max(BROWSER_SLEEP_BOUNDS.idleMinutes.max).optional(),
  zoom: z.number().min(BROWSER_SLEEP_BOUNDS.zoom.min).max(BROWSER_SLEEP_BOUNDS.zoom.max).optional(),
})
export type BrowserSleepChoice = z.output<typeof browserSleepChoiceSchema>

/** The sleep settings in force: the person's choice, else the default. */
export type BrowserSleep = { [K in keyof BrowserSleepChoice]-?: NonNullable<BrowserSleepChoice[K]> }

/**
 * The sleep of a Machine whose person chose nothing (ADR-0078 items 6 and 7): 3 Live Browsers, 30 s
 * off every screen, 5 min without the focus and without a Session's call, and zoom 0.4 — the zoom
 * from which a Card shows its live page (LIVE_ZOOM_MIN, src/renderer/canvas/nodes/CardNode.tsx; the
 * owner's answer of 2026-10-21 to question 1 of worfy-browser ticket 05).
 */
export const BROWSER_SLEEP_DEFAULTS: Readonly<BrowserSleep> = Object.freeze({ maxLive: 3, offscreenSeconds: 30, idleMinutes: 5, zoom: 0.4 })

/** The bounds of the reserve of the week, in percent. */
export const AUTOPILOT_RESERVE_BOUNDS = Object.freeze({ min: 0, max: 50 })

/** What the person chose in Settings → Autopilot: each field only once chosen. */
export const autopilotBudgetChoiceSchema = z.object({
  enabled: z.boolean().optional(),
  reservePercent: z.number().int().min(AUTOPILOT_RESERVE_BOUNDS.min).max(AUTOPILOT_RESERVE_BOUNDS.max).optional(),
})
export type AutopilotBudgetChoice = z.output<typeof autopilotBudgetChoiceSchema>

/** The budget settings in force: the person's choice, else the default. */
export type AutopilotBudgetSettings = { [K in keyof AutopilotBudgetChoice]-?: NonNullable<AutopilotBudgetChoice[K]> }

/**
 * The budget of a Machine whose person chose nothing: off, with 15 % of the week to keep for work by
 * hand once turned on (the owner's answer of 2026-10-28 to Q-L5 of the worfy-throughput spec gives
 * the 15 %; it does not ask for the budget on by default, and the owner's rule is the full mode by
 * default, the saving one by choice).
 */
export const AUTOPILOT_BUDGET_DEFAULTS: Readonly<AutopilotBudgetSettings> = Object.freeze({ enabled: false, reservePercent: 15 })

/** An edge of the Start window: a whole local hour, 0–23. */
export const startWindowHourSchema = z.number().int().min(0).max(23)

/** What the person chose in Settings → Autopilot for the Run: each field only once chosen. */
export const autopilotRunChoiceSchema = z.object({
  mode: z.enum(RUN_MODES).optional(),
  windowFrom: startWindowHourSchema.optional(),
  windowTo: startWindowHourSchema.optional(),
})
export type AutopilotRunChoice = z.output<typeof autopilotRunChoiceSchema>

/** Why a Start window is refused: it would start and end at the same hour. */
export const START_WINDOW_SAME_HOURS = 'the Start window cannot start and end at the same hour'

/** The Start window a choice gives: each edge chosen, else its default. */
export function startWindowOf(choice: AutopilotRunChoice | undefined): StartWindow {
  return { from: choice?.windowFrom ?? DEFAULT_START_WINDOW.from, to: choice?.windowTo ?? DEFAULT_START_WINDOW.to }
}

/** Whether the window a choice gives has two different edges. */
export function startWindowValid(choice: AutopilotRunChoice | undefined): boolean {
  const window = startWindowOf(choice)
  return window.from !== window.to
}

/** The Run settings in force: the default mode and the Start window. */
export interface AutopilotRunSettings {
  mode: RunMode
  window: StartWindow
}

export const appSettingsSchema = z.object({
  interfaceScale: z.number().min(INTERFACE_SCALE_MIN).max(INTERFACE_SCALE_MAX),
  sidebar: z.object({
    /** Collapsed (true) or expanded (false), by section id; no key — the section's own default. */
    collapsed: z.record(sectionIdSchema, z.boolean()),
    visible: sidebarVisibilitySchema,
  }),
  autoCompactWindow: z.object({
    /** A Project's Orchestrator, attended or under Autopilot; its Subagents inherit the window. */
    orchestrator: autoCompactWindowSchema,
    /** Every other Session of worfy: those opened on the Canvas. */
    other: autoCompactWindowSchema,
  }),
  /** Which window the person chose; absent while neither is (see autoCompactWindowChosen). */
  autoCompactWindowChosen: z.object({ orchestrator: z.boolean(), other: z.boolean() }).optional(),
  /** Whether the toolbar shows worfy's own memory. */
  memoryIndicator: z.boolean(),
  /**
   * "Update automatically": a new Available update is built in the background (worfy-update ticket
   * 03). The store always writes it, on by default; absent (a state made by hand) reads as on, see
   * autoUpdateOf.
   */
  autoUpdate: z.boolean().optional(),
  /** The archive settings the person chose; absent while none is (see sessionArchiveOf). */
  sessionArchive: sessionArchiveChoiceSchema.optional(),
  /** The Browser sleep settings the person chose; absent while none is (see browserSleepOf). */
  browserSleep: browserSleepChoiceSchema.optional(),
  /** The Autopilot budget settings the person chose; absent while none is (see autopilotBudgetOf). */
  autopilotBudget: autopilotBudgetChoiceSchema.optional(),
  /** The default Run mode and the Start window the person chose; absent while none is (see autopilotRunOf). */
  autopilotRun: autopilotRunChoiceSchema.refine(startWindowValid, START_WINDOW_SAME_HOURS).optional(),
  /** The language the person chose in the Guide; absent while none is (the system's language then). */
  guideLanguage: guideLanguageSchema.optional(),
  revision: z.number().int().nonnegative(),
})
export type AppSettings = z.output<typeof appSettingsSchema>

/**
 * A change in parts: only the fields given change. `collapsed` and `visible` merge by key, so a
 * change to one section leaves the others as they are; so do the two windows of
 * `autoCompactWindow`. `interfaceScale` may be any number; the store brings it into range with
 * clampScale, and a window with clampAutoCompactWindow. A window given — a number or null — is the
 * person's choice; AUTO_COMPACT_WINDOW_WORFY_DEFAULT takes it back to worfy's default, not chosen.
 */
export const appSettingsPatchSchema = z.object({
  interfaceScale: z.number().optional(),
  sidebar: z
    .object({
      collapsed: z.record(sectionIdSchema, z.boolean()).optional(),
      visible: sidebarVisibilitySchema.partial().optional(),
    })
    .optional(),
  autoCompactWindow: z
    .object({
      orchestrator: z.union([z.number(), z.literal(AUTO_COMPACT_WINDOW_WORFY_DEFAULT)]).nullable().optional(),
      other: z.union([z.number(), z.literal(AUTO_COMPACT_WINDOW_WORFY_DEFAULT)]).nullable().optional(),
    })
    .optional(),
  memoryIndicator: z.boolean().optional(),
  autoUpdate: z.boolean().optional(),
  /** Each field given is chosen, the default value too; the others stay as they are. */
  sessionArchive: sessionArchiveChoiceSchema.optional(),
  /** Each field given is chosen, as in `sessionArchive`; a value outside BROWSER_SLEEP_BOUNDS is refused. */
  browserSleep: browserSleepChoiceSchema.optional(),
  /** Each field given is chosen, as in `sessionArchive`; a reserve outside AUTOPILOT_RESERVE_BOUNDS is refused. */
  autopilotBudget: autopilotBudgetChoiceSchema.optional(),
  /**
   * Each field given is chosen, as in `sessionArchive`. Both edges of the window given as the same
   * hour are refused here; one edge that meets the other one in force is refused by the store.
   */
  autopilotRun: autopilotRunChoiceSchema
    .refine((choice) => choice.windowFrom === undefined || choice.windowTo === undefined || choice.windowFrom !== choice.windowTo, START_WINDOW_SAME_HOURS)
    .optional(),
  /** The language of the Guide; once chosen it stays chosen. */
  guideLanguage: guideLanguageSchema.optional(),
})
export type AppSettingsPatch = z.input<typeof appSettingsPatchSchema>

/** The settings of a Machine with no app-settings.json yet, or an unreadable one. */
export const DEFAULT_APP_SETTINGS: Readonly<AppSettings> = Object.freeze({
  interfaceScale: INTERFACE_SCALE_DEFAULT,
  sidebar: Object.freeze({ collapsed: Object.freeze({}), visible: Object.freeze({ normal: true, focus: true }) }),
  autoCompactWindow: AUTO_COMPACT_WINDOW_DEFAULTS,
  memoryIndicator: true,
  autoUpdate: true,
  revision: 0,
})

/** A fresh copy of the defaults, safe to change. */
export function defaultAppSettings(): AppSettings {
  return {
    interfaceScale: INTERFACE_SCALE_DEFAULT,
    sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
    autoCompactWindow: { ...AUTO_COMPACT_WINDOW_DEFAULTS },
    memoryIndicator: true,
    autoUpdate: true,
    revision: 0,
  }
}

/** Whether "Update automatically" is on: on unless set off. */
export function autoUpdateOf(settings: Pick<AppSettings, 'autoUpdate'>): boolean {
  return settings.autoUpdate ?? true
}

/** The archive settings in force: each field the person chose, else its default. */
export function sessionArchiveOf(settings: Pick<AppSettings, 'sessionArchive'>): SessionArchive {
  return {
    after: settings.sessionArchive?.after ?? SESSION_ARCHIVE_DEFAULTS.after,
    ticketDone: settings.sessionArchive?.ticketDone ?? SESSION_ARCHIVE_DEFAULTS.ticketDone,
  }
}

/** The Browser sleep settings in force: each field the person chose, else its default. */
export function browserSleepOf(settings: Pick<AppSettings, 'browserSleep'>): BrowserSleep {
  const chosen = settings.browserSleep
  return {
    maxLive: chosen?.maxLive ?? BROWSER_SLEEP_DEFAULTS.maxLive,
    offscreenSeconds: chosen?.offscreenSeconds ?? BROWSER_SLEEP_DEFAULTS.offscreenSeconds,
    idleMinutes: chosen?.idleMinutes ?? BROWSER_SLEEP_DEFAULTS.idleMinutes,
    zoom: chosen?.zoom ?? BROWSER_SLEEP_DEFAULTS.zoom,
  }
}

/** The Autopilot budget settings in force: each field the person chose, else its default. */
export function autopilotBudgetOf(settings: Pick<AppSettings, 'autopilotBudget'>): AutopilotBudgetSettings {
  return {
    enabled: settings.autopilotBudget?.enabled ?? AUTOPILOT_BUDGET_DEFAULTS.enabled,
    reservePercent: settings.autopilotBudget?.reservePercent ?? AUTOPILOT_BUDGET_DEFAULTS.reservePercent,
  }
}

/**
 * The Run settings in force: the window from each edge the person chose, else 23:00–07:00; the mode
 * the person chose, else Budget-aware while the daily budget is on and Fastest while it is off.
 */
export function autopilotRunOf(settings: Pick<AppSettings, 'autopilotRun' | 'autopilotBudget'>): AutopilotRunSettings {
  const mode = settings.autopilotRun?.mode ?? (autopilotBudgetOf(settings).enabled ? 'budget-aware' : 'fastest')
  return { mode, window: startWindowOf(settings.autopilotRun) }
}

type WindowSettings = Pick<AppSettings, 'autoCompactWindow' | 'autoCompactWindowChosen'>

/**
 * Whether the person chose the window of `role` in Settings: marked so, or off worfy's default —
 * which only a choice can make it.
 */
export function autoCompactWindowChosen(settings: WindowSettings, role: AutoCompactRole): boolean {
  return settings.autoCompactWindowChosen?.[role] === true || settings.autoCompactWindow[role] !== AUTO_COMPACT_WINDOW_DEFAULTS[role]
}

/** Where the window of a role comes from, as Settings → Sessions names it. */
export type AutoCompactWindowSource =
  /** The person chose "Custom": worfy passes this window. */
  | { kind: 'custom'; window: number }
  /** The person chose "Claude Code default": worfy passes nothing. */
  | { kind: 'claude-code-default' }
  /** Nothing chosen, and the user's ~/.claude/settings.json has a window: worfy passes nothing, Claude Code takes that one. */
  | { kind: 'user-settings'; window: number }
  /** Nothing chosen and nothing in settings.json: worfy passes its own default. */
  | { kind: 'worfy-default'; window: number }

/**
 * The source of the window of `role`, in this order: the person's choice in Settings, then
 * `userWindow` — `autoCompactWindow` of the user's ~/.claude/settings.json, null when it has none —
 * then worfy's default.
 */
export function autoCompactWindowSource(settings: WindowSettings, role: AutoCompactRole, userWindow: number | null): AutoCompactWindowSource {
  if (autoCompactWindowChosen(settings, role)) {
    const window = settings.autoCompactWindow[role]
    return window === null ? { kind: 'claude-code-default' } : { kind: 'custom', window }
  }
  if (userWindow !== null) return { kind: 'user-settings', window: userWindow }
  return { kind: 'worfy-default', window: AUTO_COMPACT_WINDOW_DEFAULTS[role] }
}

/**
 * The autocompact window a Session's Claude Code is started with: the Orchestrator's for a
 * Project's Orchestrator (Autopilot's included), the other one for any other Session, by
 * autoCompactWindowSource; null — pass nothing.
 */
export function autoCompactWindowFor(settings: WindowSettings, orchestrator: boolean, userWindow: number | null): number | null {
  const source = autoCompactWindowSource(settings, orchestrator ? 'orchestrator' : 'other', userWindow)
  return source.kind === 'custom' || source.kind === 'worfy-default' ? source.window : null
}

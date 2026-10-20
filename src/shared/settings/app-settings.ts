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
// - `revision` — grows with every write, so a renderer keeps the newest of the states it hears.
import { z } from 'zod'

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
})
export type AppSettingsPatch = z.input<typeof appSettingsPatchSchema>

/** The settings of a Machine with no app-settings.json yet, or an unreadable one. */
export const DEFAULT_APP_SETTINGS: Readonly<AppSettings> = Object.freeze({
  interfaceScale: INTERFACE_SCALE_DEFAULT,
  sidebar: Object.freeze({ collapsed: Object.freeze({}), visible: Object.freeze({ normal: true, focus: true }) }),
  autoCompactWindow: AUTO_COMPACT_WINDOW_DEFAULTS,
  memoryIndicator: true,
  revision: 0,
})

/** A fresh copy of the defaults, safe to change. */
export function defaultAppSettings(): AppSettings {
  return {
    interfaceScale: INTERFACE_SCALE_DEFAULT,
    sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
    autoCompactWindow: { ...AUTO_COMPACT_WINDOW_DEFAULTS },
    memoryIndicator: true,
    revision: 0,
  }
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

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
  revision: z.number().int().nonnegative(),
})
export type AppSettings = z.output<typeof appSettingsSchema>

/**
 * A change in parts: only the fields given change. `collapsed` and `visible` merge by key, so a
 * change to one section leaves the others as they are; so do the two windows of
 * `autoCompactWindow`. `interfaceScale` may be any number; the store brings it into range with
 * clampScale, and a window with clampAutoCompactWindow.
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
      orchestrator: z.number().nullable().optional(),
      other: z.number().nullable().optional(),
    })
    .optional(),
})
export type AppSettingsPatch = z.input<typeof appSettingsPatchSchema>

/** The settings of a Machine with no app-settings.json yet, or an unreadable one. */
export const DEFAULT_APP_SETTINGS: Readonly<AppSettings> = Object.freeze({
  interfaceScale: INTERFACE_SCALE_DEFAULT,
  sidebar: Object.freeze({ collapsed: Object.freeze({}), visible: Object.freeze({ normal: true, focus: true }) }),
  autoCompactWindow: AUTO_COMPACT_WINDOW_DEFAULTS,
  revision: 0,
})

/** A fresh copy of the defaults, safe to change. */
export function defaultAppSettings(): AppSettings {
  return {
    interfaceScale: INTERFACE_SCALE_DEFAULT,
    sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
    autoCompactWindow: { ...AUTO_COMPACT_WINDOW_DEFAULTS },
    revision: 0,
  }
}

/**
 * The autocompact window a Session's Claude Code is started with: the Orchestrator's for a
 * Project's Orchestrator (Autopilot's included), the other one for any other Session; null — pass
 * nothing.
 */
export function autoCompactWindowFor(settings: Pick<AppSettings, 'autoCompactWindow'>, orchestrator: boolean): number | null {
  return orchestrator ? settings.autoCompactWindow.orchestrator : settings.autoCompactWindow.other
}

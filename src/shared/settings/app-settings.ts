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
  revision: z.number().int().nonnegative(),
})
export type AppSettings = z.output<typeof appSettingsSchema>

/**
 * A change in parts: only the fields given change. `collapsed` and `visible` merge by key, so a
 * change to one section leaves the others as they are. `interfaceScale` may be any number; the
 * store brings it into range with clampScale.
 */
export const appSettingsPatchSchema = z.object({
  interfaceScale: z.number().optional(),
  sidebar: z
    .object({
      collapsed: z.record(sectionIdSchema, z.boolean()).optional(),
      visible: sidebarVisibilitySchema.partial().optional(),
    })
    .optional(),
})
export type AppSettingsPatch = z.input<typeof appSettingsPatchSchema>

/** The settings of a Machine with no app-settings.json yet, or an unreadable one. */
export const DEFAULT_APP_SETTINGS: Readonly<AppSettings> = Object.freeze({
  interfaceScale: INTERFACE_SCALE_DEFAULT,
  sidebar: Object.freeze({ collapsed: Object.freeze({}), visible: Object.freeze({ normal: true, focus: true }) }),
  revision: 0,
})

/** A fresh copy of the defaults, safe to change. */
export function defaultAppSettings(): AppSettings {
  return { interfaceScale: INTERFACE_SCALE_DEFAULT, sidebar: { collapsed: {}, visible: { normal: true, focus: true } }, revision: 0 }
}

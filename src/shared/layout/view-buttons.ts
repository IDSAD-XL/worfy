// The View button layout (worfy-layout ticket 02): which of the six View buttons sits in which zone
// of the window — the header, the sidebar's rail or the footer — and in what order. It is not the
// Layout of CONTEXT.md (the Nodes of a Canvas, the other files of this folder): it lives in the app
// settings of this Machine (`viewButtons`, src/shared/settings/app-settings.ts). No React here: the
// store of main repairs what it reads and what a window sends with these functions, and the renderer
// moves buttons with them.
//
// Each of the six ids is always in exactly one zone: a View button can be moved, never hidden (Q6 of
// the spec). A zone may be empty.
import { z } from 'zod'

/** The views that have a View button; `history` is Runs. The other two views (`story`, `changes`) have none. */
export const VIEW_BUTTON_IDS = ['canvas', 'session', 'pipeline', 'history', 'pull-requests', 'acceptance'] as const
export const viewButtonIdSchema = z.enum(VIEW_BUTTON_IDS)
export type ViewButtonId = z.output<typeof viewButtonIdSchema>

/** The zones a View button may sit in. */
export const VIEW_ZONES = ['header', 'rail', 'footer'] as const
export type ViewZone = (typeof VIEW_ZONES)[number]

/** The buttons of each zone, in order. */
export type ViewButtons = Record<ViewZone, ViewButtonId[]>

/** The layout until the person moves a button, and again after Reset layout (Q1, Q12 of the spec). */
export const DEFAULT_VIEW_BUTTONS: Readonly<Record<ViewZone, readonly ViewButtonId[]>> = Object.freeze({
  header: Object.freeze(['canvas', 'session'] as const),
  rail: Object.freeze(['pull-requests', 'acceptance'] as const),
  footer: Object.freeze(['pipeline', 'history'] as const),
})

/** A layout as the functions below take it: one they made, the default, or one of the settings. */
type AnyViewButtons = Readonly<Record<ViewZone, readonly ViewButtonId[]>>

/** Whether every id is in exactly one zone. */
function complete(layout: AnyViewButtons): boolean {
  const placed = VIEW_ZONES.flatMap((zone) => layout[zone])
  return placed.length === VIEW_BUTTON_IDS.length && VIEW_BUTTON_IDS.every((id) => placed.includes(id))
}

/** A layout a window sends: known ids in the three zones. The store repairs it before it keeps it. */
export const viewButtonsPatchSchema = z.object({
  header: z.array(viewButtonIdSchema),
  rail: z.array(viewButtonIdSchema),
  footer: z.array(viewButtonIdSchema),
})

/** A layout as the settings hold it: each of the six ids in exactly one zone. */
export const viewButtonsSchema = viewButtonsPatchSchema.refine(complete, 'each View button sits in exactly one zone')

function copyOf(layout: AnyViewButtons): ViewButtons {
  return { header: [...layout.header], rail: [...layout.rail], footer: [...layout.footer] }
}

/** A fresh copy of the default layout, safe to change. */
export function defaultViewButtons(): ViewButtons {
  return copyOf(DEFAULT_VIEW_BUTTONS)
}

function isViewButtonId(value: unknown): value is ViewButtonId {
  return typeof value === 'string' && (VIEW_BUTTON_IDS as readonly string[]).includes(value)
}

/**
 * The layout `raw` stands for, whatever it is — the field of app-settings.json, which another build of
 * worfy may have written, or what a window sent. An unknown id (a view a newer build has, or one a
 * newer build removed) is dropped; of a repeated id the first stays, in zone order header, rail,
 * footer; a missing id (a view added after the layout was written) goes to the end of its default
 * zone. Anything but an object with an array in each of the three zones is the default layout. A zone
 * this build does not know is left out.
 */
export function repairViewButtons(raw: unknown): ViewButtons {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return defaultViewButtons()
  const zones = raw as Partial<Record<ViewZone, unknown>>
  if (!VIEW_ZONES.every((zone) => Array.isArray(zones[zone]))) return defaultViewButtons()
  const seen = new Set<ViewButtonId>()
  const repaired: ViewButtons = { header: [], rail: [], footer: [] }
  for (const zone of VIEW_ZONES) {
    for (const id of zones[zone] as unknown[]) {
      if (!isViewButtonId(id) || seen.has(id)) continue
      seen.add(id)
      repaired[zone].push(id)
    }
  }
  for (const zone of VIEW_ZONES) {
    for (const id of DEFAULT_VIEW_BUTTONS[zone]) if (!seen.has(id)) repaired[zone].push(id)
  }
  return repaired
}

/**
 * The layout with the button at place `from` of `zone` moved to place `to` of the same zone; a `to`
 * past either end is that end. A `from` the zone does not have changes nothing. Always a new layout.
 */
export function moveWithin(layout: AnyViewButtons, zone: ViewZone, from: number, to: number): ViewButtons {
  const next = copyOf(layout)
  const buttons = next[zone]
  if (!Number.isInteger(from) || from < 0 || from >= buttons.length) return next
  const [moved] = buttons.splice(from, 1)
  buttons.splice(Math.min(Math.max(Math.trunc(to), 0), buttons.length), 0, moved as ViewButtonId)
  return next
}

/**
 * The layout with button `id` taken from its zone and put into `zone` at place `index` — a place among
 * the buttons that stay there, so in its own zone it is the place among the others. Without `index`,
 * or with one past the end, at the end; below 0, first. Always a new layout.
 */
export function moveToZone(layout: AnyViewButtons, id: ViewButtonId, zone: ViewZone, index?: number): ViewButtons {
  const next = copyOf(layout)
  for (const each of VIEW_ZONES) next[each] = next[each].filter((placed) => placed !== id)
  const buttons = next[zone]
  const at = index === undefined || Number.isNaN(index) ? buttons.length : Math.min(Math.max(Math.trunc(index), 0), buttons.length)
  buttons.splice(at, 0, id)
  return next
}

/** Whether two layouts put the same buttons in the same zones, in the same order. */
export function sameViewButtons(a: AnyViewButtons, b: AnyViewButtons): boolean {
  return VIEW_ZONES.every((zone) => a[zone].length === b[zone].length && a[zone].every((id, at) => b[zone][at] === id))
}

/** Whether `layout` is the default one: Reset layout would change nothing. */
export function isDefault(layout: AnyViewButtons): boolean {
  return sameViewButtons(layout, DEFAULT_VIEW_BUTTONS)
}

// Action templates: the text of the message that the "Ship ticket" and "Run wave" actions send
// (ticket 23). Each Project runs its own process, so the text is a Project setting. worfy does not
// know what the skill does: it keeps the string and ticket 23 fills in the placeholders.
import { z } from 'zod'

/** The placeholders a template may contain, written as `{name}`. */
export const PLACEHOLDERS = ['epic', 'NN', 'wave', 'slug', 'branch', 'tickets'] as const
export type Placeholder = (typeof PLACEHOLDERS)[number]

export const PLACEHOLDER_DESCRIPTIONS: Readonly<Record<Placeholder, string>> = {
  epic: 'epic name',
  NN: 'ticket number',
  wave: 'wave number in the plan',
  slug: 'ticket slug',
  branch: 'ticket branch',
  tickets: "the wave's ticket numbers",
}

export const ACTIONS = ['shipTicket', 'runWave'] as const
export type Action = (typeof ACTIONS)[number]

/** UI names of the actions (docs/design/BRIEF.md). */
export const ACTION_LABELS: Readonly<Record<Action, string>> = {
  shipTicket: 'Ship ticket',
  runWave: 'Run wave',
}

/**
 * "Run wave" names the Wave's Tickets, not the number of the Wave in the plan (ADR-0033): the
 * number depended on the spec's table and on Tickets that should not be in the Wave.
 */
export const DEFAULT_ACTION_TEMPLATES: Readonly<Record<Action, string>> = {
  shipTicket: '/ship-ticket {epic} {NN}',
  runWave: '/epic-wave Ticket-ы {tickets} эпика {epic}',
}

/** The default "Run wave" template before ADR-0033; saved settings that still hold it read as the new one. */
export const LEGACY_RUN_WAVE_TEMPLATE = '/epic-wave волна {wave} эпика {epic}'

/** Why Autopilot does not run with a "Run wave" template that does not name the Wave's Tickets (ADR-0033). */
export const AUTOPILOT_TEMPLATE_HINT = "The Run wave template does not name the Wave's tickets: add {tickets}"

/** Whether a "Run wave" template names the Wave's Tickets, as Autopilot needs. */
export function namesWaveTickets(template: string): boolean {
  return template.includes('{tickets}')
}

const KNOWN = new Set<string>(PLACEHOLDERS)

/** Every `{…}` group of the template whose name is not a known placeholder, in order. */
export function unknownPlaceholders(template: string): string[] {
  return [...template.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1] ?? '').filter((name) => !KNOWN.has(name))
}

/** An empty (or blank) template means the action is not configured for the Project. */
export function isActionConfigured(template: string): boolean {
  return template.trim() !== ''
}

/** The message for "this template cannot be saved", or undefined when it can. */
export function templateError(template: string): string | undefined {
  const unknown = unknownPlaceholders(template)
  if (unknown.length === 0) return undefined
  const names = unknown.map((name) => `{${name}}`).join(', ')
  const allowed = PLACEHOLDERS.map((name) => `{${name}}`).join(', ')
  return `Unknown placeholder ${names}. Allowed: ${allowed}.`
}

export const actionTemplateSchema = z.string().superRefine((template, context) => {
  const error = templateError(template)
  if (error) context.addIssue({ code: 'custom', message: error })
})

export const actionTemplatesSchema = z.object({
  shipTicket: actionTemplateSchema,
  runWave: actionTemplateSchema,
})
export type ActionTemplates = z.output<typeof actionTemplatesSchema>

/** A Project's settings, kept in `<Project data folder>/settings.json`. */
export const projectSettingsSchema = z.object({
  actionTemplates: actionTemplatesSchema,
})
export type ProjectSettings = z.output<typeof projectSettingsSchema>

/** What a new Project starts with. */
export function defaultProjectSettings(): ProjectSettings {
  return { actionTemplates: { ...DEFAULT_ACTION_TEMPLATES } }
}

/**
 * Saved settings as they are read (ADR-0033): a "Run wave" template equal to the old default
 * becomes the new default; every other template, the owner's own, stays as it was saved.
 */
export function migrateProjectSettings(settings: ProjectSettings): ProjectSettings {
  if (settings.actionTemplates.runWave !== LEGACY_RUN_WAVE_TEMPLATE) return settings
  return { ...settings, actionTemplates: { ...settings.actionTemplates, runWave: DEFAULT_ACTION_TEMPLATES.runWave } }
}

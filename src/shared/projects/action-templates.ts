// Action templates: the text of the message that the "Ship ticket", "Run wave" and "Process gate
// queue" actions send (ticket 23; worfy-windows ticket 17). Each Project runs its own process, so the text is a Project setting. worfy does not
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

export const ACTIONS = ['shipTicket', 'runWave', 'gateQueue'] as const
export type Action = (typeof ACTIONS)[number]

/** UI names of the actions (docs/design/BRIEF.md). */
export const ACTION_LABELS: Readonly<Record<Action, string>> = {
  shipTicket: 'Ship ticket',
  runWave: 'Run wave',
  gateQueue: 'Process gate queue',
}

/**
 * Which Harness is on the machine (src/main/harness/locate.ts, worfy-harness ticket 12): the plugin
 * `worfy` in ~/.claude/worfy-harness/plugin, the old Harness in ~/.claude/bin, or none.
 */
export const HARNESS_KINDS = ['plugin', 'legacy', 'none'] as const
export type HarnessKind = (typeof HARNESS_KINDS)[number]

/**
 * The defaults with the old Harness in ~/.claude: its skills go by their bare names. "Run wave"
 * names the Wave's Tickets, not the number of the Wave in the plan (ADR-0033): the number depended
 * on the spec's table and on Tickets that should not be in the Wave. The old Harness has no skill
 * for the gate queue, so "Process gate queue" is not configured with it.
 */
export const LEGACY_HARNESS_TEMPLATES: Readonly<Record<Action, string>> = {
  shipTicket: '/ship-ticket {epic} {NN}',
  runWave: '/epic-wave Ticket-ы {tickets} эпика {epic}',
  gateQueue: '',
}

/**
 * The defaults with the Harness plugin, and with no Harness found (Sessions of worfy then carry
 * its own plugin inline, ADR-0040): a plugin's skill is called only with its prefix. "Run wave" is
 * the Autopilot command that harness/skills/epic-wave/SKILL.md declares, `tickets NN, NN of epic X`;
 * "Process gate queue" is harness/skills/gate-queue/SKILL.md, without placeholders.
 */
export const PLUGIN_HARNESS_TEMPLATES: Readonly<Record<Action, string>> = {
  shipTicket: '/worfy:ship-ticket {epic} {NN}',
  runWave: '/worfy:epic-wave tickets {tickets} of epic {epic}',
  gateQueue: '/worfy:gate-queue',
}

/**
 * The defaults with the old Harness (LEGACY_HARNESS_TEMPLATES): the app's code uses
 * defaultActionTemplates(kind); tests and fixtures that stand on a Claude home with
 * bin/epic-status use this one.
 */
export const DEFAULT_ACTION_TEMPLATES: Readonly<Record<Action, string>> = LEGACY_HARNESS_TEMPLATES

/** The default templates for the Harness found on the machine, a fresh copy. */
export function defaultActionTemplates(harness: HarnessKind): Record<Action, string> {
  return { ...(harness === 'legacy' ? LEGACY_HARNESS_TEMPLATES : PLUGIN_HARNESS_TEMPLATES) }
}

/** The default "Run wave" template before ADR-0033; saved settings that still hold it read as the new one. */
export const LEGACY_RUN_WAVE_TEMPLATE = '/epic-wave волна {wave} эпика {epic}'

/**
 * Every template that was or is a default of an action. A saved template equal to one of them was
 * never the owner's own, and reads as the default of the Harness found now.
 */
const KNOWN_DEFAULTS: Readonly<Record<Action, ReadonlySet<string>>> = {
  shipTicket: new Set([LEGACY_HARNESS_TEMPLATES.shipTicket, PLUGIN_HARNESS_TEMPLATES.shipTicket]),
  runWave: new Set([LEGACY_HARNESS_TEMPLATES.runWave, LEGACY_RUN_WAVE_TEMPLATE, PLUGIN_HARNESS_TEMPLATES.runWave]),
  // The old Harness's empty default is not here: an empty template may be the owner's own choice.
  gateQueue: new Set([PLUGIN_HARNESS_TEMPLATES.gateQueue]),
}

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
  gateQueue: actionTemplateSchema,
})
export type ActionTemplates = z.output<typeof actionTemplatesSchema>

/** The shells a Terminal can start on Windows (worfy-windows ticket 10). */
export const terminalShellSettingSchema = z.enum(['powershell', 'git-bash'])
export type TerminalShellSetting = z.output<typeof terminalShellSettingSchema>

/** A Project's settings, kept in `<Project data folder>/settings.json`. */
export const projectSettingsSchema = z.object({
  actionTemplates: actionTemplatesSchema,
  /**
   * Which shell the Terminals of the Project start on Windows; PowerShell when absent, and absent
   * until the user chooses. A Project lives on one Machine (ADR-0052), so the choice is for that
   * Machine. Elsewhere the shell is `$SHELL`, and the field is not read.
   */
  terminalShell: terminalShellSettingSchema.optional(),
})
export type ProjectSettings = z.output<typeof projectSettingsSchema>

/**
 * The settings as `settings.json` is read: a `terminalShell` this version does not know (a data
 * folder of a later worfy, a hand edit) reads as not chosen, and the rest of the file stays. A file
 * saved before "Process gate queue" existed has no `gateQueue`: migrateProjectSettings gives it the
 * default. What is saved goes through projectSettingsSchema, which refuses such a value.
 */
export const savedProjectSettingsSchema = projectSettingsSchema.extend({
  actionTemplates: actionTemplatesSchema.extend({ gateQueue: actionTemplateSchema.optional() }),
  terminalShell: terminalShellSettingSchema.optional().catch(undefined),
})
export type SavedProjectSettings = z.output<typeof savedProjectSettingsSchema>

/** What a new Project starts with: the defaults of the Harness found on the machine. */
export function defaultProjectSettings(harness: HarnessKind): ProjectSettings {
  return { actionTemplates: defaultActionTemplates(harness) }
}

/**
 * Saved settings as they are read: a template equal to any default an action has had — the old
 * Harness's, the plugin's, the "Run wave" one before ADR-0033 — reads as the default of the Harness
 * found now (worfy-harness ticket 12), so a Project keeps sending what that Harness understands.
 * A template the file does not have (`gateQueue`, saved before worfy-windows ticket 17) is that
 * default too. Every other template, the owner's own (an empty one too), stays as it was saved.
 */
export function migrateProjectSettings(settings: SavedProjectSettings, harness: HarnessKind): ProjectSettings {
  const defaults = defaultActionTemplates(harness)
  const current = settings.actionTemplates
  const next: Record<Action, string> = { ...defaults }
  for (const action of ACTIONS) {
    const saved = current[action]
    next[action] = saved === undefined || KNOWN_DEFAULTS[action].has(saved) ? defaults[action] : saved
  }
  // Every template saved and none changed: the saved object itself, as before.
  if (ACTIONS.every((action) => next[action] === current[action])) return settings as ProjectSettings
  return { ...settings, actionTemplates: next }
}

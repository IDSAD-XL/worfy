// Action templates: the text of the message that the "Ship ticket", "Run wave", "Process gate
// queue", "Draft replies", "Fix checks", "Resolve conflicts" and "Address comments" actions send (ticket 23;
// worfy-windows ticket 17; worfy-pr-inbox ticket 04; worfy-pr-follow ticket 01). Each Project runs its own process, so the text is a Project setting. worfy does not
// know what the skill does: it keeps the string and ticket 23 fills in the placeholders.
import { z } from 'zod'
import { vendorIdSchema, type VendorId } from '../vendors/vendor'

/** The placeholders a template may contain, written as `{name}`. */
export const PLACEHOLDERS = ['epic', 'NN', 'wave', 'slug', 'branch', 'tickets', 'repo', 'pr', 'sha'] as const
export type Placeholder = (typeof PLACEHOLDERS)[number]

export const PLACEHOLDER_DESCRIPTIONS: Readonly<Record<Placeholder, string>> = {
  epic: 'epic name',
  NN: 'ticket number',
  wave: 'wave number in the plan',
  slug: 'ticket slug',
  branch: 'ticket branch',
  tickets: "the wave's ticket numbers",
  repo: "the pull request's repository, owner/name",
  pr: 'pull request number',
  sha: "the pull request's head commit, 40 hex characters",
}

export const ACTIONS = ['shipTicket', 'runWave', 'gateQueue', 'prReply', 'fixChecks', 'resolveConflicts', 'addressComments'] as const
export type Action = (typeof ACTIONS)[number]

/** UI names of the actions (docs/design/BRIEF.md). */
export const ACTION_LABELS: Readonly<Record<Action, string>> = {
  shipTicket: 'Ship ticket',
  runWave: 'Run wave',
  gateQueue: 'Process gate queue',
  prReply: 'Draft replies',
  fixChecks: 'Fix checks',
  resolveConflicts: 'Resolve conflicts',
  addressComments: 'Address comments',
}

/**
 * The actions that hand one pull request to a Session of the skill pr-fix (worfy-pr-follow ticket 01), in the order
 * their reasons rank on a button: a PR in conflict runs no CI, so Resolve conflicts comes first, then Fix checks, then
 * Address comments (src/shared/actions/pr-follow.ts).
 */
export const PR_FOLLOW_ACTIONS = ['resolveConflicts', 'fixChecks', 'addressComments'] as const satisfies readonly Action[]
export type PrFollowAction = (typeof PR_FOLLOW_ACTIONS)[number]

/**
 * The actions a settings file saved by an earlier build may lack, and a Linked machine of an earlier build may not
 * send or answer: each came after the first templates. A file without one reads with its default; an answer
 * without one reads as an empty template (no button).
 */
export const LATER_ACTIONS = ['gateQueue', 'prReply', ...PR_FOLLOW_ACTIONS] as const satisfies readonly Action[]

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
 * for the gate queue, for drafting replies or for following a pull request (pr-fix), so "Process gate queue",
 * "Draft replies", "Fix checks", "Resolve conflicts" and "Address comments" are not configured with it: their
 * buttons stay inactive.
 */
export const LEGACY_HARNESS_TEMPLATES: Readonly<Record<Action, string>> = {
  shipTicket: '/ship-ticket {epic} {NN}',
  // Data of the old Harness's protocol, not text of worfy's own: its epic-wave skill reads only this
  // Russian form, and the plugin's English form would not start a Wave there (ADR-0074, point 6).
  // shortcut: accepts the old Russian token of the old Harness's command, remove with old-Harness support once no Machine runs it.
  runWave: '/epic-wave Ticket-ы {tickets} эпика {epic}',
  gateQueue: '',
  prReply: '',
  fixChecks: '',
  resolveConflicts: '',
  addressComments: '',
}

/**
 * The defaults with the Harness plugin, and with no Harness found (Sessions of worfy then carry
 * its own plugin inline, ADR-0040): a plugin's skill is called only with its prefix. "Run wave" is
 * the Autopilot command that harness/skills/epic-wave/SKILL.md declares, `tickets NN, NN of epic X`;
 * "Process gate queue" is harness/skills/gate-queue/SKILL.md, without placeholders; "Draft replies" is
 * harness/skills/pr-reply/SKILL.md over one pull request, `owner/name#N` (worfy-pr-inbox ticket 04). "Fix checks",
 * "Resolve conflicts" and "Address comments" are harness/skills/pr-fix/SKILL.md in its three modes over one pull
 * request at the head worfy read, `{sha}` (worfy-pr-follow ticket 01): the skill checks the head again itself.
 */
export const PLUGIN_HARNESS_TEMPLATES: Readonly<Record<Action, string>> = {
  shipTicket: '/worfy:ship-ticket {epic} {NN}',
  runWave: '/worfy:epic-wave tickets {tickets} of epic {epic}',
  gateQueue: '/worfy:gate-queue',
  prReply: '/worfy:pr-reply {repo}#{pr}',
  fixChecks: '/worfy:pr-fix checks {repo}#{pr} {sha}',
  resolveConflicts: '/worfy:pr-fix conflicts {repo}#{pr} {sha}',
  addressComments: '/worfy:pr-fix comments {repo}#{pr} {sha}',
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

/**
 * The default "Run wave" template before ADR-0033; saved settings that still hold it read as the new one.
 * It is never sent: the app only recognises it in saved settings.
 */
// shortcut: accepts the old Russian token of a saved setting, remove after the next release (worfy-neutral 08).
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
  prReply: new Set([PLUGIN_HARNESS_TEMPLATES.prReply]),
  fixChecks: new Set([PLUGIN_HARNESS_TEMPLATES.fixChecks]),
  resolveConflicts: new Set([PLUGIN_HARNESS_TEMPLATES.resolveConflicts]),
  addressComments: new Set([PLUGIN_HARNESS_TEMPLATES.addressComments]),
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
  prReply: actionTemplateSchema,
  fixChecks: actionTemplateSchema,
  resolveConflicts: actionTemplateSchema,
  addressComments: actionTemplateSchema,
})
export type ActionTemplates = z.output<typeof actionTemplatesSchema>

/** The shells a Terminal can start on Windows (worfy-windows ticket 10). */
export const terminalShellSettingSchema = z.enum(['powershell', 'git-bash'])
export type TerminalShellSetting = z.output<typeof terminalShellSettingSchema>

/**
 * The Vendor of a Session "Ship ticket" starts (src/main/actions/launch.ts): Claude Code whatever the
 * Project's `defaultVendor`. The Harness's skills — `/ship-ticket` among them — reach Codex only with
 * worfy-multi-vendor tickets 35 and 36 (ticket 24, decided without the owner — to confirm).
 */
export const SHIP_TICKET_VENDOR: VendorId = 'claude'

/**
 * The Vendor of the Session "Draft replies" starts: always Claude Code, as the skill pr-reply is a Harness skill (worfy-pr-inbox spec).
 * "Fix checks", "Resolve conflicts" and "Address comments" start theirs on it too, and pass by a Ticket's Session of
 * another Vendor (worfy-pr-follow ticket 01): the skill pr-fix is a Harness skill as well.
 */
export const PR_REPLY_VENDOR: VendorId = 'claude'

/**
 * "Agent review" of someone else's pull request (worfy-pr-review ticket 08): a Session writes the whole review draft —
 * comments on lines, the summary, a suggested verdict — through harness/bin/pr-review-draft, and posts nothing. Its first
 * message: the Team reviewer of the Project (`/human-review`, ADR-0102) when it is built, else the review lenses of
 * `/worfy:code-review` over the pull request; then AGENT_REVIEW_RULE, which also tells a Team reviewer built before its
 * section «When worfy runs you for Agent review» what to do, until its next Refresh. Not a setting of the Project: which
 * of the two runs depends on the Team reviewer, not on a template the person edits (decided without the owner).
 */
export const AGENT_REVIEW_LABEL = 'Agent review'
export const AGENT_REVIEW_TEAM_TEMPLATE = '/human-review {repo}#{pr}'
export const AGENT_REVIEW_LENSES_TEMPLATE = '/worfy:code-review {repo}#{pr}'
export const AGENT_REVIEW_RULE = 'Agent review: write the review draft only through bin/pr-review-draft (pr-review-draft --help); the verdict is only a suggestion; nothing goes to GitHub.'
/** Ask the agent to add comments: the draft is the person's. */
export const AGENT_REVIEW_ADD_RULE = "Add your comments to the person's draft: their comments and their summary stay."
/** The Vendor of that Session: Claude Code, as for Draft replies — both skills are the Harness's. */
export const AGENT_REVIEW_VENDOR: VendorId = 'claude'

/** The first message of an Agent review of `repo`#`pr`. */
export function agentReviewText(input: { teamReviewer: boolean; repo: string; pr: number; fill: 'new' | 'add' }): string {
  const command = (input.teamReviewer ? AGENT_REVIEW_TEAM_TEMPLATE : AGENT_REVIEW_LENSES_TEMPLATE).replace('{repo}', input.repo).replace('{pr}', String(input.pr))
  return [command, AGENT_REVIEW_RULE, ...(input.fill === 'add' ? [AGENT_REVIEW_ADD_RULE] : [])].join(' ')
}

/**
 * The first message of the Session "Build" of the team reviewer starts (worfy-human-review ticket 09):
 * the Harness's generator skill, which reads the Project's review history and writes its private
 * reviewer skill. worfy only sends the text (ADR-0002).
 */
export const TEAM_REVIEWER_COMMAND = '/worfy:human-review-setup'

/**
 * The first message of the Session "Update" starts (worfy-human-review ticket 10): the same skill on the
 * pull requests since its last read, which shows the diff of the rules before anything is replaced.
 */
export const TEAM_REVIEWER_REFRESH_COMMAND = `${TEAM_REVIEWER_COMMAND} --refresh`

/** The Vendor of that Session: Claude Code only (spec decision 11 of worfy-human-review). */
export const TEAM_REVIEWER_VENDOR: VendorId = 'claude'

/**
 * The team reviewer's part of a Project's settings (worfy-human-review ticket 09). `offer: "later"`:
 * the user answered the offer made after the Project was added with "Later" or closed it, and worfy
 * does not offer again; "Build" in Project settings stays. Absent until then. `remindedAt`
 * (worfy-human-review ticket 10): when the reminder to update the reviewer was last shown, as an ISO
 * date; the next one comes 30 days later at the earliest. Absent until the first one.
 */
export const humanReviewSettingsSchema = z.object({
  offer: z.enum(['later']).optional(),
  remindedAt: z.iso.datetime().optional(),
})
export type HumanReviewSettings = z.output<typeof humanReviewSettingsSchema>

/** A Project's settings, kept in `<Project data folder>/settings.json`. */
export const projectSettingsSchema = z.object({
  actionTemplates: actionTemplatesSchema,
  /**
   * Which shell the Terminals of the Project start on Windows; PowerShell when absent, and absent
   * until the user chooses. A Project lives on one Machine (ADR-0052), so the choice is for that
   * Machine. Elsewhere the shell is `$SHELL`, and the field is not read.
   */
  terminalShell: terminalShellSettingSchema.optional(),
  /**
   * The Vendor of a new Session of the Project when "New session" names none (worfy-multi-vendor
   * ticket 23, spec decision 8); Claude Code when absent, and absent until the user chooses.
   */
  defaultVendor: vendorIdSchema.optional(),
  /** The team reviewer (worfy-human-review ticket 09); absent in a file saved before it, which reads as not answered. */
  humanReview: humanReviewSettingsSchema.optional(),
  /**
   * «Product Session may also write here» (worfy-polish ticket 82): folders outside the Product Session
   * folder where a Product Session of the Project writes without a question, each added by «Always allow
   * in <folder>» and removed in Project settings. Absent until the first one.
   */
  productWriteFolders: z.array(z.string().min(1)).optional(),
  /**
   * The PR inbox of the Project (worfy-pr-inbox ticket 02, spec decision Q10): absent or `true` — main reads the
   * Project's open PRs when one of its repositories is on GitHub; `false` — it never runs gh for the Project.
   */
  prInbox: z.boolean().optional(),
})
export type ProjectSettings = z.output<typeof projectSettingsSchema>

/**
 * The settings as `settings.json` is read: a `terminalShell`, a `defaultVendor`, a `humanReview.offer`
 * or a `humanReview.remindedAt` this version does not know (a data folder of a later worfy, a hand edit) reads as not chosen, and
 * the rest of the file stays. A file
 * saved before "Process gate queue" existed has no `gateQueue`, one saved before "Draft replies"
 * (worfy-pr-inbox ticket 04) no `prReply`, and one saved before worfy-pr-follow ticket 01 none of `fixChecks`,
 * `resolveConflicts` and `addressComments` (LATER_ACTIONS): migrateProjectSettings gives each its default. What is saved goes through projectSettingsSchema, which refuses such a value.
 */
/** The templates of LATER_ACTIONS, each one optional: a file or a Linked machine of an earlier build may lack it. */
const optionalLater = {
  gateQueue: actionTemplateSchema.optional(),
  prReply: actionTemplateSchema.optional(),
  fixChecks: actionTemplateSchema.optional(),
  resolveConflicts: actionTemplateSchema.optional(),
  addressComments: actionTemplateSchema.optional(),
} satisfies Record<(typeof LATER_ACTIONS)[number], unknown>

/** The templates of LATER_ACTIONS, each one empty when absent. */
const emptyLater = {
  gateQueue: actionTemplateSchema.default(''),
  prReply: actionTemplateSchema.default(''),
  fixChecks: actionTemplateSchema.default(''),
  resolveConflicts: actionTemplateSchema.default(''),
  addressComments: actionTemplateSchema.default(''),
} satisfies Record<(typeof LATER_ACTIONS)[number], unknown>

export const savedProjectSettingsSchema = projectSettingsSchema.extend({
  actionTemplates: actionTemplatesSchema.extend(optionalLater),
  terminalShell: terminalShellSettingSchema.optional().catch(undefined),
  defaultVendor: vendorIdSchema.optional().catch(undefined),
  humanReview: humanReviewSettingsSchema
    .extend({ offer: humanReviewSettingsSchema.shape.offer.catch(undefined), remindedAt: humanReviewSettingsSchema.shape.remindedAt.catch(undefined) })
    .optional()
    .catch(undefined),
  productWriteFolders: projectSettingsSchema.shape.productWriteFolders.catch(undefined),
  // A value that is not a boolean reads as absent: the inbox stays on, as by default.
  prInbox: z.boolean().optional().catch(undefined),
})
export type SavedProjectSettings = z.output<typeof savedProjectSettingsSchema>

/**
 * The settings in an answer of `projects.settings.get` and `projects.settings.defaults` and in
 * `projects.settings.changed`. A Linked machine on a build from before "Process gate queue" answers
 * without `gateQueue`, one from before "Draft replies" without `prReply`, and one from before worfy-pr-follow
 * ticket 01 without `fixChecks`, `resolveConflicts` and `addressComments`; each reads as an empty template (no
 * button), since that build has no `actions.gateQueue`, `actions.prReply` or `actions.prFollow` to run it.
 */
export const projectSettingsAnswerSchema = projectSettingsSchema.extend({
  actionTemplates: actionTemplatesSchema.extend(emptyLater),
})

/**
 * The settings `projects.settings.set` takes. A Linked machine on an older build sends no
 * `gateQueue`, `prReply`, `fixChecks`, `resolveConflicts` or `addressComments` (LATER_ACTIONS); main keeps the saved
 * one, or the default (writeProjectSettings). `defaultVendor`:
 * a Vendor sets it, `null` clears it ("Default vendor" set back to none, worfy-multi-vendor ticket 24),
 * and its absence keeps the saved one, as a build from before the field sends it. `humanReview` absent
 * keeps the saved one too: the dialog's Save does not send it (worfy-human-review ticket 09).
 * `productWriteFolders` absent keeps the saved list (worfy-polish ticket 82), and a build from before the
 * list never sends it. `productWriteFoldersRemoved` takes those folders out of the list: the dialog's
 * Save sends the folders removed there, not the list left, so a folder «Always allow» added while the
 * dialog stood open stays.
 */
export const projectSettingsInputSchema = projectSettingsSchema.extend({
  actionTemplates: actionTemplatesSchema.extend(optionalLater),
  defaultVendor: vendorIdSchema.nullable().optional(),
  productWriteFoldersRemoved: z.array(z.string().min(1)).optional(),
})
export type ProjectSettingsInput = z.output<typeof projectSettingsInputSchema>

/** What a new Project starts with: the defaults of the Harness found on the machine. */
export function defaultProjectSettings(harness: HarnessKind): ProjectSettings {
  return { actionTemplates: defaultActionTemplates(harness) }
}

/**
 * Saved settings as they are read: a template equal to any default an action has had — the old
 * Harness's, the plugin's, the "Run wave" one before ADR-0033 — reads as the default of the Harness
 * found now (worfy-harness ticket 12), so a Project keeps sending what that Harness understands.
 * A template the file does not have (`gateQueue`, saved before worfy-windows ticket 17; `prReply`, saved
 * before worfy-pr-inbox ticket 04; the three of worfy-pr-follow ticket 01) is that
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

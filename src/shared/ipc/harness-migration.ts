// The `harnessMigration` domain (worfy-harness ticket 14; ADR-0040, ADR-0047): moving the old Harness
// out of ~/.claude once the plugin `worfy` carries it. Main builds the form's rows from what is on
// disk (src/main/harness/migrate/plan.ts), the user picks "Remove" or "Keep" for each row, and main
// moves, after a native consent dialog, with a backup and a one-command restore
// (src/main/harness/migrate/apply.ts). The form is src/renderer/harness/MigrationForm.tsx, opened
// from the Harness item of the toolbar.
import { z } from 'zod'
import { invokeChannel } from './channels'

/** What happens to a row: `remove` takes it out of ~/.claude (or moves it, or replaces it), `keep` leaves it. */
export const migrationChoiceSchema = z.enum(['remove', 'keep'])
export type MigrationChoice = z.infer<typeof migrationChoiceSchema>

/**
 * The groups of the form (ticket 14, item 2): Harness files, CLAUDE.md sections, hook records of
 * settings.json, the status line, the qmd group, the machine state, and the Profiles.
 */
export const migrationGroupSchema = z.enum(['files', 'claude-md', 'hooks', 'status-line', 'qmd', 'state', 'profiles'])
export type MigrationGroup = z.infer<typeof migrationGroupSchema>

const choices = z.array(migrationChoiceSchema).min(1)

export const migrationRowSchema = z.object({
  /** Stable while the files do not change: main checks the choices against a fresh plan. */
  id: z.string(),
  group: migrationGroupSchema,
  /** A path for a file, the text of the record for JSON, the heading for a CLAUDE.md section. */
  label: z.string(),
  /** More text: the whole record, the members of the qmd group, the proposed status line. */
  detail: z.string().nullable(),
  /** The choices offered; `['keep']` when the row cannot be removed (`note` says why). */
  choices,
  defaultChoice: migrationChoiceSchema,
  note: z.string().nullable(),
})
export type MigrationRow = z.infer<typeof migrationRowSchema>

/** One `##` or `###` section of CLAUDE.md: its text, heading line included, and its lines [start, end) in the file. */
export const claudeMdSectionSchema = migrationRowSchema.extend({ text: z.string(), start: z.number().int().min(0), end: z.number().int().min(0) })
export type ClaudeMdSection = z.infer<typeof claudeMdSectionSchema>

export const profileModeSchema = z.enum(['full', 'silent'])
export const profileLanguageSchema = z.enum(['ru', 'en'])
export const profileAttributionSchema = z.enum(['on', 'off'])

/** The fields of schema 2 the form proposes and the owner confirms (ticket 14, item 3). */
export const profileFieldsSchema = z.object({
  mode: profileModeSchema,
  languageDocs: profileLanguageSchema,
  attribution: profileAttributionSchema,
})
export type ProfileFields = z.infer<typeof profileFieldsSchema>

/** A file of a Profile as it is and as it would be after the move, for the diff. */
export const migrationFileDiffSchema = z.object({ path: z.string(), before: z.string(), after: z.string() })
export type MigrationFileDiff = z.infer<typeof migrationFileDiffSchema>

export const migrationProfileSchema = migrationRowSchema.extend({
  name: z.string(),
  /** The proposed fields; `after` of profile.json carries them. */
  fields: profileFieldsSchema,
  /** Why `mode` is what it is: where the tickets folder is and whether git holds it. */
  modeReason: z.string(),
  /** profile.json and rules.md before and after (paths rewritten, schema 2). */
  files: z.array(migrationFileDiffSchema),
  /** Folders moved as they are (atakama: bin/, lessons/, state/). */
  carried: z.array(z.string()),
})
export type MigrationProfile = z.infer<typeof migrationProfileSchema>

export const migrationPlanSchema = z.object({
  /** Whether this run may move: the packaged app, or a run with WORFY_CLAUDE_HOME (a sandbox). */
  offered: z.boolean(),
  /** Whether Move may run now: offered, the plugin installed and enabled, and at least one row. */
  available: z.boolean(),
  /** What is missing when not available. */
  missing: z.array(z.string()),
  claudeHome: z.string(),
  harnessHome: z.string(),
  /** Claude Code's .claude.json, where the qmd record is. */
  claudeJson: z.string(),
  rows: z.array(migrationRowSchema),
  /** CLAUDE.md whole (for the diff) and its sections; text outside every section always stays. */
  claudeMd: z.object({ path: z.string(), text: z.string(), sections: z.array(claudeMdSectionSchema) }).nullable(),
  profiles: z.array(migrationProfileSchema),
  /** Shown above the rows (Claude Code sessions already running keep the old hooks). */
  warnings: z.array(z.string()),
})
export type MigrationPlan = z.infer<typeof migrationPlanSchema>

/** What the user chose: a choice for every row id of the plan, and the fields of each moved Profile. */
export const migrationSelectionSchema = z.object({
  choices: z.record(z.string(), migrationChoiceSchema),
  profiles: z.record(z.string(), profileFieldsSchema),
})
export type MigrationSelection = z.infer<typeof migrationSelectionSchema>

/** The steps of a move, in order; a failed one is named in the result. */
export const migrationStepSchema = z.enum(['backup', 'settings', 'claude-json', 'claude-md', 'state', 'files', 'epic-status', 'commit'])
export type MigrationStep = z.infer<typeof migrationStepSchema>

export const migrationResultSchema = z.discriminatedUnion('outcome', [
  /** Moved: the backup folder and the command that undoes the move. */
  z.object({ outcome: z.literal('done'), backupDir: z.string(), restoreCommand: z.string() }),
  /** The user said no in the dialog: nothing was written. */
  z.object({ outcome: z.literal('declined') }),
  /** Not started: nothing was written; `reason` says why. */
  z.object({ outcome: z.literal('refused'), reason: z.string() }),
  /** A step failed; the move was undone (`rolledBack`), or the undo failed too (`rollbackError`, the backup stays). */
  z.object({
    outcome: z.literal('failed'),
    step: migrationStepSchema,
    reason: z.string(),
    rolledBack: z.boolean(),
    rollbackError: z.string().nullable(),
    backupDir: z.string().nullable(),
  }),
])
export type MigrationResult = z.infer<typeof migrationResultSchema>

/** Whether the toolbar offers the form: this run may move, and something of the old Harness is in ~/.claude. Runs no `claude`. */
export const harnessMigrationOffer = invokeChannel('harnessMigration.offer', z.void(), z.object({ offered: z.boolean() }), 'local')

/** The rows of the form, read from disk; writes nothing. */
export const harnessMigrationPlan = invokeChannel('harnessMigration.plan', z.void(), migrationPlanSchema, 'local')

/** Moves by the choices after the consent dialog in main. */
export const harnessMigrationApply = invokeChannel('harnessMigration.apply', migrationSelectionSchema, migrationResultSchema, 'local')

declare module './channels' {
  interface IpcContract {
    'harnessMigration.offer': typeof harnessMigrationOffer
    'harnessMigration.plan': typeof harnessMigrationPlan
    'harnessMigration.apply': typeof harnessMigrationApply
  }
}

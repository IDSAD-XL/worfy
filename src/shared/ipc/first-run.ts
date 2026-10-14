// The `firstRun` domain (worfy-harness ticket 19, question Q22 of the epic): the first-run screen.
// main checks the machine — the Claude Code sign-in, `claude --version` against the version this
// build carries, git, gh and its accounts, node 22 or newer, jq, the Harness plugin and the plugins
// it depends on, the old Harness in ~/.claude, qmd and its models — and runs an action only after the user pressed "Confirm" in
// the dialog that names what it will do. Checks read only; they run in the login shell environment
// (ADR-0007). main: src/main/first-run/ and src/main/ipc/first-run.ts; the screen:
// src/renderer/shell/FirstRun.tsx; the look: docs/design/F-SPEC.md, "First run".
import { z } from 'zod'
import { invokeChannel } from './channels'

export const checkStatusSchema = z.enum(['ok', 'warn', 'fail'])
export type CheckStatus = z.infer<typeof checkStatusSchema>

export const checkIdSchema = z.enum([
  'claude-login',
  'claude-version',
  'git',
  'gh',
  'node',
  'jq',
  'gh-auth',
  'harness',
  'harness-dependencies',
  'harness-scripts',
  'legacy-harness',
  'qmd',
  'qmd-models',
  'qmd-collections',
])
export type CheckId = z.infer<typeof checkIdSchema>

/**
 * What a check's button does. main runs `harness-install` (the Harness plugin and its missing
 * dependencies, one dialog) and the `qmd-*` actions itself after its dialog; `gh-login` is
 * confirmed by main and then typed into a Terminal Node by the screen;
 * `migration-form` only opens the form of worfy-harness ticket 14, which asks on its own.
 */
export const firstRunActionSchema = z.enum(['harness-install', 'migration-form', 'qmd-install', 'qmd-models-download', 'qmd-models-skip', 'qmd-collections', 'gh-login'])
export type FirstRunAction = z.infer<typeof firstRunActionSchema>

export const checkGroupSchema = z.enum(['Claude Code', 'Command-line tools', 'GitHub', 'Harness', 'qmd'])
export type CheckGroup = z.infer<typeof checkGroupSchema>

export const checkSchema = z.object({
  id: checkIdSchema,
  group: checkGroupSchema,
  title: z.string(),
  status: checkStatusSchema,
  /** What was found: a version, an account, "not found". */
  detail: z.string(),
  /** One line: what to do; empty when there is nothing to do. */
  hint: z.string(),
  /** A command the user runs themselves (`brew install jq`, `claude update`); the screen offers to copy it. */
  command: z.string().nullable(),
  /** The buttons of the row, with their labels. */
  actions: z.array(z.object({ id: firstRunActionSchema, label: z.string() })),
})
export type Check = z.infer<typeof checkSchema>

export const firstRunReportSchema = z.object({
  checks: z.array(checkSchema),
  /** ISO time the checks finished. */
  checkedAt: z.string(),
})
export type FirstRunReport = z.infer<typeof firstRunReportSchema>

/**
 * Whether the screen opens by itself at start: when worfy's data folder has no mark that the
 * screen was closed once, or when a check fails that did not fail when it was last closed.
 */
export const firstRunStartup = invokeChannel(
  'firstRun.startup',
  z.void(),
  z.object({
    show: z.boolean(),
    /** The checks, when main ran them to decide; null when it did not need to. */
    report: firstRunReportSchema.nullable(),
  }),
  'local',
)

/** Runs every check again; writes nothing. */
export const firstRunChecks = invokeChannel('firstRun.checks', z.void(), firstRunReportSchema, 'local')

/**
 * One action: main shows the dialog naming the command, the folder and the download, and runs it
 * only on "Confirm". `declined` — nothing ran; `done` — it ran; `failed` — it ran and failed, and
 * the row of its check is `fail` with the error until the next attempt; `confirmed` — `gh-login`
 * only: the screen types the command into a Terminal Node now. The checks run again after a run.
 */
export const firstRunRun = invokeChannel(
  'firstRun.run',
  z.object({
    action: firstRunActionSchema.exclude(['migration-form']),
    /** The Project whose Canvas gets the Terminal Node (`gh-login`); named in the dialog. */
    projectName: z.string().min(1).max(200).optional(),
  }),
  z.object({
    outcome: z.enum(['done', 'declined', 'failed', 'confirmed']),
    /** The error of a failed action, or a note on a done one. */
    message: z.string().nullable(),
    report: firstRunReportSchema,
  }),
  'local',
)

/** The screen was closed: main writes the mark, with the checks that failed at that moment. */
export const firstRunClose = invokeChannel('firstRun.close', z.void(), z.void(), 'local')

declare module './channels' {
  interface IpcContract {
    'firstRun.startup': typeof firstRunStartup
    'firstRun.checks': typeof firstRunChecks
    'firstRun.run': typeof firstRunRun
    'firstRun.close': typeof firstRunClose
  }
}

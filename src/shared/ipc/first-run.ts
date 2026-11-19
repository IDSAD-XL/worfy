// The `firstRun` domain (worfy-harness ticket 19, question Q22 of the epic): the first-run screen.
// main checks the machine — the Claude Code sign-in, `claude --version` against the version this
// build carries, git and the commit author it knows, gh and its accounts, node 22 or newer, jq, the Harness plugin and the plugins
// it depends on, the old Harness in ~/.claude, qmd and its models; on Windows also Git Bash, the Windows
// build and architecture, PowerShell and the Limits bridge in statusLine — and runs an action only after the user pressed "Confirm" in
// the dialog that names what it will do. Checks read only; they run in the login shell environment
// (ADR-0007), on Windows in the environment worfy builds for a Session (ADR-0057). main: src/main/first-run/ and src/main/ipc/first-run.ts; the screen:
// src/renderer/shell/FirstRun.tsx; the look: docs/design/F-SPEC.md, "First run".
import { z } from 'zod'
import { eventChannel, invokeChannel } from './channels'

/**
 * `unknown` (worfy-auth-check ticket 03): the row could not be checked — no network, a timeout,
 * GitHub answering 5xx. It is never critical (owner's decision Q2).
 */
export const checkStatusSchema = z.enum(['ok', 'warn', 'fail', 'unknown'])
export type CheckStatus = z.infer<typeof checkStatusSchema>

export const checkIdSchema = z.enum([
  'claude-login',
  'claude-version',
  // Windows only (worfy-windows ticket 13): the Limits bridge in statusLine, the Windows build,
  // the architecture, the Terminal's PowerShell, Git Bash.
  'limits',
  'windows',
  'arch',
  'powershell',
  'git',
  // The commit author git knows outside any repository (worfy-harness ticket 42).
  'git-identity',
  'git-bash',
  'gh',
  'node',
  'jq',
  'gh-auth',
  // The version of worfy against its Update (worfy-update ticket 08); only where Update is on.
  'worfy-update',
  'harness',
  'harness-dependencies',
  'harness-scripts',
  'legacy-harness',
  'qmd',
  'qmd-models',
  'qmd-collections',
  // The rows of worfy-auth-check (spec: the solution, point 1), declared at once so the level table
  // (src/shared/health/severity.ts) names them all: GitHub access of a Project (ticket 05), the
  // Codex sign-in (ticket 08), a Browser profile whose sign-in expired and a Linked machine whose
  // certificate or secrets failed (ticket 08, born from a feature's failure).
  'github-access',
  'codex-login',
  'browser-profile',
  'linked-machine',
])
export type CheckId = z.infer<typeof checkIdSchema>

/**
 * What a check's button does. main runs `harness-install` (the Harness plugin and its missing
 * dependencies, one dialog) and the `qmd-*` actions itself after its dialog; `gh-login` is
 * confirmed by main and then typed into a Terminal Node by the screen;
 * `migration-form` only opens the form of worfy-harness ticket 14, which asks on its own;
 * `limits-bridge` (Windows) points statusLine of Claude Code's settings.json at the Limits bridge;
 * `update-log` only asks `update.showLog` to open the log of the failed Update build ("Show log").
 * The buttons of worfy-auth-check, declared at once (ticket 03) and wired by the Tickets of their
 * rows: `use-login` ("Use <login>", writes `github.account`, ticket 05), `open-link` (the SSO link,
 * ticket 06), `codex-sign-in` ("Sign in to Codex…"), `open-browser` ("Open Browser") and
 * `link-machine` ("Link a machine…", ticket 08).
 */
export const firstRunActionSchema = z.enum([
  'harness-install',
  'migration-form',
  'qmd-install',
  'qmd-models-download',
  'qmd-models-skip',
  'qmd-collections',
  'gh-login',
  'limits-bridge',
  'update-log',
  'use-login',
  'open-link',
  'codex-sign-in',
  'open-browser',
  'link-machine',
])
export type FirstRunAction = z.infer<typeof firstRunActionSchema>

/**
 * The actions main runs through `firstRun.run`: not the move form and "Show log", which the screen
 * handles itself, and not yet the buttons of worfy-auth-check that the Tickets of their rows add
 * (`use-login` is wired, ticket 05).
 */
export const runnableActionSchema = firstRunActionSchema.exclude(['migration-form', 'update-log', 'open-link', 'codex-sign-in', 'open-browser', 'link-machine'])

/** A GitHub login as `github.account` takes it (src/main/workflow/profile.ts): never one gh could read as an option. */
export const githubLoginSchema = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/u)
export type RunnableAction = z.infer<typeof runnableActionSchema>

/**
 * `Projects` holds the rows of a Project (GitHub access, a Browser profile), `Codex` the Codex
 * sign-in, `Linked machines` a Linked machine's row (worfy-auth-check ticket 03).
 */
export const checkGroupSchema = z.enum(['Claude Code', 'Windows', 'Command-line tools', 'GitHub', 'worfy', 'Harness', 'qmd', 'Projects', 'Codex', 'Linked machines'])
export type CheckGroup = z.infer<typeof checkGroupSchema>

/**
 * How much a row matters (spec: the levels table): `critical` — the main work does not go without it;
 * `non-critical` — a feature degrades. The table is src/shared/health/severity.ts.
 */
export const severitySchema = z.enum(['critical', 'non-critical'])
export type Severity = z.infer<typeof severitySchema>

/** The Project a row speaks for: rows of the `Projects` group and the messages of a Project's features. */
export const checkProjectSchema = z.object({ id: z.string().min(1).max(200), name: z.string().max(200) })
export type CheckProject = z.infer<typeof checkProjectSchema>

export const checkSchema = z.object({
  id: checkIdSchema,
  group: checkGroupSchema,
  title: z.string(),
  status: checkStatusSchema,
  severity: severitySchema,
  /** The Project of the row; none for a row of the Machine. */
  project: checkProjectSchema.optional(),
  /** What was found: a version, an account, "not found". */
  detail: z.string(),
  /** One line: what to do; empty when there is nothing to do. */
  hint: z.string(),
  /** A command the user runs themselves (`brew install jq`, `claude update`); the screen offers to copy it. */
  command: z.string().nullable(),
  /**
   * The buttons of the row, with their labels. `safe`: the button only does what can be undone and
   * touches nobody else's data (spec: the repair) — the row is `fixable` then.
   */
  actions: z.array(
    z.object({
      id: firstRunActionSchema,
      label: z.string(),
      safe: z.literal(true).optional(),
      /** `use-login` only: the login the button writes to `github.account`, sent back to main as it was shown. */
      login: githubLoginSchema.optional(),
    }),
  ),
  /**
   * `false`: a `fail` of this row does not open First run by itself at the start (worfy-update spec
   * R9) — "worfy version" and the Harness behind this build, whose signal at the start is a toast;
   * and every row of a Project and every row a feature's message made (worfy-auth-check, Q7): First
   * run is for setting the Machine up, a later break is told by the Health check icon.
   */
  opensFirstRun: z.literal(false).optional(),
})
export type Check = z.infer<typeof checkSchema>

/**
 * What the row asks of the user (spec: the solution, point 2): `ok`; `unknown` — it could not be checked;
 * `fixable` — a `safe` button fixes it; `needs-user` — a step for the person.
 */
export type CheckState = 'ok' | 'unknown' | 'fixable' | 'needs-user'

export function checkState(check: Pick<Check, 'status' | 'actions'>): CheckState {
  if (check.status === 'ok' || check.status === 'unknown') return check.status
  return check.actions.some((each) => each.safe === true) ? 'fixable' : 'needs-user'
}

export const firstRunReportSchema = z.object({
  checks: z.array(checkSchema),
  /** ISO time the checks finished. */
  checkedAt: z.string(),
})
export type FirstRunReport = z.infer<typeof firstRunReportSchema>

/**
 * Whether the screen opens by itself at start: when worfy's data folder has no mark that the
 * screen was closed once, or when a check fails that did not fail when it was last closed (a row
 * with `opensFirstRun: false` does not count).
 */
export const firstRunStartup = invokeChannel(
  'firstRun.startup',
  z.void(),
  z.object({
    show: z.boolean(),
    /**
     * The first start of a new user (worfy-onboarding ticket 08, decision 8): no mark, and Getting
     * started's user is `new`. The screen opens on the page of the three concepts then.
     */
    firstTime: z.boolean(),
    /** The checks, when main ran them to decide; null when it did not need to. */
    report: firstRunReportSchema.nullable(),
  }),
  'local',
)

/** Runs every check again; writes nothing. */
export const firstRunChecks = invokeChannel('firstRun.checks', z.void(), firstRunReportSchema, 'local')

/**
 * The last Health check report with the features' messages merged in, without checking anything;
 * null before the first check and the first message (worfy-auth-check ticket 03).
 */
export const firstRunHealth = invokeChannel('firstRun.health', z.void(), firstRunReportSchema.nullable(), 'local')

/**
 * The Health check report changed: a check, a row checked over the network after the start, a
 * feature's message of a failure or a success (src/main/first-run/health-reports.ts). The whole
 * merged report.
 */
export const firstRunReportChanged = eventChannel('firstRun.reportChanged', firstRunReportSchema, 'local')

/**
 * One action: main shows the dialog naming the command, the folder and the download, and runs it
 * only on "Confirm". `declined` — nothing ran; `done` — it ran; `failed` — it ran and failed, and
 * the row of its check is `fail` with the error until the next attempt; `confirmed` — `gh-login`
 * only: the screen types the command into a Terminal Node now. The checks run again after a run.
 */
export const firstRunRun = invokeChannel(
  'firstRun.run',
  z.object({
    action: runnableActionSchema,
    /** The Project whose Canvas gets the Terminal Node (`gh-login`); named in the dialog. */
    projectName: z.string().min(1).max(200).optional(),
    /** `use-login`: the Project of the row, whose Profile gets `github.account`. */
    projectId: z.string().min(1).max(200).optional(),
    /** `use-login`: the login the button showed; main writes it only while it is still the one login that may push. */
    login: githubLoginSchema.optional(),
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
    'firstRun.health': typeof firstRunHealth
    'firstRun.reportChanged': typeof firstRunReportChanged
    'firstRun.run': typeof firstRunRun
    'firstRun.close': typeof firstRunClose
  }
}

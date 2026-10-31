// The `update` domain (worfy-update epic, ADR-0089): whether a newer `main` is there for the Stable
// copy, its build in worfy's own clone (ticket 03), and from ticket 04 on the restart and the roll back. Main keeps the state in
// `<dataRoot>/update/state.json` (src/main/update/state.ts) and sends the whole snapshot on each
// change. Every channel is `local`: each Machine updates its own Stable copy, and a Linked machine
// never sees this one's.
import { z } from 'zod'
import { eventChannel, invokeChannel } from './channels'

const sha = z.string().regex(/^[0-9a-f]{7,40}$/u)
/** A build number (scripts/build-version.ts, buildNumber): the commits from the start of the history. */
const buildNumberSchema = z.number().int().positive()

/** The repository the Stable copy updates from: GitHub's API (src/main/update/github.ts) and its pages ("What's new"). */
export const UPDATE_REPO = 'IDSAD-XL/worfy'
/** Its page on github.com; the PRs and the comparisons of "What's new" lie under it. */
export const UPDATE_REPO_PAGE = `https://github.com/${UPDATE_REPO}`

/** The last check: done (`ok`) or skipped (no network, GitHub refused or failed) with the reason. */
export const updateLastCheckSchema = z.object({
  at: z.iso.datetime(),
  result: z.enum(['ok', 'skipped']),
  reason: z.string().optional(),
})
export type UpdateLastCheck = z.infer<typeof updateLastCheckSchema>

/**
 * A newer head of `main` with a green `ci-ok` that changes the app or the Harness. `version` is
 * `<package.json version on that commit>+<7 characters of the SHA>`. `quiet`: it is the commit the
 * user rolled back from, so the signals of tickets 03, 06 and 07 stay silent until the next commit.
 * `number`: its build number (ticket 14), the number of the copy that runs plus GitHub's `ahead_by`;
 * absent when either is not known, and the texts then name `version`.
 */
export const availableUpdateSchema = z.object({ sha, version: z.string().min(1), quiet: z.boolean(), number: buildNumberSchema.optional() })
export type AvailableUpdate = z.infer<typeof availableUpdateSchema>

/** The build of an Update in worfy's own clone (ticket 03). */
export const updateBuildSchema = z.object({
  phase: z.enum(['idle', 'building', 'ready', 'failed']),
  sha: sha.optional(),
  version: z.string().optional(),
  appPath: z.string().optional(),
  log: z.string().optional(),
  /** The tools the build needs and did not find (git, node, pnpm). */
  missing: z.array(z.string()).optional(),
})

/**
 * The commit and the build version of the copy that runs. `commit` is a full or a short SHA.
 * `number`: its build number (ticket 14), absent for a build without one.
 */
export const updateRunningSchema = z.object({ commit: z.string(), version: z.string(), number: buildNumberSchema.optional() })
export type UpdateRunning = z.infer<typeof updateRunningSchema>

/**
 * The whole state of the epic; the later tickets fill in their fields. Every field has its empty
 * value, so a file that lacks one still reads.
 */
export const updateStateSchema = z.object({
  lastCheck: updateLastCheckSchema.nullable().default(null),
  available: availableUpdateSchema.nullable().default(null),
  build: updateBuildSchema.default({ phase: 'idle' }),
  /** Nothing works: no Session in a turn, no Autopilot run (ticket 04, spec R6). */
  idle: z.boolean().default(false),
  /** The copy kept as worfy-stable.previous (tickets 02, 04), with its build number when known (ticket 14). */
  previous: z.object({ version: z.string(), number: buildNumberSchema.optional() }).nullable().default(null),
  /** The SHA the user rolled back from (ticket 04): its Update is quiet. */
  rolledBackFrom: z.string().nullable().default(null),
  /** The installed Harness is behind the one of this copy (ticket 05). */
  harnessBehind: z.object({ from: z.string(), to: z.string() }).nullable().default(null),
  running: updateRunningSchema.nullable().default(null),
  /**
   * How the last restart into an Update ended (ticket 04). `at`: when that restart was asked
   * (restart.json), so two equal results of two restarts stay two (ticket 07's toast).
   */
  lastRestart: z
    .object({ ok: z.boolean(), action: z.string(), version: z.string(), reason: z.string().optional(), at: z.iso.datetime().optional() })
    .nullable()
    .default(null),
  /** The Harness of the new copy was not installed after the restart (ticket 05). */
  harnessAfterUpdate: z.literal('failed').nullable().default(null),
})
export type UpdateState = z.output<typeof updateStateSchema>

/**
 * What a window sees: the state, whether Update is on for this copy (only the packaged Stable copy,
 * or WORFY_UPDATE=1; spec R1), whether a check runs now and whether "Restart when idle" waits (ticket
 * 04; kept in memory only: a wish of this run, not of the next). `current`: the build version and
 * the build number of this run (ticket 14), only when it has a number; unlike `running`, which the
 * last check wrote, it is never a copy of an earlier run, so the texts of the first start after a
 * restart name the new copy by its number.
 */
export const updateSnapshotSchema = updateStateSchema.extend({
  enabled: z.boolean(),
  checking: z.boolean(),
  restartWhenIdle: z.boolean().default(false),
  current: z.object({ version: z.string().min(1), number: buildNumberSchema }).optional(),
})
export type UpdateSnapshot = z.output<typeof updateSnapshotSchema>

/** The snapshot now; the window then follows `update.changed`. */
export const updateStateChannel = invokeChannel('update.state', z.void(), updateSnapshotSchema, 'local')

/** Checks now ("Check now"); a check that runs already is the one answered. Answers the snapshot after it. */
export const updateCheck = invokeChannel('update.check', z.void(), updateSnapshotSchema, 'local')

/**
 * Builds the Available update in worfy's own clone ("Update worfy", ticket 03): again after a
 * failure, not when it is built already or building. Answers the snapshot at once, with the build
 * begun; its end comes as `update.changed`.
 */
export const updateInstall = invokeChannel('update.install', z.void(), updateSnapshotSchema, 'local')

/** Opens build.log of the last build with the program of the system ("Show log"); fails when there is none. */
export const updateShowLog = invokeChannel('update.showLog', z.void(), z.void(), 'local')

/**
 * What a restart button answers (ticket 04): worfy quits now (`quitting`), "Restart when idle" waits
 * (`waiting`), the wish or the roll back was cancelled, or a refusal with its reason. `busy`: refused
 * because a Session works or Autopilot runs.
 */
export const restartAnswerSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('quitting') }),
  z.object({ outcome: z.literal('waiting') }),
  z.object({ outcome: z.literal('cancelled') }),
  z.object({ outcome: z.literal('refused'), reason: z.string(), busy: z.boolean().optional() }),
])
export type RestartAnswer = z.infer<typeof restartAnswerSchema>

/**
 * "Restart now" (`now`, only when nothing works and an Update is built), "Restart when idle" (`idle`:
 * now when nothing works, else once nothing works) and the cancel of that wish (`cancel`). A press
 * of "Restart now" drops the wish too. The press is the consent to the Harness of the new copy
 * (spec R5).
 */
export const updateRestart = invokeChannel('update.restart', z.object({ when: z.enum(['now', 'idle', 'cancel']) }), restartAnswerSchema, 'local')

/** "Roll back to previous version": a native dialog asks first (spec R8); `cancelled` when it was said no. */
export const updateRollback = invokeChannel('update.rollback', z.void(), restartAnswerSchema, 'local')

/** One PR of "What's new": its title, as GitHub has it (text to show as text only), and its number. */
export const whatsNewItemSchema = z.object({ title: z.string().min(1), number: z.number().int().positive() })
export type WhatsNewItem = z.infer<typeof whatsNewItemSchema>

/**
 * "What's new" (ticket 10, spec R13): the PRs merged between the copy that runs and the new
 * `version`, newest first. `more`: the comparison gave all the commits it can (250), so there may be
 * more; `compareUrl` is its page on github.com.
 */
export const whatsNewSchema = z.object({
  version: z.string().min(1),
  items: z.array(whatsNewItemSchema),
  more: z.boolean(),
  compareUrl: z.string().startsWith('https://github.com/'),
})
export type WhatsNew = z.infer<typeof whatsNewSchema>

/**
 * The PRs between the copy that runs and the Available update (or the build that runs or is ready).
 * Fails with the reason: Update off, nothing to compare with, no network, GitHub refused.
 */
export const updateWhatsNew = invokeChannel('update.whatsNew', z.void(), whatsNewSchema, 'local')

/** The whole snapshot after a change. */
export const updateChanged = eventChannel('update.changed', updateSnapshotSchema, 'local')

declare module './channels' {
  interface IpcContract {
    'update.state': typeof updateStateChannel
    'update.check': typeof updateCheck
    'update.install': typeof updateInstall
    'update.showLog': typeof updateShowLog
    'update.restart': typeof updateRestart
    'update.rollback': typeof updateRollback
    'update.whatsNew': typeof updateWhatsNew
    'update.changed': typeof updateChanged
  }
}

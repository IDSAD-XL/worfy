// The `update` domain (worfy-update epic, ADR-0089): whether a newer `main` is there for the Stable
// copy, and, from ticket 03 on, its build, the restart and the roll back. Main keeps the state in
// `<dataRoot>/update/state.json` (src/main/update/state.ts) and sends the whole snapshot on each
// change. Every channel is `local`: each Machine updates its own Stable copy, and a Linked machine
// never sees this one's.
import { z } from 'zod'
import { eventChannel, invokeChannel } from './channels'

const sha = z.string().regex(/^[0-9a-f]{7,40}$/u)

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
 */
export const availableUpdateSchema = z.object({ sha, version: z.string().min(1), quiet: z.boolean() })
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

/** The commit and the build version of the copy that runs. `commit` is a full or a short SHA. */
export const updateRunningSchema = z.object({ commit: z.string(), version: z.string() })

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
  /** The copy kept as worfy-stable.previous (tickets 02, 04). */
  previous: z.object({ version: z.string() }).nullable().default(null),
  /** The SHA the user rolled back from (ticket 04): its Update is quiet. */
  rolledBackFrom: z.string().nullable().default(null),
  /** The installed Harness is behind the one of this copy (ticket 05). */
  harnessBehind: z.object({ from: z.string(), to: z.string() }).nullable().default(null),
  running: updateRunningSchema.nullable().default(null),
  /** How the last restart into an Update ended (ticket 04). */
  lastRestart: z.object({ ok: z.boolean(), action: z.string(), version: z.string(), reason: z.string().optional() }).nullable().default(null),
  /** The Harness of the new copy was not installed after the restart (ticket 05). */
  harnessAfterUpdate: z.literal('failed').nullable().default(null),
})
export type UpdateState = z.output<typeof updateStateSchema>

/**
 * What a window sees: the state, whether Update is on for this copy (only the packaged Stable copy,
 * or WORFY_UPDATE=1; spec R1) and whether a check runs now.
 */
export const updateSnapshotSchema = updateStateSchema.extend({ enabled: z.boolean(), checking: z.boolean() })
export type UpdateSnapshot = z.output<typeof updateSnapshotSchema>

/** The snapshot now; the window then follows `update.changed`. */
export const updateStateChannel = invokeChannel('update.state', z.void(), updateSnapshotSchema, 'local')

/** Checks now ("Check now"); a check that runs already is the one answered. Answers the snapshot after it. */
export const updateCheck = invokeChannel('update.check', z.void(), updateSnapshotSchema, 'local')

/** The whole snapshot after a change. */
export const updateChanged = eventChannel('update.changed', updateSnapshotSchema, 'local')

declare module './channels' {
  interface IpcContract {
    'update.state': typeof updateStateChannel
    'update.check': typeof updateCheck
    'update.changed': typeof updateChanged
  }
}

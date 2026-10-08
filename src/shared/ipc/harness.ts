// The `harness` domain (worfy-harness ticket 13, ADR-0040, ADR-0048): whether the Harness of this
// build is installed as the Claude Code plugin `worfy`, and the action that installs or updates it
// after the user agrees in a native dialog. Main reads and writes through src/main/harness/install.ts;
// the toolbar item is src/renderer/shell/toolbar/HarnessStatus.tsx, and the first-run screen
// (ticket 19) takes the same two channels.
import { z } from 'zod'
import { invokeChannel } from './channels'

/** The step an install failed at: the copy of the Harness, or one `claude plugin` command. */
export const harnessStepSchema = z.enum(['copy', 'marketplace add', 'install', 'update', 'plugin list'])
export type HarnessStep = z.infer<typeof harnessStepSchema>

export const harnessStateSchema = z.discriminatedUnion('kind', [
  /** No copy in <harnessHome>/plugin/, or Claude Code does not list the plugin. */
  z.object({ kind: z.literal('not-installed') }),
  /** The copy and the plugin Claude Code lists carry the version of this build. */
  z.object({ kind: z.literal('installed'), version: z.string(), enabled: z.boolean() }),
  /** Installed with another version (`from`; null when Claude Code names none): an update would bring `to`. */
  z.object({ kind: z.literal('outdated'), from: z.string().nullable(), to: z.string() }),
  /** A step failed, or Claude Code reports the plugin broken (a missing dependency); `reason` ends with its stderr. */
  z.object({ kind: z.literal('error'), step: harnessStepSchema, reason: z.string() }),
])
export type HarnessState = z.infer<typeof harnessStateSchema>

export const harnessStatusSchema = z.object({
  state: harnessStateSchema,
  /** The `version` of the Harness copy this build carries; null when the build has none. */
  bundledVersion: z.string().nullable(),
  /**
   * Whether this run may install: a packaged app, or any run with WORFY_CLAUDE_HOME (a test
   * sandbox). A dev run on the real ~/.claude only shows the state.
   */
  canInstall: z.boolean(),
  /** <harnessHome>/plugin, where the copy goes. */
  pluginDir: z.string(),
})
export type HarnessStatus = z.infer<typeof harnessStatusSchema>

/** Reads the state; writes nothing. */
export const harnessState = invokeChannel('harness.state', z.void(), harnessStatusSchema, 'local')

/**
 * Installs or updates the Harness after the dialog in main: `declined` — the user said no and
 * nothing was written; `nothing-to-do` — already the version of this build, no dialog shown.
 */
export const harnessInstall = invokeChannel(
  'harness.install',
  z.void(),
  z.object({ outcome: z.enum(['done', 'declined', 'nothing-to-do']), status: harnessStatusSchema }),
  'local',
)

declare module './channels' {
  interface IpcContract {
    'harness.state': typeof harnessState
    'harness.install': typeof harnessInstall
  }
}

// The `harness` domain (worfy-harness tickets 13 and 30; ADR-0040, ADR-0048, ADR-0059): whether the
// Harness of this build is installed as the Claude Code plugin `worfy`, with the plugins it depends
// on, and the action that installs or updates them after the user agrees in a native dialog. Main
// reads and writes through src/main/harness/install.ts; the toolbar item is
// src/renderer/shell/toolbar/HarnessStatus.tsx, and the first-run screen (ticket 19) takes the same
// two channels. Both are `local`: the install writes the Claude home of the machine the window runs
// on, and a Linked machine cannot start it.
import { z } from 'zod'
import { invokeChannel } from './channels'

/**
 * The step an install failed at: the copy of the Harness, or one `claude plugin` command. The
 * `dependency …` steps are the commands for a plugin the Harness depends on; `uninstall` removes
 * the record a failed first `install` left behind.
 */
export const harnessStepSchema = z.enum(['copy', 'marketplace add', 'install', 'update', 'plugin list', 'dependency marketplace add', 'dependency install', 'uninstall'])
export type HarnessStep = z.infer<typeof harnessStepSchema>

export const harnessStateSchema = z.discriminatedUnion('kind', [
  /** No copy in <harnessHome>/plugin/, or Claude Code does not list the plugin. */
  z.object({ kind: z.literal('not-installed') }),
  /** The copy and the plugin Claude Code lists carry the version of this build. */
  z.object({ kind: z.literal('installed'), version: z.string(), enabled: z.boolean() }),
  /** Installed with another version (`from`; null when Claude Code names none): an update would bring `to`. */
  z.object({ kind: z.literal('outdated'), from: z.string().nullable(), to: z.string() }),
  /**
   * A step failed (`reason` ends with its stderr), Claude Code reports the plugin broken, or the
   * plugin is installed without a dependency (`dependency install`, with its name): the install
   * action then installs what is missing.
   */
  z.object({ kind: z.literal('error'), step: harnessStepSchema, reason: z.string() }),
])
export type HarnessState = z.infer<typeof harnessStateSchema>

/** A plugin the Harness depends on (`dependencies` of the build's plugin.json), as `claude plugin list` shows it. */
export const harnessDependencySchema = z.object({
  /** As plugin.json names it: `name@marketplace`. */
  id: z.string(),
  /** `unchecked` — the list was not read: there is no plugin folder yet, or reading it failed. */
  status: z.enum(['installed', 'missing', 'unchecked']),
  /** The version Claude Code lists; null when it names none or the dependency is not installed. */
  version: z.string().nullable(),
})
export type HarnessDependency = z.infer<typeof harnessDependencySchema>

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
  /** The dependencies of the Harness, in plugin.json's order; from the same `plugin list` as the state. */
  dependencies: z.array(harnessDependencySchema),
})
export type HarnessStatus = z.infer<typeof harnessStatusSchema>

/** Reads the state; writes nothing. */
export const harnessState = invokeChannel('harness.state', z.void(), harnessStatusSchema, 'local')

/**
 * Installs or updates the Harness and its missing dependencies after the dialog in main: `declined`
 * — the user said no and nothing was written; `nothing-to-do` — already the version of this build
 * with its dependencies, no dialog shown.
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

// The `harness` domain (worfy-harness tickets 13, 30 and 40; ADR-0040, ADR-0048, ADR-0059): whether
// the Harness of this build is installed as the Claude Code plugin `worfy`, with the plugins it
// depends on, and the action that installs or updates them after the user agrees in a native dialog.
// Main reads and writes through src/main/harness/install.ts, with one installer for the app
// (appInstaller in src/main/ipc/harness.ts). The toolbar item (src/renderer/shell/toolbar/HarnessStatus.tsx)
// reads `harness.state` and installs through `harness.install`; the first-run screen installs
// through its own `firstRun.run` (src/shared/ipc/first-run.ts), which calls the same installer.
// Every install that answers `done`, from either place, reaches every window as `harness.changed`,
// so no window keeps a stale state. All three are `local`: the install writes the Claude home of
// the machine the window runs on, and a Linked machine cannot start it.
import { z } from 'zod'
import { eventChannel, invokeChannel } from './channels'

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
  /**
   * Installed with another version (`from`; null when Claude Code names none): an update would bring `to`.
   * `sameVersion` — the same semver from another commit (worfy-harness ticket 67): worfy cannot tell
   * which one is newer, so the action replaces it rather than updates it.
   */
  z.object({ kind: z.literal('outdated'), from: z.string().nullable(), to: z.string(), sameVersion: z.boolean() }),
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

/**
 * The step an install into Codex failed at (worfy-multi-vendor ticket 35): one `codex plugin`
 * command, or writing the Codex agents (`worfy-*.toml` in <CODEX_HOME>/agents).
 */
export const codexHarnessStepSchema = z.enum(['plugin list', 'marketplace add', 'plugin add', 'dependency marketplace add', 'dependency add', 'agents'])
export type CodexHarnessStep = z.infer<typeof codexHarnessStepSchema>

export const codexHarnessStateSchema = z.discriminatedUnion('kind', [
  /** Codex does not list the plugin worfy. */
  z.object({ kind: z.literal('not-installed') }),
  /** Codex lists it with this build's version, its dependencies too, and the agents are this build's. */
  z.object({ kind: z.literal('installed'), version: z.string() }),
  /** Another version (`from`; null when Codex names none), or agents of another build: an install brings `to`. */
  z.object({ kind: z.literal('outdated'), from: z.string().nullable(), to: z.string() }),
  /** A step failed (`reason` ends with the command's output), or a dependency is not installed. */
  z.object({ kind: z.literal('error'), step: codexHarnessStepSchema, reason: z.string() }),
])
export type CodexHarnessState = z.infer<typeof codexHarnessStateSchema>

/**
 * Whether a Vendor runs the hooks of the Harness now (worfy-multi-vendor ticket 39): Codex keeps a
 * plugin's hooks off after each install or update until the user approves them in Codex (`/hooks`).
 * `unknown`: worfy could not tell — the Vendor did not answer, its answer is one worfy does not know,
 * or it lists no hook of the Harness — and that never counts as approved.
 */
export const harnessHooksTrustSchema = z.enum(['approved', 'not-approved', 'unknown'])
export type HarnessHooksTrust = z.infer<typeof harnessHooksTrustSchema>

/** The Harness in Codex, next to the one in Claude Code; the same Install installs both. */
export const codexHarnessSchema = z.object({
  state: codexHarnessStateSchema,
  /** <CODEX_HOME>/agents, where the agents worfy-implementer, worfy-reviewer and worfy-scout go. */
  agentsDir: z.string(),
  /**
   * This run installed or updated the plugin in Codex, and no check since found its hooks approved:
   * Codex keeps them off until the user approves them in Codex (`/hooks`). The toolbar then shows the
   * step "Approve the Harness hooks in Codex" (worfy-multi-vendor ticket 39).
   */
  hooksToApprove: z.boolean(),
  /**
   * Agent files of the Harness worfy does not write, as a file of the user's own (one without
   * worfy's mark) has the name: `worfy-implementer.toml` and the like. worfy never writes over it.
   */
  skippedAgents: z.array(z.string()),
})
export type CodexHarness = z.infer<typeof codexHarnessSchema>

/**
 * What the dialog and the toolbar say of the agent files worfy does not write (codexAgentsDrift's
 * `skipped`): a file of the user's own has the name, and worfy never writes over it.
 */
export function skippedAgentsText(skipped: readonly string[], agentsDir: string): string {
  const one = skipped.length === 1
  return `worfy leaves ${skipped.join(', ')} in ${agentsDir} as ${one ? 'it is' : 'they are'}: ${one ? 'it is a file' : 'they are files'} of your own, not ${one ? 'one' : 'ones'} worfy wrote. To get ${one ? 'that agent' : 'those agents'} of the Harness in Codex, rename or remove ${one ? 'it' : 'them'}, then install again.`
}

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
  /** The Harness in Codex; absent when this build has no Codex or Codex never ran on this machine (no CODEX_HOME). */
  codex: codexHarnessSchema.optional(),
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

/**
 * Sent to every window after an install answers `done` — installed, or failed with the error in the
 * state — whichever window or screen started it; not after `declined` or `nothing-to-do`. The
 * payload is the status the install answered.
 */
export const harnessChanged = eventChannel('harness.changed', harnessStatusSchema, 'local')

/**
 * "Check again" of the step "Approve the Harness hooks in Codex": asks Codex (`hooks/list`) whether
 * the hooks of the Harness are approved now. Once they are, the status no longer has hooks to approve,
 * and every window gets it as `harness.changed`. Writes nothing.
 */
export const harnessCodexHooks = invokeChannel('harness.codexHooks', z.void(), z.object({ trust: harnessHooksTrustSchema, status: harnessStatusSchema }), 'local')

declare module './channels' {
  interface IpcContract {
    'harness.codexHooks': typeof harnessCodexHooks
    'harness.state': typeof harnessState
    'harness.install': typeof harnessInstall
    'harness.changed': typeof harnessChanged
  }
}

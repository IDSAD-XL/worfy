// Which Harness is on the machine, and where its scripts and its Gate state are (worfy-harness
// ticket 12; ADR-0040, ADR-0049):
//
// - `plugin` — <harnessHome>/plugin/.claude-plugin/plugin.json names the plugin `worfy` and
//   <harnessHome>/plugin/bin/epic-status is there. Scripts: <harnessHome>/plugin/bin/, Gate state:
//   <harnessHome>/gate/.
// - `legacy` — <claudeHome>/bin/epic-status is there: the Harness from before the plugin. Scripts:
//   <claudeHome>/bin/, Gate state: <claudeHome>/gate/. When both are there the old one wins: its
//   hooks are still written in ~/.claude/settings.json, and the plugin's hooks would run a second
//   time (ADR-0049). The move (ticket 14) takes the old files away, and the next call finds `plugin`.
// - `none` — neither. Reading goes where it went before the plugin (<claudeHome>/bin/,
//   <claudeHome>/gate/) and finds nothing; `checked` names both scripts that were looked for.
//
// Nothing is cached: every call looks again, so a machine that switches to the plugin is seen
// without a restart. Nothing here writes.
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HarnessKind } from '../../shared/projects/action-templates'
import { claudeHome as defaultClaudeHome, harnessHome as defaultHarnessHome } from '../storage/paths'

export type { HarnessKind }

/** The name of the Harness plugin (ADR-0040, Q2): its skills are `/worfy:epic-wave`, `/worfy:ship-ticket`. */
export const HARNESS_PLUGIN_NAME = 'worfy'

export interface HarnessHomes {
  /** Claude Code's home (claudeHome()). */
  claudeHome: string
  /** The Harness home (harnessHome()). */
  harnessHome: string
}

export interface HarnessLocation {
  kind: HarnessKind
  /** The folder of the Harness scripts (`epic-status`, `profile`). */
  binDir: string
  /** The folder with the Gate registry (`config.json`) and its state (`state/`). */
  gateDir: string
  /** The Harness home looked in; the scripts of the plugin get it as HARNESS_HOME. */
  harnessHome: string
  /** The two `epic-status` scripts looked for, the old Harness's first. */
  checked: [legacy: string, plugin: string]
}

/** Whether `path` is a file. Whether it may be run is the runner's question: it answers `not-found`. */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** Whether `<pluginDir>/.claude-plugin/plugin.json` is a JSON object whose `name` is `worfy`. */
function isWorfyPlugin(pluginDir: string): boolean {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'))
    return typeof manifest === 'object' && manifest !== null && (manifest as { name?: unknown }).name === HARNESS_PLUGIN_NAME
  } catch {
    return false
  }
}

/** Which Harness is under these homes; see the header of this file. */
export function locateHarness(homes: HarnessHomes): HarnessLocation {
  const legacyBin = join(homes.claudeHome, 'bin')
  const pluginDir = join(homes.harnessHome, 'plugin')
  const pluginBin = join(pluginDir, 'bin')
  const checked: HarnessLocation['checked'] = [join(legacyBin, 'epic-status'), join(pluginBin, 'epic-status')]
  const legacy = { binDir: legacyBin, gateDir: join(homes.claudeHome, 'gate'), harnessHome: homes.harnessHome, checked }
  if (isFile(checked[0])) return { kind: 'legacy', ...legacy }
  if (isFile(checked[1]) && isWorfyPlugin(pluginDir)) {
    return { kind: 'plugin', binDir: pluginBin, gateDir: join(homes.harnessHome, 'gate'), harnessHome: homes.harnessHome, checked }
  }
  return { kind: 'none', ...legacy }
}

/**
 * The homes the app looks in: `claudeHome` as given, the Harness home from WORFY_HARNESS_HOME or
 * in that Claude home. A reader handed a temporary Claude home thus looks for the plugin in it too.
 */
export function harnessHomes(claudeHome: string, env: NodeJS.ProcessEnv = process.env): HarnessHomes {
  return { claudeHome, harnessHome: defaultHarnessHome(env, claudeHome) }
}

/** The Harness of the app's own homes: WORFY_CLAUDE_HOME (or ~/.claude) and WORFY_HARNESS_HOME. */
export function currentHarness(env: NodeJS.ProcessEnv = process.env): HarnessLocation {
  return locateHarness(harnessHomes(defaultClaudeHome(env), env))
}

/**
 * The environment a Harness script runs with: `base` as it is for the old Harness and for none,
 * plus HARNESS_HOME for the plugin (worfy-harness ticket 08: its scripts find the state, the
 * Profiles and the language there).
 */
export function scriptEnv(location: HarnessLocation, base: Readonly<Record<string, string | undefined>>): Record<string, string | undefined> {
  return location.kind === 'plugin' ? { ...base, HARNESS_HOME: location.harnessHome } : { ...base }
}

/**
 * The gate registry files `bin/profile` may read, in its order (harness/bin/profile, `CFG` and
 * `gateConfig`): only the file CLAUDE_GATE_CONFIG names when that is set; otherwise
 * <HARNESS_HOME>/gate/config.json, then the old <home>/.claude/gate/config.json, which it reads
 * while the new one is missing. `env` is the script's environment (scriptEnv): its HARNESS_HOME,
 * and its home folder as node's os.homedir() takes it there — USERPROFILE on Windows, HOME
 * elsewhere. No file of the list on disk means the Harness has no registry yet (worfy-windows
 * ticket 30, profileKnows).
 */
export function profileRegistryFiles(env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform = process.platform): string[] {
  const named = env.CLAUDE_GATE_CONFIG
  if (named) return [named]
  const claude = join((platform === 'win32' ? env.USERPROFILE : env.HOME) || homedir(), '.claude')
  return [join(env.HARNESS_HOME || join(claude, 'worfy-harness'), 'gate', 'config.json'), join(claude, 'gate', 'config.json')]
}

/** "not found" text naming both scripts looked for. */
export function notFoundPaths(location: HarnessLocation, script: string): string {
  return location.checked.map((path) => join(path, '..', script)).join(' or ')
}

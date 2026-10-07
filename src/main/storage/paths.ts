import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

type Env = Readonly<Record<string, string | undefined>>

/** A packaged worfy.app, or a dev run of the unpacked bundle (`pnpm dev`, `electron .`). */
export type BuildKind = 'packaged' | 'dev'

// The packaged layout is the default, so code that runs before the entry point reports the
// build kind keeps the folder worfy has always used.
let currentBuildKind: BuildKind = 'packaged'

/**
 * Called once by src/main/index.ts from app.isPackaged, before anything reads dataRoot(). A dev
 * run then keeps its state apart from the stable copy that runs Autopilot over worfy itself.
 */
export function setBuildKind(kind: BuildKind): void {
  currentBuildKind = kind
}

/**
 * Root of worfy's own state (ADR 0005). The packaged app uses Application Support/worfy, a dev
 * run Application Support/worfy-dev, so both can run at once without sharing limits.json or
 * bindings.json. WORFY_DATA_DIR overrides either, so tests run against a temporary directory.
 * This module is the only place in the app that knows where worfy's data lives. The one copy
 * outside it is scripts/statusline-bridge.sh, a shell script that cannot import this module; it
 * writes to both default folders, and test/contract/statusline-bridge.test.ts derives them from
 * dataRoot(), so renaming a folder here fails that test until the script follows.
 */
export function dataRoot(env: Env = process.env, kind: BuildKind = currentBuildKind): string {
  const override = env.WORFY_DATA_DIR
  if (override) return resolve(override)
  return join(homedir(), 'Library', 'Application Support', kind === 'dev' ? 'worfy-dev' : 'worfy')
}

/**
 * Root of Claude Code's home directory, read but never written by worfy. WORFY_CLAUDE_HOME
 * overrides it, so tests run against a fixture directory.
 */
export function claudeHome(env: Env = process.env): string {
  const override = env.WORFY_CLAUDE_HOME
  return override ? resolve(override) : join(homedir(), '.claude')
}

/**
 * Root of the Harness on the machine (ADR-0040): the plugin in `plugin/`, the Gate registry and
 * state in `gate/`, the Profiles in `projects/`. Read but never written by worfy; the installer
 * (worfy-harness ticket 13) puts it there. WORFY_HARNESS_HOME overrides it; without it the folder
 * sits in the Claude home given (claudeHome() by default), so a test or e2e run with a temporary
 * WORFY_CLAUDE_HOME never sees the real ~/.claude/worfy-harness.
 */
export function harnessHome(env: Env = process.env, home: string = claudeHome(env)): string {
  const override = env.WORFY_HARNESS_HOME
  return override ? resolve(override) : join(home, 'worfy-harness')
}

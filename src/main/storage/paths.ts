import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

type Env = Readonly<Record<string, string | undefined>>

/**
 * Root of worfy's own state (ADR 0005). WORFY_DATA_DIR overrides it, so tests run against a
 * temporary directory. This module is the only place that knows where worfy's data lives.
 */
export function dataRoot(env: Env = process.env): string {
  const override = env.WORFY_DATA_DIR
  return override ? resolve(override) : join(homedir(), 'Library', 'Application Support', 'worfy')
}

/**
 * Root of Claude Code's home directory, read but never written by worfy. WORFY_CLAUDE_HOME
 * overrides it, so tests run against a fixture directory.
 */
export function claudeHome(env: Env = process.env): string {
  const override = env.WORFY_CLAUDE_HOME
  return override ? resolve(override) : join(homedir(), '.claude')
}

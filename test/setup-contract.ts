// The setup file of the `contract` project (vitest.config.ts). worfy takes Claude Code's home from
// WORFY_CLAUDE_HOME and, without it, from the user's ~/.claude (src/main/storage/paths.ts), where it
// reads the model and effort of settings.json, Sessions, transcripts and the Harness. A contract test
// that did not set the variable read the ~/.claude of the machine it ran on: with `model: haiku`
// there, tests went red on the owner's settings, not on the code. So every test file starts with a
// new empty Claude home of its own, removed after the file. A test that needs its own folder sets
// the variable itself, as before; a test of a run on the real ~/.claude (no sandbox) deletes it.
//
// The variable is set on process.env directly, not with vi.stubEnv: vi.unstubAllEnvs() in a test
// then puts back this folder, not an unset variable.
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'
import { removeTestTree } from './remove'

type Env = Record<string, string | undefined>

/** Prefix of the temporary Claude homes this file makes, under the system temp directory. */
export const CLAUDE_HOME_PREFIX = 'worfy-contract-claude-home-'

/**
 * Points WORFY_CLAUDE_HOME of `env` at a new empty temporary folder, unless it already names one
 * (empty counts as unset, as in claudeHome()). Returns the folder made and the cleanup that removes
 * it and unsets the variable if it still names that folder; null when the variable was set already.
 */
export function isolateClaudeHome(env: Env): { home: string; release: () => void } | null {
  if (env.WORFY_CLAUDE_HOME) return null
  const home = mkdtempSync(join(realpathSync(tmpdir()), CLAUDE_HOME_PREFIX))
  env.WORFY_CLAUDE_HOME = home
  return {
    home,
    release: () => {
      if (env.WORFY_CLAUDE_HOME === home) delete env.WORFY_CLAUDE_HOME
      removeTestTree(home)
    },
  }
}

/** The Claude home this setup made for the running test file; null when the run had set one. */
export const contractClaudeHome = isolateClaudeHome(process.env)

if (contractClaudeHome !== null) afterAll(contractClaudeHome.release)

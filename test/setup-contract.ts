// The setup file of the `contract` project (vitest.config.ts). worfy takes Claude Code's home from
// WORFY_CLAUDE_HOME and, without it, from the user's ~/.claude (src/main/storage/paths.ts), where it
// reads the model and effort of settings.json, Sessions, transcripts and the Harness. A contract test
// that did not set the variable read the ~/.claude of the machine it ran on: with `model: haiku`
// there, tests went red on the owner's settings, not on the code. So every test file starts with a
// new empty Claude home of its own, removed after the file. A test that needs its own folder sets
// the variable itself, as before; a test of a run on the real ~/.claude (no sandbox) deletes it.
//
// The homes lie in the folder of the run that test/global-setup-contract.ts makes and removes at the
// end: a file whose tests are all skipped runs no afterAll, and its home goes with that folder.
//
// The variable is set on process.env directly, not with vi.stubEnv: vi.unstubAllEnvs() in a test
// then puts back this folder, not an unset variable.
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, inject } from 'vitest'
import { removeTestTree } from './remove'

type Env = Record<string, string | undefined>

/** Prefix of the Claude home of a test file, inside the folder of the run. */
export const CLAUDE_HOME_PREFIX = 'claude-home-'

/**
 * Points WORFY_CLAUDE_HOME of `env` at a new empty folder inside `root`, unless it already names one
 * (empty counts as unset, as in claudeHome()). Returns the folder made and the cleanup that removes
 * it and unsets the variable if it still names that folder; null when the variable was set already.
 */
export function isolateClaudeHome(env: Env, root: string): { home: string; release: () => void } | null {
  if (env.WORFY_CLAUDE_HOME) return null
  const home = mkdtempSync(join(root, CLAUDE_HOME_PREFIX))
  env.WORFY_CLAUDE_HOME = home
  return {
    home,
    release: () => {
      if (env.WORFY_CLAUDE_HOME === home) delete env.WORFY_CLAUDE_HOME
      removeTestTree(home)
    },
  }
}

const isolated = isolateClaudeHome(process.env, inject('contractClaudeHomes'))
if (isolated !== null) afterAll(isolated.release)

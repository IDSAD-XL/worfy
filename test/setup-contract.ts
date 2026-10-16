// The setup file of the `contract` project (vitest.config.ts). worfy takes Claude Code's home from
// WORFY_CLAUDE_HOME and, without it, from the user's ~/.claude (src/main/storage/paths.ts), where it
// reads the model and effort of settings.json, Sessions, transcripts and the Harness. A contract test
// that did not set the variable read the ~/.claude of the machine it ran on: with `model: haiku`
// there, tests went red on the owner's settings, not on the code. So every test file starts with a
// new empty Claude home of its own, removed after the file. A test that needs its own folder sets
// the variable itself, as before; a test of a run on the real ~/.claude (no sandbox) deletes it.
//
// worfy's own data folder the same way (WORFY_DATA_DIR): without it, dataRoot() is the folder of the
// installed app (~/Library/Application Support/worfy — tests count as packaged), and a store that
// finds a file there it cannot read sets it aside. Every test file gets a new empty data folder of
// its own. And dataRoot() itself is guarded here: called with the process environment while
// WORFY_DATA_DIR is unset — a test deleted it — it throws instead of naming the real folder, and
// the test fails after it even when the code under test caught that throw (the reader of the
// autocompact window does). Called with an environment of the test's own
// (`dataRoot({}, 'packaged')`) it answers as in the app.
//
// The folders lie in the folder of the run that test/global-setup-contract.ts makes and removes at
// the end: a file whose tests are all skipped runs no afterAll, and its folders go with that one.
//
// The variables are set on process.env directly, not with vi.stubEnv: vi.unstubAllEnvs() in a test
// then puts back these folders, not an unset variable.
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, inject, vi } from 'vitest'
import { removeTestTree } from './remove'

type Env = Record<string, string | undefined>

/** Prefix of the Claude home of a test file, inside the folder of the run. */
export const CLAUDE_HOME_PREFIX = 'claude-home-'
/** Prefix of the worfy data folder of a test file, inside the folder of the run. */
export const DATA_DIR_PREFIX = 'data-dir-'

/** What a contract test gets from dataRoot() with the process environment and no WORFY_DATA_DIR. */
export const REAL_DATA_FOLDER_REFUSED = 'a contract test asked dataRoot() for worfy\'s real data folder: WORFY_DATA_DIR is unset'

type DataRoot = typeof import('../src/main/storage/paths').dataRoot

/** How many times dataRoot() refused the real data folder since the last takeRefusals(). */
let refusals = 0

/** The refusals so far, counted from zero again: a test that provokes one on purpose takes it. */
export function takeRefusals(): number {
  const taken = refusals
  refusals = 0
  return taken
}

/**
 * dataRoot() that refuses the real data folder: with the process environment (the default, as the
 * app's modules call it) and WORFY_DATA_DIR unset or empty it counts a refusal and throws
 * REAL_DATA_FOLDER_REFUSED; otherwise it answers as `dataRoot` does.
 */
export function guardDataRoot(dataRoot: DataRoot, env: Env = process.env): DataRoot {
  return (given = process.env, ...rest) => {
    if (given === env && !env.WORFY_DATA_DIR) {
      refusals += 1
      throw new Error(REAL_DATA_FOLDER_REFUSED)
    }
    return dataRoot(given, ...rest)
  }
}

vi.mock('../src/main/storage/paths', async (importOriginal) => {
  const paths = await importOriginal<typeof import('../src/main/storage/paths')>()
  return { ...paths, dataRoot: guardDataRoot(paths.dataRoot) }
})

/** Throws when dataRoot() refused the real folder since the last call, and counts from zero again. */
export function failOnRefusals(): void {
  const taken = takeRefusals()
  if (taken > 0) throw new Error(`${REAL_DATA_FOLDER_REFUSED} (${taken} time${taken === 1 ? '' : 's'} in this test)`)
}

// A refusal the code under test swallowed still fails the test it happened in.
afterEach(failOnRefusals)

/**
 * Points `variable` of `env` at a new empty folder named `<prefix>…` inside `root`, unless it
 * already names one (empty counts as unset). Returns the folder made and the cleanup that removes it
 * and unsets the variable if it still names that folder; null when the variable was set already.
 */
function isolateFolder(env: Env, root: string, variable: string, prefix: string): { folder: string; release: () => void } | null {
  if (env[variable]) return null
  const folder = mkdtempSync(join(root, prefix))
  env[variable] = folder
  return {
    folder,
    release: () => {
      if (env[variable] === folder) delete env[variable]
      removeTestTree(folder)
    },
  }
}

/**
 * Points WORFY_CLAUDE_HOME of `env` at a new empty folder inside `root`, unless it already names one
 * (empty counts as unset, as in claudeHome()). Returns the folder made and the cleanup that removes
 * it and unsets the variable if it still names that folder; null when the variable was set already.
 */
export function isolateClaudeHome(env: Env, root: string): { home: string; release: () => void } | null {
  const isolated = isolateFolder(env, root, 'WORFY_CLAUDE_HOME', CLAUDE_HOME_PREFIX)
  return isolated === null ? null : { home: isolated.folder, release: isolated.release }
}

/**
 * Points WORFY_DATA_DIR of `env` at a new empty folder inside `root`, unless it already names one
 * (empty counts as unset, as in dataRoot()); as isolateClaudeHome.
 */
export function isolateDataDir(env: Env, root: string): { dir: string; release: () => void } | null {
  const isolated = isolateFolder(env, root, 'WORFY_DATA_DIR', DATA_DIR_PREFIX)
  return isolated === null ? null : { dir: isolated.folder, release: isolated.release }
}

const isolated = isolateClaudeHome(process.env, inject('contractClaudeHomes'))
if (isolated !== null) afterAll(isolated.release)
const isolatedData = isolateDataDir(process.env, inject('contractClaudeHomes'))
if (isolatedData !== null) afterAll(isolatedData.release)

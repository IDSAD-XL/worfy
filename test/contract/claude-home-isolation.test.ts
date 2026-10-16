// Contract tests do not read the real ~/.claude: test/setup-contract.ts, the setup file of the
// `contract` project, gives every test file a new empty WORFY_CLAUDE_HOME of its own unless the run
// set one, inside the folder of the run that test/global-setup-contract.ts makes and removes. Nothing
// here reads or writes the real ~/.claude even when it fails: a home is listed only after it was
// checked to lie in the system temp directory, and isolateClaudeHome is called on plain objects and
// folders of the test's own, not on process.env.
//
// worfy's data folder likewise (WORFY_DATA_DIR): a folder of the run's own for every test file, and
// dataRoot() refuses the real one — the folder of the installed app — when a test has unset it.
//
// The setup module is imported only inside the tests that call it: importing it at the top would
// itself set the variable, and a run without the setup file would pass here.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { TestProject } from 'vitest/node'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import { dataRoot } from '../../src/main/storage/paths'
import setupRun, { CONTRACT_HOMES_PREFIX } from '../global-setup-contract'
import { removeTestTree } from '../remove'

/** WORFY_CLAUDE_HOME as this file found it when it started, before any test changed it. */
const AT_START = process.env.WORFY_CLAUDE_HOME
/** WORFY_DATA_DIR as this file found it when it started. */
const DATA_AT_START = process.env.WORFY_DATA_DIR

const TEMP = realpathSync(tmpdir())

type Isolated = { home: string; release: () => void } | null

/** isolateClaudeHome of the setup module, on an object and a folder of the test's own. */
async function isolateClaudeHome(env: Record<string, string | undefined>, root: string): Promise<Isolated> {
  return (await import('../setup-contract')).isolateClaudeHome(env, root)
}

/** The folder WORFY_CLAUDE_HOME named at the start, once it is known to be a temporary one and not ~/.claude. */
function sandboxHome(): string {
  const value = AT_START
  expect(value, 'WORFY_CLAUDE_HOME is set for a contract test').toBeTruthy()
  const home = resolve(value ?? '')
  expect(home).not.toBe(join(homedir(), '.claude'))
  expect(home.startsWith(TEMP + sep), `${home} lies in ${TEMP}`).toBe(true)
  return home
}

describe('the Claude home of a contract test file', () => {
  it('is a temporary folder of its own in the folder of the run, not ~/.claude, and empty when the test wrote nothing', () => {
    const home = sandboxHome()
    expect(process.env.WORFY_CLAUDE_HOME).toBe(AT_START)
    expect(basename(home).startsWith('claude-home-')).toBe(true)
    const root = inject('contractClaudeHomes')
    expect(dirname(home)).toBe(root)
    expect(dirname(root)).toBe(TEMP)
    expect(basename(root).startsWith(CONTRACT_HOMES_PREFIX)).toBe(true)
    expect(readdirSync(home)).toEqual([])
  })
})

describe('the worfy data folder of a contract test file', () => {
  it('is a temporary folder of its own in the folder of the run, and dataRoot() names it', () => {
    expect(DATA_AT_START, 'WORFY_DATA_DIR is set for a contract test').toBeTruthy()
    const dir = resolve(DATA_AT_START ?? '')
    expect(basename(dir).startsWith('data-dir-')).toBe(true)
    expect(dirname(dir)).toBe(inject('contractClaudeHomes'))
    expect(dir.startsWith(TEMP + sep)).toBe(true)
    expect(dataRoot()).toBe(dir)
  })

  it('dataRoot() with the process environment throws once a test unsets WORFY_DATA_DIR, and names the real folder only for an environment of the test\'s own', async () => {
    const { REAL_DATA_FOLDER_REFUSED, takeRefusals } = await import('../setup-contract')
    const kept = process.env.WORFY_DATA_DIR
    try {
      delete process.env.WORFY_DATA_DIR
      expect(() => dataRoot()).toThrow(REAL_DATA_FOLDER_REFUSED)
      expect(() => dataRoot(process.env, 'packaged')).toThrow(REAL_DATA_FOLDER_REFUSED)
      process.env.WORFY_DATA_DIR = ''
      // Caught, as the reader of the autocompact window catches it: still counted.
      try {
        dataRoot()
      } catch {
        // counted below
      }
    } finally {
      process.env.WORFY_DATA_DIR = kept
    }
    // Taken here, or the hook of the setup file would fail this test for them.
    expect(takeRefusals()).toBe(3)
    expect(dataRoot({}, 'packaged', 'darwin')).toBe(join(homedir(), 'Library', 'Application Support', 'worfy'))
  })
})

describe('failOnRefusals, run after every contract test', () => {
  it('fails after a refusal the code under test swallowed, and passes again after that', async () => {
    const { failOnRefusals, REAL_DATA_FOLDER_REFUSED } = await import('../setup-contract')
    const kept = process.env.WORFY_DATA_DIR
    try {
      delete process.env.WORFY_DATA_DIR
      try {
        dataRoot()
      } catch {
        // swallowed, as a reader that falls back would
      }
    } finally {
      process.env.WORFY_DATA_DIR = kept
    }
    expect(() => failOnRefusals()).toThrow(REAL_DATA_FOLDER_REFUSED)
    expect(() => failOnRefusals()).not.toThrow()
  })
})

describe('isolateDataDir', () => {
  let root = ''
  beforeEach(() => {
    root = mkdtempSync(join(TEMP, 'worfy-isolation-root-'))
  })
  afterEach(() => {
    removeTestTree(root)
  })

  it('gives an unset or empty variable a new empty folder, leaves a set one alone, and release removes the folder', async () => {
    const { isolateDataDir } = await import('../setup-contract')
    const env: Record<string, string | undefined> = { WORFY_DATA_DIR: '' }
    const isolated = isolateDataDir(env, root)
    expect(isolated).not.toBeNull()
    const dir = isolated?.dir ?? ''
    expect(dirname(dir)).toBe(root)
    expect(env.WORFY_DATA_DIR).toBe(dir)
    expect(readdirSync(dir)).toEqual([])
    expect(isolateDataDir({ WORFY_DATA_DIR: '/given' }, root)).toBeNull()
    writeFileSync(join(dir, 'app-settings.json'), '{}')
    isolated?.release()
    expect(existsSync(dir)).toBe(false)
    expect('WORFY_DATA_DIR' in env).toBe(false)
  })
})

describe('the folder of a run', () => {
  it('is made in the temp directory, given to the test files, and removed with every home in it at the end, also of a file that ran no afterAll', () => {
    const provided = new Map<string, unknown>()
    const project = { provide: (key: string, value: unknown) => provided.set(key, value) } as unknown as TestProject
    const teardown = setupRun(project)
    const root = provided.get('contractClaudeHomes')
    expect(typeof root).toBe('string')
    const path = String(root)
    try {
      expect(dirname(path)).toBe(TEMP)
      expect(basename(path).startsWith(CONTRACT_HOMES_PREFIX)).toBe(true)
      // The home of a file whose tests were all skipped: nothing removed it.
      mkdirSync(join(path, 'claude-home-skipped'))
      writeFileSync(join(path, 'claude-home-skipped', 'settings.json'), '{}')
      teardown()
      expect(existsSync(path)).toBe(false)
    } finally {
      if (path.startsWith(TEMP + sep)) removeTestTree(path)
    }
  })
})

describe('isolateClaudeHome', () => {
  let root = ''
  let made: string[] = []
  beforeEach(() => {
    root = mkdtempSync(join(TEMP, 'worfy-isolation-root-'))
  })
  afterEach(() => {
    for (const path of made) removeTestTree(path)
    made = []
    removeTestTree(root)
  })

  it('gives each call a new empty folder: two test files never share one', async () => {
    const first: Record<string, string | undefined> = {}
    const second: Record<string, string | undefined> = {}
    const a = await isolateClaudeHome(first, root)
    const b = await isolateClaudeHome(second, root)
    if (a) made.push(a.home)
    if (b) made.push(b.home)
    expect(a?.home).toBeDefined()
    expect(b?.home).toBeDefined()
    expect(a?.home).not.toBe(b?.home)
    expect(dirname(a?.home ?? '')).toBe(root)
    expect(first.WORFY_CLAUDE_HOME).toBe(a?.home)
    expect(second.WORFY_CLAUDE_HOME).toBe(b?.home)
    writeFileSync(join(a?.home ?? '', 'settings.json'), '{"model":"haiku"}')
    expect(readdirSync(b?.home ?? '')).toEqual([])
  })

  it('leaves a folder the run named as it is and makes none', async () => {
    const given = mkdtempSync(join(TEMP, 'worfy-given-claude-home-'))
    made.push(given)
    const env: Record<string, string | undefined> = { WORFY_CLAUDE_HOME: given }
    const isolated = await isolateClaudeHome(env, root)
    if (isolated) made.push(isolated.home)
    expect(isolated).toBeNull()
    expect(env.WORFY_CLAUDE_HOME).toBe(given)
    expect(readdirSync(root)).toEqual([])
  })

  it('treats an empty value as unset, as claudeHome() does', async () => {
    const env: Record<string, string | undefined> = { WORFY_CLAUDE_HOME: '' }
    const isolated = await isolateClaudeHome(env, root)
    if (isolated) made.push(isolated.home)
    expect(isolated?.home).toBeDefined()
    expect(env.WORFY_CLAUDE_HOME).toBe(isolated?.home)
  })

  it('release removes the folder with what the test wrote, and unsets the variable only while it names that folder', async () => {
    const env: Record<string, string | undefined> = {}
    const isolated = await isolateClaudeHome(env, root)
    if (isolated) made.push(isolated.home)
    expect(isolated).not.toBeNull()
    const home = isolated?.home ?? ''
    writeFileSync(join(home, 'settings.json'), '{}')
    isolated?.release()
    expect(existsSync(home)).toBe(false)
    expect('WORFY_CLAUDE_HOME' in env).toBe(false)

    const other: Record<string, string | undefined> = {}
    const second = await isolateClaudeHome(other, root)
    if (second) made.push(second.home)
    other.WORFY_CLAUDE_HOME = '/set/by/the/test'
    second?.release()
    expect(other.WORFY_CLAUDE_HOME).toBe('/set/by/the/test')
    expect(existsSync(second?.home ?? '')).toBe(false)
  })
})

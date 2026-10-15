// Contract tests do not read the real ~/.claude: test/setup-contract.ts, the setup file of the
// `contract` project, gives every test file a new empty WORFY_CLAUDE_HOME of its own unless the run
// set one. Nothing here reads or writes the real ~/.claude even when it fails: a home is listed only
// after it was checked to lie in the system temp directory, and isolateClaudeHome is called on
// plain objects, not on process.env.
//
// The setup module is imported only inside the tests that call it: importing it at the top would
// itself set the variable, and a run without the setup file would pass here.
import { existsSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'

/** WORFY_CLAUDE_HOME as this file found it when it started, before any test changed it. */
const AT_START = process.env.WORFY_CLAUDE_HOME

const TEMP = realpathSync(tmpdir())
const PREFIX = 'worfy-contract-claude-home-'

type Isolated = { home: string; release: () => void } | null

/** isolateClaudeHome of the setup module, on an object of the test's own. */
async function isolateClaudeHome(env: Record<string, string | undefined>): Promise<Isolated> {
  return (await import('../setup-contract')).isolateClaudeHome(env)
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
  it('is a temporary folder of its own, not ~/.claude, and empty when the test wrote nothing', () => {
    const home = sandboxHome()
    expect(process.env.WORFY_CLAUDE_HOME).toBe(AT_START)
    expect(basename(home).startsWith(PREFIX)).toBe(true)
    expect(readdirSync(home)).toEqual([])
  })
})

describe('isolateClaudeHome', () => {
  let made: string[] = []
  afterEach(() => {
    for (const path of made) removeTestTree(path)
    made = []
  })

  it('gives each call a new empty folder: two test files never share one', async () => {
    const first: Record<string, string | undefined> = {}
    const second: Record<string, string | undefined> = {}
    const a = await isolateClaudeHome(first)
    const b = await isolateClaudeHome(second)
    if (a) made.push(a.home)
    if (b) made.push(b.home)
    expect(a?.home).toBeDefined()
    expect(b?.home).toBeDefined()
    expect(a?.home).not.toBe(b?.home)
    expect(first.WORFY_CLAUDE_HOME).toBe(a?.home)
    expect(second.WORFY_CLAUDE_HOME).toBe(b?.home)
    writeFileSync(join(a?.home ?? '', 'settings.json'), '{"model":"haiku"}')
    expect(readdirSync(b?.home ?? '')).toEqual([])
  })

  it('leaves a folder the run named as it is and makes none', async () => {
    const given = mkdtempSync(join(TEMP, 'worfy-given-claude-home-'))
    made.push(given)
    const env: Record<string, string | undefined> = { WORFY_CLAUDE_HOME: given }
    const isolated = await isolateClaudeHome(env)
    if (isolated) made.push(isolated.home)
    expect(isolated).toBeNull()
    expect(env.WORFY_CLAUDE_HOME).toBe(given)
  })

  it('treats an empty value as unset, as claudeHome() does', async () => {
    const env: Record<string, string | undefined> = { WORFY_CLAUDE_HOME: '' }
    const isolated = await isolateClaudeHome(env)
    if (isolated) made.push(isolated.home)
    expect(isolated?.home).toBeDefined()
    expect(env.WORFY_CLAUDE_HOME).toBe(isolated?.home)
  })

  it('release removes the folder with what the test wrote, and unsets the variable only while it names that folder', async () => {
    const env: Record<string, string | undefined> = {}
    const isolated = await isolateClaudeHome(env)
    if (isolated) made.push(isolated.home)
    expect(isolated).not.toBeNull()
    const home = isolated?.home ?? ''
    writeFileSync(join(home, 'settings.json'), '{}')
    isolated?.release()
    expect(existsSync(home)).toBe(false)
    expect('WORFY_CLAUDE_HOME' in env).toBe(false)

    const other: Record<string, string | undefined> = {}
    const second = await isolateClaudeHome(other)
    if (second) made.push(second.home)
    other.WORFY_CLAUDE_HOME = '/set/by/the/test'
    second?.release()
    expect(other.WORFY_CLAUDE_HOME).toBe('/set/by/the/test')
    expect(existsSync(second?.home ?? '')).toBe(false)
  })
})

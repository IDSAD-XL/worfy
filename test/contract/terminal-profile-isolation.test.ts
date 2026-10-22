// No test shell of a Terminal sits in the profile of whoever runs the tests (worfy-windows ticket 84).
// On Windows worfy hands USERPROFILE, APPDATA and LOCALAPPDATA of its own process to a Terminal's
// shell, and Git for Windows takes HOME from HOMEDRIVE + HOMEPATH. With the test process's values
// PowerShell read the owner's $PROFILE and appended every typed command to the owner's PSReadLine
// history, and Git Bash read the owner's rc files. Pinned here for both kinds of tests that start a
// real Terminal shell: the e2e launches (test/e2e/launch-env.ts) and the Terminal contract tests
// (windowsEnv, terminal-harness.ts).
import { existsSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { DIRECT_START_PROFILE, directStartEnv, launchEnv } from '../e2e/launch-env'
import { PROFILE_VARS, windowsProfileEnv } from '../e2e/terminal-shell'
import { removeTestTree } from '../remove'
import { harness, home, needsWindowsPowerShellOffRunner, useTerminalScratch, WINDOWS, windowsEnv } from './terminal-harness'

vi.mock('electron', () => ({ app: { on: vi.fn() }, BrowserWindow: { getAllWindows: () => [] } }))

useTerminalScratch()

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-profile-isolation-')))
// The shared folder of the direct starts is made by the directStartEnv test; removed again only when
// this file made it, since the e2e runs on this machine use it too.
const directStartProfileWasThere = existsSync(DIRECT_START_PROFILE)
afterAll(() => {
  removeTestTree(scratch)
  if (!directStartProfileWasThere) removeTestTree(DIRECT_START_PROFILE)
})

/** The profile of the person running the tests: the real one on Windows, a made-up one elsewhere. */
const OWNER: Record<(typeof PROFILE_VARS)[number], string> = WINDOWS
  ? { USERPROFILE: process.env.USERPROFILE!, APPDATA: process.env.APPDATA!, LOCALAPPDATA: process.env.LOCALAPPDATA!, HOMEDRIVE: process.env.HOMEDRIVE!, HOMEPATH: process.env.HOMEPATH! }
  : { USERPROFILE: 'C:\\Users\\owner', APPDATA: 'C:\\Users\\owner\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\owner\\AppData\\Local', HOMEDRIVE: 'C:', HOMEPATH: '\\Users\\owner' }
const ownerSource: NodeJS.ProcessEnv = { ...process.env, ...OWNER, PATH: process.env.PATH ?? '' }

/** Every profile variable of `env` names `dir` or a folder in it, and none is the owner's. */
function expectProfileIn(env: Record<string, string>, dir: string): void {
  expect(env.USERPROFILE).toBe(dir)
  expect(env.APPDATA).toBe(join(dir, 'AppData', 'Roaming'))
  expect(env.LOCALAPPDATA).toBe(join(dir, 'AppData', 'Local'))
  // Git for Windows' HOME.
  expect(`${env.HOMEDRIVE}${env.HOMEPATH}`).toBe(dir)
  for (const key of ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA'] as const) expect(env[key], key).not.toBe(OWNER[key])
  expect(`${env.HOMEDRIVE}${env.HOMEPATH}`).not.toBe(`${OWNER.HOMEDRIVE}${OWNER.HOMEPATH}`)
}

describe('the profile of a test shell on Windows', () => {
  it('launchEnv: every launch Playwright starts gets the profile folders in a folder of its own, made before the start', async () => {
    const shellDir = mkdtempSync(join(scratch, 'shell-'))
    const env = await launchEnv({ dataDir: 'd', claudeHome: 'c', shellDir, source: ownerSource, platform: 'win32' })
    const profile = join(shellDir, 'profile')
    expectProfileIn(env, profile)
    // PSReadLine and the shell's TEMP (%USERPROFILE%\AppData\Local\Temp of the registry) need them.
    expect(existsSync(join(profile, 'AppData', 'Roaming'))).toBe(true)
    expect(existsSync(join(profile, 'AppData', 'Local', 'Temp'))).toBe(true)
  })

  it('directStartEnv: a start without Playwright gets them too, in the shared folder of such starts', () => {
    const env = directStartEnv({ dataDir: 'd', claudeHome: 'c', source: ownerSource, platform: 'win32' })
    expectProfileIn(env, DIRECT_START_PROFILE)
    expect(existsSync(join(DIRECT_START_PROFILE, 'AppData', 'Local', 'Temp'))).toBe(true)
  })

  it("a spec's own profile folder wins over the launch's", async () => {
    const own = join(scratch, 'own-profile')
    const env = await launchEnv({ dataDir: 'd', claudeHome: 'c', shellDir: mkdtempSync(join(scratch, 'shell-')), source: ownerSource, platform: 'win32', env: windowsProfileEnv(own, 'win32') })
    expectProfileIn(env, own)
  })

  it('windowsEnv: the shell of the Terminal contract tests has every profile variable in the temporary home', () => {
    const dir = join(scratch, 'home')
    const env = windowsEnv(dir)
    expectProfileIn(env, dir)
    expect(env.HOME).toBe(dir)
  })

  it.each(['darwin', 'linux'] as const)('on %s the launches keep the profile variables of the test process, as before', async (platform) => {
    // A SHELL of the spec: without it launchEnv links the default shell, which Windows allows only
    // with Developer Mode or as an administrator.
    const launched = await launchEnv({ dataDir: 'd', claudeHome: 'c', shellDir: mkdtempSync(join(scratch, 'shell-')), source: ownerSource, platform, env: { SHELL: '/bin/sh' } })
    const direct = directStartEnv({ dataDir: 'd', claudeHome: 'c', source: ownerSource, platform })
    for (const key of PROFILE_VARS) {
      expect(launched[key], key).toBe(OWNER[key])
      expect(direct[key], key).toBe(OWNER[key])
    }
  })

  // The same on the real shell: what PowerShell itself takes for its history file and profile.
  it.runIf(WINDOWS)("a real Terminal shell of the contract tests keeps its PSReadLine history and $PROFILE out of the owner's profile", async (context) => {
    needsWindowsPowerShellOffRunner(context)
    const h = await harness()
    // Wide enough that the console never wraps a long path.
    await h.open(undefined, { cols: 400, rows: 24 })
    // The typed lines hold the label apart, so only the output matches it.
    await h.run("Write-Output ('hi' + 'st=' + (Get-PSReadLineOption).HistorySavePath)", /hist=[^\r\n]*\r?\n/)
    await h.run("Write-Output ('pro' + 'file=' + $PROFILE)", /profile=[^\r\n]*\r?\n/)
    const history = /hist=([^\r\n]*)\r?\n/.exec(h.text())![1]!
    const profile = /profile=([^\r\n]*)\r?\n/.exec(h.text())![1]!
    expect(history.toLowerCase().startsWith(home.toLowerCase() + win32.sep)).toBe(true)
    expect(history.toLowerCase()).not.toBe(win32.join(OWNER.APPDATA, 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt').toLowerCase())
    // Windows PowerShell 5.1 finds no profile folder there and leaves $PROFILE empty; pwsh would name one in `home`.
    expect(profile === '' || profile.toLowerCase().startsWith(home.toLowerCase() + win32.sep), profile).toBe(true)
  })
})

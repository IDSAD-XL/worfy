import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { captureLoginShellEnv } from '../../src/main/agent/env'
import { launchEnv } from '../e2e/launch-env'

// The login shell of an e2e launch (worfy-harness ticket 45): the environment launchApp gives the
// app (test/e2e/launch-env.ts), run through the capture the app itself runs at start,
// captureLoginShellEnv. A unit-level check instead of an e2e: the capture is the only place the
// app starts SHELL at start, and the environment is the only thing launchApp decides about it.
//
// The developer's shell stands in as test/fixtures/harness-stub/login-shell: /bin/sh that adds a
// line to <link>.runs on each start. Its HOME holds a .profile that leaves a marker when read, as
// any rc file of the developer would run.

const LOGIN_SHELL = join(import.meta.dirname, '..', 'fixtures', 'harness-stub', 'login-shell')

const temps: string[] = []
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function developer() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'worfy-launch-shell-')))
  temps.push(dir)
  const shell = join(dir, 'developer-shell')
  await symlink(LOGIN_SHELL, shell)
  const home = join(dir, 'home')
  await mkdir(home)
  const rcMarker = join(dir, 'profile-was-read')
  await writeFile(join(home, '.profile'), `echo read >> '${rcMarker}'\n`)
  const shellDir = join(dir, 'shell')
  await mkdir(shellDir)
  const source: NodeJS.ProcessEnv = { ...process.env, SHELL: shell, HOME: home }
  const parts = { dataDir: join(dir, 'data'), claudeHome: join(dir, 'claude'), shellDir, source }
  const runs = async (): Promise<number> => (await readFile(`${shell}.runs`, 'utf8').catch(() => '')).split('\n').filter(Boolean).length
  return { shell, home, rcMarker, parts, runs }
}

describe.skipIf(process.platform === 'win32')('the login shell of an e2e launch', () => {
  it("a spec without SHELL: the app's start runs neither the developer's shell nor an rc file, and gets the test process's PATH", async () => {
    const dev = await developer()
    const env = await launchEnv(dev.parts)

    const captured = await captureLoginShellEnv({ source: env })
    expect(captured).toMatchObject({ from: 'login-shell', error: null })
    expect(await dev.runs()).toBe(0)
    expect(existsSync(dev.rcMarker)).toBe(false)
    // node and the tools of the tests are found where the test process finds them; HOME is the developer's.
    expect(captured.env.PATH).toBe(process.env.PATH)
    expect(captured.env.HOME).toBe(dev.home)
  })

  it("a spec that sets SHELL: that shell is the one the app's start runs", async () => {
    const dev = await developer()
    const env = await launchEnv({ ...dev.parts, env: { SHELL: dev.shell } })
    expect(env.SHELL).toBe(dev.shell)

    const captured = await captureLoginShellEnv({ source: env })
    expect(captured.from).toBe('login-shell')
    expect(await dev.runs()).toBe(1)
    // A real login shell, as such a spec expects: it reads the .profile of its HOME.
    expect(existsSync(dev.rcMarker)).toBe(true)
  })
})

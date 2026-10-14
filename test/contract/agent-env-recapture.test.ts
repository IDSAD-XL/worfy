// recaptureAgentEnv (src/main/agent/env.ts, worfy-harness ticket 37): the login shell is captured
// again when the Harness scripts or First run ask, one shell run for every caller at a time, and
// the new environment is what agentEnv() answers from then on — unless it is the fallback and the
// held one is not.
//
// The "login shell" is a stand-in: a script that counts its runs, waits a little so callers can
// meet, and either fails or runs the capture's command with the PATH written in a file.
import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeTestTree } from '../remove'

let scratch: string
let path: string
let mode: string
let runs: string

const shellRuns = (): number => readFileSync(runs, 'utf8').split('\n').filter((line) => line !== '').length
const env = async (): Promise<typeof import('../../src/main/agent/env')> => import('../../src/main/agent/env')

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-recapture-')))
  path = join(scratch, 'path')
  mode = join(scratch, 'mode')
  runs = join(scratch, 'runs')
  writeFileSync(runs, '')
  writeFileSync(mode, 'ok\n')
  writeFileSync(path, '/first/bin:/usr/bin:/bin\n')
  const shell = join(scratch, 'login-shell')
  // Called as `<shell> -ilc <command>`.
  writeFileSync(
    shell,
    `#!/bin/sh\necho run >> '${runs}'\n/bin/sleep 0.2\nif [ "$(/bin/cat '${mode}')" = fail ]; then exit 1; fi\nPATH=$(/bin/cat '${path}'); export PATH\nexec /bin/sh -c "$2"\n`,
  )
  chmodSync(shell, 0o755)
  vi.resetModules()
  vi.stubEnv('SHELL', shell)
  vi.stubEnv('HOME', scratch)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
  removeTestTree(scratch)
})

describe.skipIf(process.platform === 'win32')('recaptureAgentEnv', () => {
  it('agentEnv() holds its capture; a recapture runs the shell once for every caller meanwhile, and agentEnv() answers with it after', async () => {
    const { agentEnv, recaptureAgentEnv } = await env()
    expect((await agentEnv()).env.PATH).toBe('/first/bin:/usr/bin:/bin')
    writeFileSync(path, '/nvm/bin:/usr/bin:/bin\n')
    expect((await agentEnv()).env.PATH).toBe('/first/bin:/usr/bin:/bin')
    expect(shellRuns()).toBe(1)
    const [one, two] = await Promise.all([recaptureAgentEnv(), recaptureAgentEnv()])
    expect(shellRuns()).toBe(2)
    expect(one).toBe(two)
    expect(one).toMatchObject({ from: 'login-shell', env: { PATH: '/nvm/bin:/usr/bin:/bin' } })
    expect(await agentEnv()).toBe(one)
    // The next recapture after that one ended is a new shell run.
    await recaptureAgentEnv()
    expect(shellRuns()).toBe(3)
  })

  it('a recapture that falls back keeps the good capture held', async () => {
    const { agentEnv, recaptureAgentEnv } = await env()
    const good = await agentEnv()
    writeFileSync(mode, 'fail\n')
    expect(await recaptureAgentEnv()).toBe(good)
    expect(await agentEnv()).toBe(good)
    expect(shellRuns()).toBe(2)
  })

  it('a good recapture replaces a fallback held since the start', async () => {
    writeFileSync(mode, 'fail\n')
    const { agentEnv, recaptureAgentEnv } = await env()
    expect((await agentEnv()).from).toBe('fallback')
    writeFileSync(mode, 'ok\n')
    const fresh = await recaptureAgentEnv()
    expect(fresh).toMatchObject({ from: 'login-shell', env: { PATH: '/first/bin:/usr/bin:/bin' } })
    expect(await agentEnv()).toBe(fresh)
  })

  it("the scripts' source: a plain request starts no shell; only `fresh` does", async () => {
    const { harnessScriptEnv } = await import('../../src/main/harness/script-env')
    expect((await harnessScriptEnv()).PATH).toBe('/first/bin:/usr/bin:/bin')
    expect(shellRuns()).toBe(1)
    writeFileSync(path, '/nvm/bin:/usr/bin:/bin\n')
    expect((await harnessScriptEnv({})).PATH).toBe('/first/bin:/usr/bin:/bin')
    // `if-fallback` with a good capture held: no shell either.
    expect((await harnessScriptEnv({ fresh: 'if-fallback' })).PATH).toBe('/first/bin:/usr/bin:/bin')
    expect(shellRuns()).toBe(1)
    expect((await harnessScriptEnv({ fresh: 'always' })).PATH).toBe('/nvm/bin:/usr/bin:/bin')
    expect(shellRuns()).toBe(2)
  })

  it('"Check again" (recaptureForCheckAgain): one shell run, then the failed layouts are asked, and they read the new environment without a shell of their own', async () => {
    const { recaptureForCheckAgain, harnessScriptEnv } = await import('../../src/main/harness/script-env')
    await harnessScriptEnv()
    writeFileSync(path, '/nvm/bin:/usr/bin:/bin\n')
    const seen: { runs: number; path: string | undefined }[] = []
    const hub = {
      retryFailedLayouts: async (): Promise<number> => {
        // What a failed watcher's plain ask gets (WorkflowWatcher.retryFailedLayout).
        seen.push({ runs: shellRuns(), path: (await harnessScriptEnv({})).PATH })
        return 1
      },
    }
    await recaptureForCheckAgain(hub)
    for (let i = 0; i < 50 && seen.length === 0; i++) await new Promise((done) => setTimeout(done, 10))
    expect(seen).toEqual([{ runs: 2, path: '/nvm/bin:/usr/bin:/bin' }])
    expect(shellRuns()).toBe(2)
  })
})

// "Sign in with gh" (src/main/github/accounts.ts): which process its pseudo-terminal starts, by the
// system, and that what the command adds to the environment reaches that process. The system is
// passed in and the pty is a stand-in, so both branches run on any machine; the real
// pseudo-terminal is in test/contract/github-accounts.test.ts.
import { describe, expect, it } from 'vitest'
import { signInRegistry } from '../../src/main/github/accounts'
import type { SpawnPty } from '../../src/main/terminal/pty'
import { fakePty, OPEN, SINK } from './terminal-fake-pty'

interface Started {
  file: string
  args: string[]
  env: Record<string, string>
}

/** One sign-in opened on `platform` with the override `command`; what its pseudo-terminal was started with. */
async function signIn(command: string | undefined, platform: NodeJS.Platform, env: Record<string, string | undefined>): Promise<Started[]> {
  const started: Started[] = []
  const fake = fakePty(999_994_201)
  const spawn: SpawnPty = (file, args, options) => {
    started.push({ file, args, env: options.env })
    return fake.pty
  }
  const registry = signInRegistry({ ...(command === undefined ? {} : { command }), env: () => Promise.resolve(env) }, spawn, platform)
  await registry.open('s', OPEN, {}, SINK)
  // The sign-in ends by itself, as gh does: closing a shell of Windows would start the helper that looks for its processes.
  fake.exit(0)
  await registry.closeAll()
  return started
}

const GH_ENV = { Path: 'C:\\Windows\\System32', SystemRoot: 'C:\\Windows', GH_STUB_DIR: 'C:\\stub', NOT_SET: undefined }

describe('the pseudo-terminal of "Sign in with gh"', () => {
  it('on Windows a .mjs stand-in starts under worfy\'s own Node, and the variable that makes it a Node reaches the process', async () => {
    const script = 'C:\\repo\\test\\fixtures\\gh\\gh-stub.mjs'
    const started = await signIn(script, 'win32', GH_ENV)
    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({ file: process.execPath, args: [script, 'auth', 'login'] })
    expect(started[0]?.env).toMatchObject({ GH_STUB_DIR: 'C:\\stub', ELECTRON_RUN_AS_NODE: '1' })
    expect(started[0]?.env).not.toHaveProperty('NOT_SET')
  })

  it('on Windows a real gh starts as it is, with auth login and nothing added to the environment', async () => {
    const started = await signIn('C:\\Tools\\gh.exe', 'win32', GH_ENV)
    expect(started.map(({ file, args }) => ({ file, args }))).toEqual([{ file: 'C:\\Tools\\gh.exe', args: ['auth', 'login'] }])
    expect(started[0]?.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
  })

  it('on Windows without an override the process is gh, by its name', async () => {
    const started = await signIn(undefined, 'win32', GH_ENV)
    expect(started.map(({ file, args }) => ({ file, args }))).toEqual([{ file: 'gh', args: ['auth', 'login'] }])
    expect(started[0]?.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
  })

  it.each(['darwin', 'linux'] as const)('on %s /bin/sh execs the program with auth login, as before, and nothing is added to the environment', async (platform) => {
    const env = { PATH: '/usr/bin:/bin', SHELL: '/bin/zsh', GH_STUB_DIR: '/stub' }
    for (const [command, name] of [['/opt/stub/gh', '/opt/stub/gh'], [undefined, 'gh']] as const) {
      const started = await signIn(command, platform, env)
      expect(started.map(({ file, args }) => ({ file, args }))).toEqual([{ file: '/bin/sh', args: ['-c', 'exec "$0" auth login', name] }])
      expect(started[0]?.env).toMatchObject({ GH_STUB_DIR: '/stub' })
      expect(started[0]?.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
    }
  })
})

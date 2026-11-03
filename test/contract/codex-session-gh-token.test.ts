// GH_TOKEN of a Codex Session (worfy-multi-vendor ticket 36, item 5): a Codex hook cannot set the
// environment of a Session, so the token of the Profile's GitHub account goes into the environment of
// the app-server process (src/main/vendors/codex/session.ts, ghToken). On the fake app-server
// (WORFY_CODEX=fake, set by test/setup-contract.ts), started under scriptNode() through the spawn
// stand-in of the session part: the environment the process was spawned with is read back.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import { hasExited } from '../../src/main/agent/session/process'
import type { SessionHandle } from '../../src/main/vendors/session'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { codexSessions, withGhToken } from '../../src/main/vendors/codex/session'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const REPO = join(import.meta.dirname, '..', '..')
const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }

const roots: string[] = []
const handles: SessionHandle[] = []
const children: ChildProcess[] = []
afterEach(async () => {
  for (const handle of handles.splice(0)) handle.close()
  for (const child of children.splice(0)) {
    if (child.pid === undefined || hasExited(child)) continue
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGKILL')
    await exited
  }
  for (const root of roots.splice(0)) removeTestTree(root)
})

/** Starts a Session on the fake with `env` as worfy's environment; resolves the env the process got and the cwd asked for. */
async function spawnedEnv(env: NodeJS.ProcessEnv, ghToken?: (cwd: string) => Promise<string | null>, log: string[] = []) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'worfy-codex-gh-'))
  roots.push(root)
  let got: NodeJS.ProcessEnv | undefined
  const asked: string[] = []
  const part = codexSessions(() =>
    Promise.resolve({
      runtime: RUNTIME,
      appPath: REPO,
      clientVersion: '9.9.9',
      env: { ...env, WORFY_CODEX: 'fake', WORFY_CODEX_SCRIPT: 'turn', WORFY_CODEX_LOG: join(root, 'codex.log') },
      spawnProcess: (_file: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
        got = options.env
        const child = spawn(scriptNode(), [...args], options)
        children.push(child)
        return child
      },
      log: (line: string) => log.push(line),
      ...(ghToken === undefined ? {} : { ghToken: (cwd: string) => (asked.push(cwd), ghToken(cwd)) }),
    }),
  )
  const handle = await part.start({
    sessionId: 'worfy-session-1',
    cwd: root,
    settings: DEFAULT_SETTINGS,
    unattended: false,
    orchestrator: false,
    permissions: { ask: () => Promise.resolve(null), askQuestions: () => Promise.resolve({ outcome: 'cancelled' }) },
    refused: () => undefined,
    stderr: () => undefined,
    spawned: () => undefined,
  })
  handles.push(handle)
  return { env: got as NodeJS.ProcessEnv, asked, root }
}

/** process.env without any spelling of GH_TOKEN: the test's own must not decide a case. */
const bare = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'GH_TOKEN'))

describe('GH_TOKEN of a Codex Session', () => {
  it('the app-server process gets the token of the Profile\'s account for the Session\'s folder', async () => {
    const { env, asked, root } = await spawnedEnv(bare(), () => Promise.resolve('token-of-the-account'))
    expect(env.GH_TOKEN).toBe('token-of-the-account')
    expect(asked).toEqual([root])
  })

  it('the account\'s token wins over a GH_TOKEN worfy itself has, as the Harness hook\'s line does for Claude Code', async () => {
    const { env } = await spawnedEnv({ ...bare(), gh_token: 'lower-case-spelling', GH_TOKEN: 'worfy-own' }, () => Promise.resolve('token-of-the-account'))
    expect(Object.keys(env).filter((key) => key.toUpperCase() === 'GH_TOKEN')).toEqual(['GH_TOKEN'])
    expect(env.GH_TOKEN).toBe('token-of-the-account')
  })

  it('without an account worfy\'s own GH_TOKEN passes as before, and without one the process has none', async () => {
    expect((await spawnedEnv({ ...bare(), GH_TOKEN: 'worfy-own' }, () => Promise.resolve(null))).env.GH_TOKEN).toBe('worfy-own')
    const none = await spawnedEnv(bare(), () => Promise.resolve(null))
    expect(Object.keys(none.env).filter((key) => key.toUpperCase() === 'GH_TOKEN')).toEqual([])
    expect(Object.keys((await spawnedEnv(bare())).env).filter((key) => key.toUpperCase() === 'GH_TOKEN')).toEqual([])
  })

  it('a token that cannot be had is a line in the log without any token, and the Session starts', async () => {
    const log: string[] = []
    const { env } = await spawnedEnv(bare(), () => Promise.reject(new Error('no gh login for octo-user, the Project\'s GitHub account')), log)
    expect(Object.keys(env).filter((key) => key.toUpperCase() === 'GH_TOKEN')).toEqual([])
    expect(log).toEqual(["[codex] no GH_TOKEN for the Session: no gh login for octo-user, the Project's GitHub account"])
  })

  it('withGhToken leaves the environment as it is without a token', () => {
    const env = { PATH: '/bin', GH_TOKEN: 'x' }
    expect(withGhToken(env, null)).toBe(env)
    expect(withGhToken(env, 'y')).toEqual({ PATH: '/bin', GH_TOKEN: 'y' })
  })
})

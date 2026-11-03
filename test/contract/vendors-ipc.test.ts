// The `vendors` channels (src/main/ipc/vendors.ts, worfy-multi-vendor ticket 29): the Vendors of the build
// and which of them it carries, the sign-in of each, and a sign-in that runs in main until it is over.
// First over stand-in account parts — the shapes of an answer, one sign-in per Vendor at a time, a cancel
// before and after the sign-in has started, the app quitting — then over the Codex account part on the fake
// app-server (WORFY_CODEX=fake, which test/setup-contract.ts sets) playing `login`: the sign-in ends signed
// in, and the page of the sign-in only reaches a recorder, never a browser.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasExited } from '../../src/main/agent/session/process'
import type { AccountConnection, AccountPart, LoginAttempt } from '../../src/main/vendors/account'
import { codexAccountPart, codexAskStarter } from '../../src/main/vendors/codex/account'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import type { VendorId } from '../../src/shared/vendors/vendor'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const quitListeners = vi.hoisted(() => [] as (() => void)[])
vi.mock('electron', () => ({
  app: { on: (event: string, listener: () => void) => void (event === 'will-quit' && quitListeners.push(listener)), isPackaged: false, getAppPath: () => '/', getVersion: () => '0.0.0' },
  shell: {
    openExternal: () => {
      throw new Error('a test opened a browser')
    },
  },
}))

const { default: appHandlers, vendorsHandlers } = await import('../../src/main/ipc/vendors')
type Handlers = ReturnType<typeof vendorsHandlers>

const REPO = join(import.meta.dirname, '..', '..')
const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }

const roots: string[] = []
const children: ChildProcess[] = []
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.pid === undefined || hasExited(child)) continue
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGKILL')
    await exited
  }
  for (const root of roots.splice(0)) removeTestTree(root)
})

async function call(module: Handlers, channel: string, input?: unknown): Promise<unknown> {
  const handler = module.find((entry) => entry.channel.name === channel)
  if (handler === undefined) throw new Error(`no handler of ${channel}`)
  return handler.handle(input as never, {} as never)
}

const SIGNED_OUT: AccountConnection = { provider: 'openai', signedIn: false, email: null, plan: null }
const PLUS: AccountConnection = { provider: 'openai', signedIn: true, email: 'user@example.com', plan: 'plus' }
const CLAUDE: AccountConnection = { provider: 'anthropic', signedIn: true, email: null, plan: 'Claude Max' }

/** A sign-in that ends when the test says so; `cancel` rejects it, as the Codex part's does. */
function pendingLogin() {
  let finish: (connections: AccountConnection[] | null) => void = () => undefined
  let fail: (error: Error) => void = () => undefined
  const cancel = vi.fn(() => fail(new Error('the Codex sign-in was cancelled')))
  const completed = new Promise<AccountConnection[] | null>((resolve, reject) => {
    finish = resolve
    fail = reject
  })
  const attempt: LoginAttempt = { start: { kind: 'url', url: 'https://example.invalid/login' }, completed, cancel }
  return { attempt, finish, cancel }
}

/** Account parts of both Vendors: Claude Code signs in in its terminal, Codex as `codex` says. */
function parts(codex: Partial<AccountPart>): (vendor: VendorId) => AccountPart {
  const claude: AccountPart = {
    check: () => Promise.resolve([CLAUDE]),
    startLogin: () => Promise.resolve({ start: { kind: 'terminal', command: 'claude' }, completed: Promise.resolve(null), cancel: () => undefined }),
  }
  const other: AccountPart = { check: () => Promise.resolve([SIGNED_OUT]), startLogin: () => Promise.reject(new Error('not this test')), ...codex }
  return (vendor) => (vendor === 'claude' ? claude : other)
}

describe('vendors.list and vendors.account', () => {
  it('lists every Vendor in its order, Claude Code required and in every build, Codex as its part says', async () => {
    const carried = vendorsHandlers({ account: parts({ inBuild: () => Promise.resolve(true) }) })
    expect(await call(carried, 'vendors.list')).toEqual({
      vendors: [
        { vendor: 'claude', inBuild: true, required: true },
        { vendor: 'codex', inBuild: true, required: false },
      ],
    })
    const absent = vendorsHandlers({ account: parts({ inBuild: () => Promise.resolve(false) }) })
    expect(await call(absent, 'vendors.list')).toMatchObject({ vendors: [{ vendor: 'claude', inBuild: true }, { vendor: 'codex', inBuild: false }] })
  })

  it("answers a Vendor's connections, and is refused with the Vendor's reason when it did not answer", async () => {
    const module = vendorsHandlers({ account: parts({ check: () => Promise.reject(new Error('account/read: no answer')) }) })
    expect(await call(module, 'vendors.account', { vendor: 'claude' })).toEqual({ connections: [CLAUDE] })
    await expect(call(module, 'vendors.account', { vendor: 'codex' })).rejects.toThrow('account/read: no answer')
  })
})

describe('vendors.startLogin and vendors.cancelLogin', () => {
  it('answers the connections once a browser sign-in is over; a second call meanwhile gets the same answer, one sign-in only', async () => {
    const login = pendingLogin()
    const startLogin = vi.fn(() => Promise.resolve(login.attempt))
    const module = vendorsHandlers({ account: parts({ startLogin }) })
    const first = call(module, 'vendors.startLogin', { vendor: 'codex' })
    const second = call(module, 'vendors.startLogin', { vendor: 'codex' })
    await vi.waitFor(() => expect(startLogin).toHaveBeenCalled())
    login.finish([PLUS])
    expect(await first).toEqual({ connections: [PLUS], command: null })
    expect(await second).toEqual({ connections: [PLUS], command: null })
    expect(startLogin).toHaveBeenCalledTimes(1)
  })

  it('answers the command of a sign-in in the Vendor\'s own terminal, and no connections', async () => {
    const module = vendorsHandlers({ account: parts({}) })
    expect(await call(module, 'vendors.startLogin', { vendor: 'claude' })).toEqual({ connections: null, command: 'claude' })
  })

  it('cancels a sign-in that runs, and one cancelled while it was still starting as soon as it has started', async () => {
    const running = pendingLogin()
    const module = vendorsHandlers({ account: parts({ startLogin: () => Promise.resolve(running.attempt) }) })
    const answer = call(module, 'vendors.startLogin', { vendor: 'codex' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await call(module, 'vendors.cancelLogin', { vendor: 'codex' })
    await expect(answer).rejects.toThrow('cancelled')
    expect(running.cancel).toHaveBeenCalledTimes(1)

    let started: (attempt: LoginAttempt) => void = () => undefined
    const early = pendingLogin()
    const slow = vendorsHandlers({ account: parts({ startLogin: () => new Promise<LoginAttempt>((resolve) => (started = resolve)) }) })
    const late = call(slow, 'vendors.startLogin', { vendor: 'codex' })
    await call(slow, 'vendors.cancelLogin', { vendor: 'codex' })
    started(early.attempt)
    await expect(late).rejects.toThrow('cancelled')
    expect(early.cancel).toHaveBeenCalledTimes(1)

    // No sign-in runs: a cancel does nothing, and the next sign-in is not cancelled by it.
    const next = pendingLogin()
    const again = vendorsHandlers({ account: parts({ startLogin: () => Promise.resolve(next.attempt) }) })
    await call(again, 'vendors.cancelLogin', { vendor: 'codex' })
    const fresh = call(again, 'vendors.startLogin', { vendor: 'codex' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    next.finish([PLUS])
    expect(await fresh).toEqual({ connections: [PLUS], command: null })
    expect(next.cancel).not.toHaveBeenCalled()
  })

  it('is refused when the sign-in fails, and cancels every sign-in still running when the app quits', async () => {
    const failing = vendorsHandlers({ account: parts({ startLogin: () => Promise.reject(new Error('Codex is already signed in')) }) })
    await expect(call(failing, 'vendors.startLogin', { vendor: 'codex' })).rejects.toThrow('already signed in')

    const quit: (() => void)[] = []
    const login = pendingLogin()
    const module = vendorsHandlers({ account: parts({ startLogin: () => Promise.resolve(login.attempt) }), onQuit: (listener) => quit.push(listener) })
    const answer = call(module, 'vendors.startLogin', { vendor: 'codex' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    for (const listener of quit) listener()
    await expect(answer).rejects.toThrow('cancelled')
    expect(login.cancel).toHaveBeenCalledTimes(1)
  })

  it("the app's module cancels its sign-ins on will-quit", () => {
    expect(appHandlers.map((handler) => handler.channel.name)).toEqual(['vendors.list', 'vendors.account', 'vendors.startLogin', 'vendors.cancelLogin'])
    expect(quitListeners).toHaveLength(1)
  })
})

describe('over the Codex account part on the fake app-server', () => {
  /** The Codex part over the fake playing `script`, its page opened by a recorder, in a CODEX_HOME that exists. */
  function codexOnFake(script: string) {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'worfy-vendors-ipc-'))
    roots.push(root)
    const codexHome = join(root, 'codex-home')
    mkdirSync(codexHome)
    const opened: string[] = []
    const spawnProcess = (_file: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
      const child = spawn(scriptNode(), [...args], options)
      children.push(child)
      return child
    }
    const start = codexAskStarter({ runtime: RUNTIME, appPath: REPO, cwd: root, clientVersion: '9.9.9', env: { ...process.env, WORFY_CODEX_SCRIPT: script }, spawnProcess, log: () => undefined })
    const codex = codexAccountPart({
      start,
      codexHome: () => codexHome,
      openUrl: (url) => {
        opened.push(url)
        return Promise.resolve()
      },
      inBuild: () => Promise.resolve(true),
      log: () => undefined,
    })
    return { module: vendorsHandlers({ account: parts(codex) }), opened }
  }

  it('signed out, then signed in through `login`: the account of the end, and the page only recorded', async () => {
    const { module, opened } = codexOnFake('login')
    expect(await call(module, 'vendors.account', { vendor: 'codex' })).toEqual({ connections: [SIGNED_OUT] })
    expect(await call(module, 'vendors.startLogin', { vendor: 'codex' })).toEqual({ connections: [PLUS], command: null })
    expect(opened).toEqual(['https://auth.openai.com/oauth/authorize?client_id=fake&state=login_fake_1'])
  })

  it('`signed-out`: nobody is signed in, without an error', async () => {
    const { module } = codexOnFake('signed-out')
    expect(await call(module, 'vendors.account', { vendor: 'codex' })).toEqual({ connections: [SIGNED_OUT] })
  })
})

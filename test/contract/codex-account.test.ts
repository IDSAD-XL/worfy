// The account and limits parts of the Codex driver (src/main/vendors/codex/account.ts, limits.ts;
// worfy-multi-vendor ticket 21), first on the fake app-server (WORFY_CODEX=fake, which
// test/setup-contract.ts sets, with an empty CODEX_HOME of this file): `account/read` of a Plus and a Pro
// plan and of a Codex that is signed out, the ChatGPT sign-in with the opening of its page replaced, and
// `account/rateLimits/read` as Limit windows. Then the sign-in's ends the fake cannot play — a failure,
// a cancel, an app-server that exits, a timeout — on a stand-in app-server.
//
// The fake runs under scriptNode() (test/script-node.ts) through the spawn stand-in of
// codexAskStarter, as test/contract/codex-app-server.test.ts starts it: process.execPath is Electron
// under `pnpm test`, far slower to start. Every process a test started is killed after it, by its pid.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasExited } from '../../src/main/agent/session/process'
import type { LoginAttempt } from '../../src/main/vendors/account'
import { codexAccountPart, codexAskStarter, type CodexAsk, type StartCodex } from '../../src/main/vendors/codex/account'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { codexLimitsPart } from '../../src/main/vendors/codex/limits'
import type { CodexRpcEvent } from '../../src/main/vendors/codex/rpc'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const REPO = join(import.meta.dirname, '..', '..')
const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }
const NOW = Date.UTC(2026, 10, 2, 12, 0)

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

function tempRoot(): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'worfy-codex-account-'))
  roots.push(root)
  return root
}

interface Fake {
  start: StartCodex
  /** What worfy sent the fake, every process of this fake together, in order. */
  sent: () => Record<string, unknown>[]
  /** The processes it started. */
  started: ChildProcess[]
  /** The folder the processes run in. */
  cwd: string
}

/** A StartCodex over the fake playing `script`; every process it starts plays the script from its start. */
function fake(script: string): Fake {
  const cwd = tempRoot()
  const log = join(cwd, 'codex.log')
  const started: ChildProcess[] = []
  const spawnProcess = (_file: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
    const child = spawn(scriptNode(), [...args], options)
    children.push(child)
    started.push(child)
    return child
  }
  const start = codexAskStarter({
    runtime: RUNTIME,
    appPath: REPO,
    cwd,
    clientVersion: '9.9.9',
    env: { ...process.env, WORFY_CODEX_SCRIPT: script, WORFY_CODEX_LOG: log },
    spawnProcess,
    log: () => undefined,
  })
  const sent = (): Record<string, unknown>[] =>
    readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
  return { start, sent, started, cwd }
}

const methods = (sent: Record<string, unknown>[]): unknown[] => sent.map((message) => message.method).filter((method) => method !== 'initialize' && method !== 'initialized')

/** Every file and folder under `root`, with its size and modification time: what a write would change. */
function tree(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .map((name) => {
      const stats = statSync(join(root, name))
      return `${name} ${stats.size} ${stats.mtimeMs}`
    })
    .sort()
}

const codexHome = (): string => process.env.CODEX_HOME as string

describe('the account part on the fake app-server', () => {
  it('account-plus: one connection of OpenAI, signed in, with its email and plan', async () => {
    const { start, sent, started } = fake('account-plus')
    await expect(codexAccountPart({ start, codexHome }).check()).resolves.toEqual([{ provider: 'openai', signedIn: true, email: 'user@example.com', plan: 'plus' }])
    expect(methods(sent())).toEqual(['account/read'])
    expect(sent().find((message) => message.method === 'account/read')).toMatchObject({ params: { refreshToken: false } })
    // The process is closed after the answer.
    expect(started).toHaveLength(1)
    expect(hasExited(started[0]!)).toBe(true)
  })

  it('signed-out: not signed in, without an error', async () => {
    const { start } = fake('signed-out')
    await expect(codexAccountPart({ start, codexHome }).check()).resolves.toEqual([{ provider: 'openai', signedIn: false, email: null, plan: null }])
  })

  it('login: the sign-in opens the page Codex named (the opening replaced) and completes signed in, by ChatGPT, never by an API key', async () => {
    const { start, sent, started } = fake('login')
    const opened: string[] = []
    const openUrl = (url: string): Promise<void> => {
      opened.push(url)
      return Promise.resolve()
    }
    const attempt: LoginAttempt = await codexAccountPart({ start, codexHome, openUrl }).startLogin()
    const url = 'https://auth.openai.com/oauth/authorize?client_id=fake&state=login_fake_1'
    expect(attempt.start).toEqual({ kind: 'url', url })
    expect(opened).toEqual([url])
    await expect(attempt.completed).resolves.toEqual([{ provider: 'openai', signedIn: true, email: 'user@example.com', plan: 'plus' }])
    expect(methods(sent())).toEqual(['account/read', 'account/login/start', 'account/read'])
    expect(sent().find((message) => message.method === 'account/login/start')).toMatchObject({ params: { type: 'chatgpt' } })
    expect(JSON.stringify(sent())).not.toMatch(/apiKey/i)
    expect(started).toHaveLength(1)
    expect(hasExited(started[0]!)).toBe(true)
    // A cancel once the sign-in is over sends nothing.
    attempt.cancel()
    expect(methods(sent())).toHaveLength(3)
  })
})

describe('the limits part on the fake app-server', () => {
  it('account-plus: the poll reads the account, then two windows, 5h and weekly, skipping the reset-credit details', async () => {
    const { start, sent, started } = fake('account-plus')
    await expect(codexLimitsPart({ start, codexHome, now: () => NOW }).poll(new AbortController().signal)).resolves.toEqual([
      { vendor: 'codex', id: 'primary', label: '5h', usedPercent: 12, windowMinutes: 300, resetsAt: 1793003600, state: 'ok', receivedAt: NOW, source: 'read' },
      { vendor: 'codex', id: 'secondary', label: 'weekly', usedPercent: 40, windowMinutes: 10080, resetsAt: 1793400000, state: 'ok', receivedAt: NOW, source: 'read' },
    ])
    expect(methods(sent())).toEqual(['account/read', 'account/rateLimits/read'])
    expect(sent().find((message) => message.method === 'account/rateLimits/read')).toMatchObject({ params: { excludeResetCreditDetails: true } })
    expect(hasExited(started[0]!)).toBe(true)
  })

  it('account-pro: one weekly window', async () => {
    const { start } = fake('account-pro')
    await expect(codexLimitsPart({ start, codexHome, now: () => NOW }).poll(new AbortController().signal)).resolves.toEqual([
      { vendor: 'codex', id: 'primary', label: 'weekly', usedPercent: 5, windowMinutes: 10080, resetsAt: 1793500000, state: 'ok', receivedAt: NOW, source: 'read' },
    ])
  })

  it('signed-out: the poll answers null and never asks the windows', async () => {
    const { start, sent } = fake('signed-out')
    await expect(codexLimitsPart({ start, codexHome }).poll(new AbortController().signal)).resolves.toBeNull()
    expect(methods(sent())).toEqual(['account/read'])
  })

  it('read() asks the windows with their details, without the account', async () => {
    const { start, sent } = fake('limits-two-windows')
    const windows = await codexLimitsPart({ start, codexHome, now: () => NOW }).read()
    expect(windows.map(({ id, label, usedPercent }) => [id, label, usedPercent])).toEqual([
      ['primary', '5h', 12],
      ['secondary', 'weekly', 40],
    ])
    expect(sent().filter((message) => message.method === 'account/rateLimits/read')).toEqual([{ id: 2, method: 'account/rateLimits/read', params: {} }])
  })

  it('read() rejects when Codex refuses the read, and closes the app-server', async () => {
    // The fake of a Codex signed out waits for account/read first and refuses the read before it.
    const { start, started } = fake('signed-out')
    await expect(codexLimitsPart({ start, codexHome }).read()).rejects.toThrow(/^Codex app-server refused account\/rateLimits\/read: /)
    expect(hasExited(started[0]!)).toBe(true)
  })

  it('a poll aborted while its app-server starts closes that app-server once started and rejects: no process is left', async () => {
    const { start, started } = fake('account-plus')
    const quit = new AbortController()
    const polling = codexLimitsPart({ start, codexHome }).poll(quit.signal)
    quit.abort(new Error('the app quits'))
    await expect(polling).rejects.toThrow('the app quits')
    expect(started.every((child) => hasExited(child))).toBe(true)
  })
})

describe('what worfy writes (ADR-0005)', () => {
  it('reading the account and the Limits and signing in write nothing into CODEX_HOME or the folder the app-server runs in', async () => {
    const before = tree(codexHome())
    const plus = fake('account-plus')
    const cwdBefore = tree(plus.cwd).filter((entry) => !entry.startsWith('codex.log '))
    await codexAccountPart({ start: plus.start, codexHome }).check()
    await codexLimitsPart({ start: plus.start, codexHome }).poll(new AbortController().signal)
    const login = fake('login')
    await (await codexAccountPart({ start: login.start, codexHome, openUrl: () => Promise.resolve() }).startLogin()).completed
    expect(tree(codexHome())).toEqual(before)
    // Only the fake's own log of the test is there.
    expect(tree(plus.cwd).filter((entry) => !entry.startsWith('codex.log '))).toEqual(cwdBefore)
    expect(readdirSync(login.cwd)).toEqual(['codex.log'])
  })
})

// --- The sign-in's other ends, on a stand-in app-server ------------------------------------------

interface StandIn {
  start: StartCodex
  /** The requests worfy sent, with their params. */
  requests: { method: string; params: unknown }[]
  /** Sends a notification as the app-server would. */
  notify: (method: string, params: unknown) => void
  /** Ends the stand-in's process. */
  exit: () => void
  closed: () => number
  /** How many times the stand-in was started. */
  starts: () => number
}

/**
 * A stand-in app-server: `answers` gives the result of each request by its method (a function may
 * throw to refuse it); `account/login/cancel` and unknown methods are answered with null.
 */
function standIn(answers: Record<string, (params: unknown) => unknown>): StandIn {
  const requests: { method: string; params: unknown }[] = []
  let onEvent: (event: CodexRpcEvent) => void = () => undefined
  const exits: (() => void)[] = []
  let exited = false
  let closed = 0
  let starts = 0
  const ask: CodexAsk = {
    request: <R,>(method: string, params: unknown, timeoutMs?: number) => {
      requests.push({ method, params })
      // Every ask waits 30 s at most, CODEX_ASK_TIMEOUT_MS.
      expect(timeoutMs).toBe(30_000)
      const answer = answers[method]
      try {
        return Promise.resolve((answer === undefined ? null : answer(params)) as R)
      } catch (error) {
        return Promise.reject(error as Error)
      }
    },
    onExit: (listener) => {
      if (exited) listener()
      else exits.push(listener)
    },
    close: () => {
      closed += 1
      return Promise.resolve()
    },
  }
  return {
    start: (listener) => {
      starts += 1
      onEvent = listener
      return Promise.resolve(ask)
    },
    requests,
    notify: (method, params) => onEvent({ type: 'notification', notification: { method, params } as never }),
    exit: () => {
      exited = true
      for (const listener of exits.splice(0)) listener()
    },
    closed: () => closed,
    starts: () => starts,
  }
}

const SIGNED_OUT = { account: null, requiresOpenaiAuth: true }
const SIGNED_IN = { account: { type: 'chatgpt', email: 'user@example.com', planType: 'pro', workspaceName: null }, requiresOpenaiAuth: true }
const LOGIN = { type: 'chatgpt', loginId: 'login_7', authUrl: 'https://auth.example/7' }

/** A stand-in signed out until its sign-in completes. */
function loginStandIn(): StandIn & { signedIn: { value: boolean } } {
  const signedIn = { value: false }
  return { ...standIn({ 'account/read': () => (signedIn.value ? SIGNED_IN : SIGNED_OUT), 'account/login/start': () => LOGIN }), signedIn }
}

const open = (): Promise<void> => Promise.resolve()

describe('the sign-in on a stand-in app-server', () => {
  it('waits for the completion of its own sign-in: one of another sign-in changes nothing', async () => {
    const server = loginStandIn()
    const attempt = await codexAccountPart({ start: server.start, openUrl: open }).startLogin()
    let done = false
    void attempt.completed.then(() => (done = true))
    server.notify('account/login/completed', { loginId: 'login_other', success: true, error: null })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(done).toBe(false)
    expect(server.closed()).toBe(0)
    server.signedIn.value = true
    server.notify('account/login/completed', { loginId: 'login_7', success: true, error: null })
    await expect(attempt.completed).resolves.toEqual([{ provider: 'openai', signedIn: true, email: 'user@example.com', plan: 'pro' }])
    expect(server.closed()).toBe(1)
  })

  it('takes a completion that names no sign-in, and one that came before the answer to account/login/start was read', async () => {
    const server = standIn({ 'account/read': () => SIGNED_OUT, 'account/login/start': () => LOGIN })
    // The notification comes at once, as the fake's does: before startLogin reads the answer.
    const original = server.start
    const start: StartCodex = async (listener) => {
      const ask = await original(listener)
      return {
        ...ask,
        request: async <R,>(method: Parameters<CodexAsk['request']>[0], params: Parameters<CodexAsk['request']>[1], timeoutMs?: number) => {
          const answer = await ask.request<R>(method, params, timeoutMs)
          if (method === 'account/login/start') server.notify('account/login/completed', { loginId: null, success: true, error: null })
          return answer
        },
      }
    }
    const attempt = await codexAccountPart({ start, openUrl: open }).startLogin()
    await expect(attempt.completed).resolves.toEqual([{ provider: 'openai', signedIn: false, email: null, plan: null }])
  })

  it('a failed sign-in rejects with Codex\'s reason, or says Codex gave none, and closes the app-server', async () => {
    const server = loginStandIn()
    const attempt = await codexAccountPart({ start: server.start, openUrl: open }).startLogin()
    server.notify('account/login/completed', { loginId: 'login_7', success: false, error: 'access denied' })
    await expect(attempt.completed).rejects.toThrow('the Codex sign-in failed: access denied')
    expect(server.closed()).toBe(1)

    const silent = loginStandIn()
    const second = await codexAccountPart({ start: silent.start, openUrl: open }).startLogin()
    silent.notify('account/login/completed', { loginId: 'login_7', success: false, error: null })
    await expect(second.completed).rejects.toThrow('the Codex sign-in failed: Codex gave no reason')
  })

  it('cancel() asks Codex to cancel that sign-in, rejects the completion and closes the app-server; a second cancel sends nothing', async () => {
    const server = loginStandIn()
    const attempt = await codexAccountPart({ start: server.start, openUrl: open }).startLogin()
    attempt.cancel()
    await expect(attempt.completed).rejects.toThrow('the Codex sign-in was cancelled')
    expect(server.requests.filter(({ method }) => method === 'account/login/cancel')).toEqual([{ method: 'account/login/cancel', params: { loginId: 'login_7' } }])
    expect(server.closed()).toBe(1)
    attempt.cancel()
    expect(server.requests.filter(({ method }) => method === 'account/login/cancel')).toHaveLength(1)
  })

  it('a refused cancel still ends the sign-in', async () => {
    const server = standIn({
      'account/read': () => SIGNED_OUT,
      'account/login/start': () => LOGIN,
      'account/login/cancel': () => {
        throw new Error('no such login')
      },
    })
    const attempt = await codexAccountPart({ start: server.start, openUrl: open }).startLogin()
    attempt.cancel()
    await expect(attempt.completed).rejects.toThrow('the Codex sign-in was cancelled')
  })

  it('an app-server that exits before the sign-in is over rejects the completion', async () => {
    const server = loginStandIn()
    const attempt = await codexAccountPart({ start: server.start, openUrl: open }).startLogin()
    server.exit()
    await expect(attempt.completed).rejects.toThrow('the Codex app-server exited before the sign-in was over')
    expect(server.closed()).toBe(1)
  })

  it('a sign-in not completed in time is cancelled', async () => {
    vi.useFakeTimers()
    try {
      const server = loginStandIn()
      const attempt = await codexAccountPart({ start: server.start, openUrl: open, loginTimeoutMs: 120_000 }).startLogin()
      const rejected = expect(attempt.completed).rejects.toThrow('the Codex sign-in was not completed within 120 s')
      await vi.advanceTimersByTimeAsync(119_999)
      expect(server.requests.some(({ method }) => method === 'account/login/cancel')).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await rejected
      expect(server.requests.filter(({ method }) => method === 'account/login/cancel')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a sign-in is given 10 minutes by default', async () => {
    vi.useFakeTimers()
    try {
      const server = loginStandIn()
      const attempt = await codexAccountPart({ start: server.start, openUrl: open }).startLogin()
      const rejected = expect(attempt.completed).rejects.toThrow('the Codex sign-in was not completed within 600 s')
      await vi.advanceTimersByTimeAsync(600_000 - 1)
      expect(server.closed()).toBe(0)
      await vi.advanceTimersByTimeAsync(1)
      await rejected
      expect(server.closed()).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a completed sign-in stops its timer', async () => {
    vi.useFakeTimers()
    try {
      const server = loginStandIn()
      const attempt = await codexAccountPart({ start: server.start, openUrl: open }).startLogin()
      server.notify('account/login/completed', { loginId: 'login_7', success: true, error: null })
      await attempt.completed
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a Codex already signed in is not signed in again: no sign-in starts, nothing opens, the app-server is closed', async () => {
    const server = standIn({ 'account/read': () => SIGNED_IN })
    const openUrl = vi.fn(open)
    await expect(codexAccountPart({ start: server.start, openUrl }).startLogin()).rejects.toThrow('Codex is already signed in as user@example.com')
    expect(server.requests.map(({ method }) => method)).toEqual(['account/read'])
    expect(openUrl).not.toHaveBeenCalled()
    expect(server.closed()).toBe(1)

    const nameless = standIn({ 'account/read': () => ({ ...SIGNED_IN, account: { ...SIGNED_IN.account, email: null } }) })
    await expect(codexAccountPart({ start: nameless.start, openUrl }).startLogin()).rejects.toThrow(/^Codex is already signed in$/)
  })

  it('a sign-in of another kind, or a page that does not open, closes the app-server and rejects', async () => {
    const device = standIn({ 'account/read': () => SIGNED_OUT, 'account/login/start': () => ({ type: 'chatgptDeviceCode', loginId: 'x', verificationUrl: 'u', userCode: 'c' }) })
    await expect(codexAccountPart({ start: device.start, openUrl: open }).startLogin()).rejects.toThrow('Codex started a sign-in of another kind: chatgptDeviceCode')
    expect(device.closed()).toBe(1)

    const server = loginStandIn()
    await expect(codexAccountPart({ start: server.start, openUrl: () => Promise.reject(new Error('no browser')) }).startLogin()).rejects.toThrow('no browser')
    expect(server.closed()).toBe(1)
  })
})

describe('the account check on a stand-in app-server', () => {
  it('starts nothing and answers not signed in while Codex has no home folder', async () => {
    const server = standIn({ 'account/read': () => SIGNED_IN })
    const check = codexAccountPart({ start: server.start, codexHome: () => join(tempRoot(), 'no-codex-home') }).check()
    await expect(check).resolves.toEqual([{ provider: 'openai', signedIn: false, email: null, plan: null }])
    expect(server.starts()).toBe(0)
  })

  it('answers not signed in, with one log line, when the app-server does not start', async () => {
    const log = vi.fn()
    const failure = new Error('no Codex for linux-ia32')
    const check = codexAccountPart({ start: () => Promise.reject(failure), codexHome, log }).check()
    await expect(check).resolves.toEqual([{ provider: 'openai', signedIn: false, email: null, plan: null }])
    expect(log).toHaveBeenCalledWith('[codex] the app-server did not start: Codex counts as not signed in', failure)
  })

  it('rejects when the app-server started but did not answer, and closes it', async () => {
    const server = standIn({
      'account/read': () => {
        throw new Error('Codex app-server did not answer account/read')
      },
    })
    await expect(codexAccountPart({ start: server.start, codexHome }).check()).rejects.toThrow('did not answer account/read')
    expect(server.closed()).toBe(1)
  })

  it('an API key or another provider\'s sign-in is not a sign-in worfy uses', async () => {
    for (const account of [{ type: 'apiKey' }, { type: 'amazonBedrock', usesCodexManagedCredentials: true }, { type: 'gcp' }]) {
      const server = standIn({ 'account/read': () => ({ account, requiresOpenaiAuth: false }) })
      await expect(codexAccountPart({ start: server.start, codexHome }).check()).resolves.toEqual([{ provider: 'openai', signedIn: false, email: null, plan: null }])
    }
  })

  it('an aborted check starts nothing; an abort during the ask closes the app-server and rejects with the reason', async () => {
    const server = standIn({ 'account/read': () => SIGNED_IN })
    const quit = new AbortController()
    quit.abort(new Error('the app quits'))
    await expect(codexAccountPart({ start: server.start, codexHome }).check(quit.signal)).rejects.toThrow('the app quits')
    expect(server.starts()).toBe(0)

    const hanging = standIn({ 'account/read': () => SIGNED_IN })
    const never: StartCodex = async (listener) => ({ ...(await hanging.start(listener)), request: () => new Promise<never>(() => undefined) })
    const later = new AbortController()
    const check = codexAccountPart({ start: never, codexHome }).check(later.signal)
    await new Promise((resolve) => setTimeout(resolve, 10))
    later.abort(new Error('the window closed'))
    await expect(check).rejects.toThrow('the window closed')
    expect(hanging.closed()).toBe(1)
  })
})

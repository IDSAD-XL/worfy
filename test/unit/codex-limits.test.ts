// The limits part of the Codex driver (src/main/vendors/codex/limits.ts, worfy-multi-vendor ticket 21)
// without a process: the label of a window by its length, a snapshot of Codex's rate limits as Limit
// windows, the `limits` event of `account/rateLimits/updated`, and the `limit_reached` event of a turn
// refused with `usageLimitExceeded` — on the records of the fake's scripts usage-limit-window (a window
// ran out: wait until it resets) and usage-limit-quota (nothing ran out: nothing to wait for). Also the
// poll and the read over a stand-in app-server, the ask's abort, and the app's start of an app-server
// (Electron and the app-server client replaced).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appCodexStarter, codexAccount, codexHomeOf, useCodex, withCodex, type CodexAsk } from '../../src/main/vendors/codex/account'
import { codexDriver } from '../../src/main/vendors/codex/index'
import {
  codexLimitReached,
  codexLimitReachedEvent,
  codexLimits,
  codexLimitsEvent,
  codexLimitsPart,
  codexLimitWindows,
  codexWindowLabel,
  readCodexRateLimits,
} from '../../src/main/vendors/codex/limits'
import type { AccountRateLimitsUpdatedNotification } from '../../src/main/vendors/codex/protocol/ts/v2/AccountRateLimitsUpdatedNotification'
import type { ErrorNotification } from '../../src/main/vendors/codex/protocol/ts/v2/ErrorNotification'
import type { RateLimitSnapshot } from '../../src/main/vendors/codex/protocol/ts/v2/RateLimitSnapshot'
import type { LimitWindow } from '../../src/shared/agent/limits'

const started = vi.hoisted(() => ({ options: [] as Record<string, unknown>[], made: [] as string[], exits: [] as [string, () => void][] }))
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/app/path', getVersion: () => '1.2.3' } }))
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return { ...fs, mkdirSync: (path: string, options: unknown) => void started.made.push(`${path} ${JSON.stringify(options)}`) }
})
vi.mock('../../src/main/storage/paths', () => ({ dataRoot: () => '/data/root' }))
vi.mock('../../src/main/vendors/codex/app-server', () => ({
  CodexAppServer: {
    start: (options: Record<string, unknown>) => {
      started.options.push(options)
      return Promise.resolve({ request: () => Promise.resolve('answered'), process: { exitCode: null, signalCode: null, once: (event: string, listener: () => void) => void started.exits.push([event, listener]) }, close: () => Promise.resolve() })
    },
  },
}))

const SCRIPTS = join(import.meta.dirname, '..', 'fixtures', 'codex-scripts')
const NOW = Date.UTC(2026, 10, 2, 12, 0)

/** The params of every notification `method` the fake's script `name` sends, in order. */
function notified<T>(name: string, method: string): T[] {
  return readFileSync(join(SCRIPTS, `${name}.jsonl`), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as { notify?: string; params?: unknown })
    .filter((step) => step.notify === method)
    .map((step) => step.params as T)
}

const updated = (name: string): AccountRateLimitsUpdatedNotification => notified<AccountRateLimitsUpdatedNotification>(name, 'account/rateLimits/updated')[0]!
const refusal = (name: string): ErrorNotification => notified<ErrorNotification>(name, 'error')[0]!

const snapshot = (fields: Partial<RateLimitSnapshot>): RateLimitSnapshot => ({
  limitId: 'codex',
  limitName: null,
  normalModelSlug: null,
  primary: null,
  secondary: null,
  credits: null,
  individualLimit: null,
  spendControlReached: null,
  planType: null,
  rateLimitReachedType: null,
  ...fields,
})

const codexWindow = (fields: Partial<LimitWindow>): LimitWindow => ({
  vendor: 'codex',
  id: 'primary',
  label: '5h',
  usedPercent: 0,
  windowMinutes: 300,
  resetsAt: 1793003600,
  state: 'ok',
  receivedAt: NOW,
  source: 'read',
  ...fields,
})

/** A stand-in app-server that answers each request by its method and records it. */
function standIn(answers: Record<string, () => unknown>): CodexAsk & { requests: { method: string; params: unknown }[]; closed: number } {
  const ask = {
    requests: [] as { method: string; params: unknown }[],
    closed: 0,
    request: <R,>(method: string, params: unknown, timeoutMs?: number) => {
      ask.requests.push({ method, params })
      expect(timeoutMs).toBe(30_000)
      const answer = answers[method]
      if (answer === undefined) return Promise.reject(new Error(`the script has ended: ${method}`))
      try {
        return Promise.resolve(answer() as R)
      } catch (error) {
        return Promise.reject(error as Error)
      }
    },
    onExit: () => undefined,
    close: () => {
      ask.closed += 1
      return Promise.resolve()
    },
  }
  return ask as CodexAsk & typeof ask
}

describe('the label of a window by its length, as the Codex TUI picks it', () => {
  it.each([
    [300, '5h'],
    [285, '5h'],
    [315, '5h'],
    [1440, 'daily'],
    [1368, 'daily'],
    [1512, 'daily'],
    [10080, 'weekly'],
    [9576, 'weekly'],
    [10584, 'weekly'],
    [43200, 'monthly'],
    [41040, 'monthly'],
    [45360, 'monthly'],
    [525600, 'annual'],
    [499320, 'annual'],
    [551880, 'annual'],
  ])('%i minutes: %s', (minutes, label) => {
    expect(codexWindowLabel(minutes, 'primary')).toBe(label)
    expect(codexWindowLabel(minutes, 'secondary')).toBe(label)
  })

  it.each([284, 316, 1367, 1513, 9575, 10585, 0, 60, 2880, -300])('%i minutes, more than 5 %% from every length: the fallback of the window', (minutes) => {
    expect(codexWindowLabel(minutes, 'primary')).toBe('usage')
    expect(codexWindowLabel(minutes, 'secondary')).toBe('secondary usage')
  })

  it('no length: the fallback of the window', () => {
    expect(codexWindowLabel(null, 'primary')).toBe('usage')
    expect(codexWindowLabel(null, 'secondary')).toBe('secondary usage')
  })
})

describe('a snapshot of Codex\'s rate limits as Limit windows', () => {
  it('primary and secondary, each with its length, use, reset, label, time and source', () => {
    const windows = codexLimitWindows(updated('usage-limit-quota').rateLimits, NOW, 'updated')
    expect(windows).toEqual([
      { vendor: 'codex', id: 'primary', label: '5h', usedPercent: 30, windowMinutes: 300, resetsAt: 1793003600, state: 'ok', receivedAt: NOW, source: 'updated' },
      { vendor: 'codex', id: 'secondary', label: 'weekly', usedPercent: 52, windowMinutes: 10080, resetsAt: 1793400000, state: 'ok', receivedAt: NOW, source: 'updated' },
    ])
  })

  it('a window that is absent or null is left out; one without a length or a reset has them null', () => {
    expect(codexLimitWindows(snapshot({ secondary: { usedPercent: 3, windowDurationMins: null, resetsAt: null } }), NOW, 'read')).toEqual([
      { vendor: 'codex', id: 'secondary', label: 'secondary usage', usedPercent: 3, windowMinutes: null, resetsAt: null, state: 'ok', receivedAt: NOW, source: 'read' },
    ])
    const sparse = { ...snapshot({}), primary: undefined, secondary: undefined } as unknown as RateLimitSnapshot
    expect(codexLimitWindows(sparse, NOW, 'updated')).toEqual([])
  })

  it('a window used up (100 % or more) is reached, one at 99 % is ok: Codex sends no warning level', () => {
    const windows = codexLimitWindows(snapshot({ primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1 }, secondary: { usedPercent: 99, windowDurationMins: 10080, resetsAt: 2 } }), NOW, 'read')
    expect(windows.map(({ state }) => state)).toEqual(['reached', 'ok'])
    expect(codexLimitWindows(snapshot({ primary: { usedPercent: 130, windowDurationMins: 300, resetsAt: 1 } }), NOW, 'read')[0]!.state).toBe('reached')
  })

  it('every window is reached while Codex names a reached limit (rateLimitReachedType), whatever its use', () => {
    const windows = codexLimitWindows(snapshot({ rateLimitReachedType: 'workspace_member_credits_depleted', primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1 }, secondary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: 2 } }), NOW, 'read')
    expect(windows.map(({ state }) => state)).toEqual(['reached', 'reached'])
    const absent = { ...snapshot({ primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1 } }), rateLimitReachedType: undefined } as unknown as RateLimitSnapshot
    expect(codexLimitWindows(absent, NOW, 'read')[0]!.state).toBe('ok')
  })
})

describe('the `limits` event of account/rateLimits/updated', () => {
  it('usage-limit-window: the windows of the notification, the used-up one reached, and no status', () => {
    expect(codexLimitsEvent(updated('usage-limit-window'), NOW)).toEqual({
      type: 'limits',
      vendor: 'codex',
      windows: [
        { vendor: 'codex', id: 'primary', label: '5h', usedPercent: 100, windowMinutes: 300, resetsAt: 1793003600, state: 'reached', receivedAt: NOW, source: 'updated' },
        { vendor: 'codex', id: 'secondary', label: 'weekly', usedPercent: 64, windowMinutes: 10080, resetsAt: 1793400000, state: 'ok', receivedAt: NOW, source: 'updated' },
      ],
      status: null,
    })
  })

  it('a reached limit Codex names is the status, without a window or a reset time', () => {
    const event = codexLimitsEvent({ rateLimits: snapshot({ rateLimitReachedType: 'rate_limit_reached' }) }, NOW)
    expect(event.status).toEqual({ text: 'rate_limit_reached', state: 'reached', windowId: null, resetsAt: null })
    expect(codexLimitsEvent({ rateLimits: { ...snapshot({}), rateLimitReachedType: undefined } as unknown as RateLimitSnapshot }, NOW).status).toBeNull()
  })
})

describe('a refusal by the Limits (decision 09)', () => {
  it('usage-limit-window: the 5-hour window ran out and resets — wait for it until its resetsAt', () => {
    const windows = codexLimitWindows(updated('usage-limit-window').rateLimits, NOW, 'updated')
    expect(codexLimitReached(windows)).toEqual({ windowId: 'primary', resetsAt: 1793003600, reason: 'window' })
  })

  it('usage-limit-quota: no window ran out (the plan does not include Codex, or a quota) — nothing to wait for', () => {
    const windows = codexLimitWindows(updated('usage-limit-quota').rateLimits, NOW, 'updated')
    expect(codexLimitReached(windows)).toEqual({ windowId: null, resetsAt: null, reason: 'quota' })
    expect(codexLimitReached([])).toEqual({ windowId: null, resetsAt: null, reason: 'quota' })
  })

  it('a used-up window without a reset time, or without a known use, is nothing to wait for', () => {
    expect(codexLimitReached([codexWindow({ usedPercent: 100, resetsAt: null })])).toEqual({ windowId: null, resetsAt: null, reason: 'quota' })
    expect(codexLimitReached([codexWindow({ usedPercent: null, state: 'reached' })])).toEqual({ windowId: null, resetsAt: null, reason: 'quota' })
    expect(codexLimitReached([codexWindow({ usedPercent: 99.9 })])).toEqual({ windowId: null, resetsAt: null, reason: 'quota' })
  })

  it('of several used-up windows, the one that resets last, in either order', () => {
    const primary = codexWindow({ id: 'primary', usedPercent: 100, resetsAt: 2000 })
    const secondary = codexWindow({ id: 'secondary', usedPercent: 101, resetsAt: 5000 })
    expect(codexLimitReached([primary, secondary])).toEqual({ windowId: 'secondary', resetsAt: 5000, reason: 'window' })
    expect(codexLimitReached([secondary, primary])).toEqual({ windowId: 'secondary', resetsAt: 5000, reason: 'window' })
    expect(codexLimitReached([primary, codexWindow({ id: 'secondary', usedPercent: 100, resetsAt: 2000 })]).windowId).toBe('primary')
  })
})

describe('the `limit_reached` event of a turn\'s error', () => {
  it('usage-limit-window: reads the windows again first; when that fails (the fake\'s script is over), the Session\'s last windows decide — wait', async () => {
    const ask = standIn({})
    const known = codexLimitsEvent(updated('usage-limit-window'), NOW).windows
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    const reached = await codexLimitReachedEvent(ask, refusal('usage-limit-window'), known, () => NOW)
    expect(reached).toEqual({ event: { type: 'limit_reached', vendor: 'codex', windowId: 'primary', resetsAt: 1793003600, reason: 'window' }, windows: known, ordinaryUsageAllowed: null })
    expect(ask.requests).toEqual([{ method: 'account/rateLimits/read', params: { excludeResetCreditDetails: true } }])
    expect(debug).toHaveBeenCalledWith('[codex] reading the Limits after a refusal failed: the last windows of the Session decide', expect.any(Error))
    debug.mockRestore()
  })

  it('usage-limit-quota: nothing to wait for', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    const reached = await codexLimitReachedEvent(standIn({}), refusal('usage-limit-quota'), codexLimitsEvent(updated('usage-limit-quota'), NOW).windows, () => NOW)
    expect(reached?.event).toEqual({ type: 'limit_reached', vendor: 'codex', windowId: null, resetsAt: null, reason: 'quota' })
    debug.mockRestore()
  })

  it('the fresh read decides over the Session\'s last windows, and its ordinaryUsageAllowed is passed on', async () => {
    const fresh = snapshot({ primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1793009999 } })
    const ask = standIn({ 'account/rateLimits/read': () => ({ rateLimits: fresh, ordinaryUsageAllowed: false }) })
    const known = codexLimitsEvent(updated('usage-limit-quota'), NOW).windows
    const reached = await codexLimitReachedEvent(ask, refusal('usage-limit-quota'), known, () => NOW)
    expect(reached).toEqual({
      event: { type: 'limit_reached', vendor: 'codex', windowId: 'primary', resetsAt: 1793009999, reason: 'window' },
      windows: codexLimitWindows(fresh, NOW, 'read'),
      ordinaryUsageAllowed: false,
    })
  })

  it('any other error of a turn is no refusal by the Limits: null, and nothing is asked', async () => {
    const ask = standIn({})
    const other = { ...refusal('usage-limit-window'), error: { message: 'the server is busy', codexErrorInfo: 'serverOverloaded', additionalDetails: null, misalignment: null } } as ErrorNotification
    await expect(codexLimitReachedEvent(ask, other, [], () => NOW)).resolves.toBeNull()
    const none = { ...other, error: { ...other.error, codexErrorInfo: null } } as ErrorNotification
    await expect(codexLimitReachedEvent(ask, none, [], () => NOW)).resolves.toBeNull()
    expect(ask.requests).toEqual([])
  })
})

describe('account/rateLimits/read', () => {
  it('a background read skips the reset-credit details; a read in the foreground asks them', async () => {
    const rateLimits = snapshot({ primary: { usedPercent: 7, windowDurationMins: 300, resetsAt: 9 } })
    const ask = standIn({ 'account/rateLimits/read': () => ({ rateLimits, ordinaryUsageAllowed: true }) })
    await expect(readCodexRateLimits(ask, true, () => NOW)).resolves.toEqual({ windows: codexLimitWindows(rateLimits, NOW, 'read'), ordinaryUsageAllowed: true })
    await expect(readCodexRateLimits(ask, false, () => NOW)).resolves.toMatchObject({ ordinaryUsageAllowed: true })
    expect(ask.requests.map(({ params }) => params)).toEqual([{ excludeResetCreditDetails: true }, {}])
  })

  it('an answer without ordinaryUsageAllowed (an older Codex, the fake) says unknown, not allowed', async () => {
    const ask = standIn({ 'account/rateLimits/read': () => ({ rateLimits: snapshot({}) }) })
    await expect(readCodexRateLimits(ask, true, () => NOW)).resolves.toEqual({ windows: [], ordinaryUsageAllowed: null })
  })

  it('takes the time of the read from the clock, Date.now by default', async () => {
    vi.useFakeTimers({ now: NOW + 5 })
    try {
      const ask = standIn({ 'account/rateLimits/read': () => ({ rateLimits: snapshot({ primary: { usedPercent: 1, windowDurationMins: 300, resetsAt: 9 } }) }) })
      const { windows } = await readCodexRateLimits(ask, true)
      expect(windows[0]!.receivedAt).toBe(NOW + 5)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the poll and the read of the limits part, on a stand-in app-server', () => {
  const SIGNED_IN = { account: { type: 'chatgpt', email: 'user@example.com', planType: 'plus', workspaceName: null }, requiresOpenaiAuth: true }
  const RATE_LIMITS = { rateLimits: snapshot({ primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1793003600 } }) }
  const home = import.meta.dirname

  it('signed in: the account, then the windows; the app-server is closed after', async () => {
    const ask = standIn({ 'account/read': () => SIGNED_IN, 'account/rateLimits/read': () => RATE_LIMITS })
    const part = codexLimitsPart({ start: () => Promise.resolve(ask), codexHome: () => home, now: () => NOW })
    await expect(part.poll(new AbortController().signal)).resolves.toEqual(codexLimitWindows(RATE_LIMITS.rateLimits, NOW, 'read'))
    expect(ask.requests.map(({ method }) => method)).toEqual(['account/read', 'account/rateLimits/read'])
    expect(ask.closed).toBe(1)
  })

  it('no Codex home folder: null, and nothing starts', async () => {
    const start = vi.fn(() => Promise.resolve(standIn({})))
    const part = codexLimitsPart({ start, codexHome: () => join(home, 'no-such-codex-home') })
    await expect(part.poll(new AbortController().signal)).resolves.toBeNull()
    expect(start).not.toHaveBeenCalled()
  })

  it('an aborted poll starts nothing', async () => {
    const start = vi.fn(() => Promise.resolve(standIn({})))
    const quit = new AbortController()
    quit.abort(new Error('the app quits'))
    await expect(codexLimitsPart({ start, codexHome: () => home }).poll(quit.signal)).rejects.toThrow('the app quits')
    expect(start).not.toHaveBeenCalled()
  })

  it('read() asks the windows with their details and the clock\'s time', async () => {
    const ask = standIn({ 'account/rateLimits/read': () => RATE_LIMITS })
    await expect(codexLimitsPart({ start: () => Promise.resolve(ask), now: () => NOW }).read()).resolves.toEqual(codexLimitWindows(RATE_LIMITS.rateLimits, NOW, 'read'))
    expect(ask.requests).toEqual([{ method: 'account/rateLimits/read', params: {} }])
    expect(ask.closed).toBe(1)
  })
})

describe('the ask on an app-server', () => {
  it('withCodex closes the app-server after the answer and after a failure', async () => {
    const ask = standIn({})
    await expect(withCodex(() => Promise.resolve(ask), undefined, () => Promise.resolve('done'))).resolves.toBe('done')
    await expect(withCodex(() => Promise.resolve(ask), new AbortController().signal, () => Promise.reject(new Error('refused')))).rejects.toThrow('refused')
    expect(ask.closed).toBe(2)
  })

  it('useCodex rejects at once with the reason of an abort, closes the app-server, and forgets the signal', async () => {
    const ask = standIn({})
    const quit = new AbortController()
    let late: (reason: Error) => void = () => undefined
    const asking = useCodex(ask, quit.signal, () => new Promise<never>((_, reject) => (late = reject)))
    const remove = vi.spyOn(quit.signal, 'removeEventListener')
    quit.abort(new Error('the app quits'))
    await expect(asking).rejects.toThrow('the app quits')
    expect(ask.closed).toBe(1)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    // The ask that fails after the abort leaves no unhandled rejection.
    late(new Error('the Codex app-server was closed'))
    await Promise.resolve()
  })

  it('useCodex on an app-server whose signal is already aborted closes it without asking', async () => {
    const ask = standIn({})
    const quit = new AbortController()
    quit.abort(new Error('the app quits'))
    const use = vi.fn(() => Promise.resolve('asked'))
    await expect(useCodex(ask, quit.signal, use)).rejects.toThrow('the app quits')
    expect(use).not.toHaveBeenCalled()
    expect(ask.closed).toBe(1)
  })
})

describe('the app\'s app-server for an ask', () => {
  beforeEach(() => {
    started.options.length = 0
    started.made.length = 0
    started.exits.length = 0
  })

  it('runs the pinned Codex of this build in <WORFY_DATA_DIR>/terminal-ai, made first, as the app\'s version', async () => {
    const onEvent = vi.fn()
    const ask = await appCodexStarter(onEvent)
    const cwd = join('/data/root', 'terminal-ai')
    expect(started.made).toEqual([`${cwd} {"recursive":true}`])
    expect(started.options).toEqual([
      { runtime: { packaged: false, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch }, appPath: '/app/path', clientVersion: '1.2.3', cwd, onEvent },
    ])
    await expect(ask.request('account/read', {})).resolves.toBe('answered')
    await expect(ask.close()).resolves.toBeUndefined()
  })

  it('tells the end of the process once it comes, or at once when it already came', async () => {
    const ask = await appCodexStarter(() => undefined)
    const exited = vi.fn()
    ask.onExit(exited)
    expect(exited).not.toHaveBeenCalled()
    expect(started.exits.map(([event]) => event)).toEqual(['exit'])
    started.exits[0]![1]()
    expect(exited).toHaveBeenCalledTimes(1)
    const server = { process: { exitCode: 0, signalCode: null, once: vi.fn() } }
    const { CodexAppServer } = await import('../../src/main/vendors/codex/app-server')
    vi.spyOn(CodexAppServer, 'start').mockResolvedValueOnce(server as never)
    const gone = await appCodexStarter(() => undefined)
    gone.onExit(exited)
    expect(exited).toHaveBeenCalledTimes(2)
    expect(server.process.once).not.toHaveBeenCalled()
  })

  it('the Codex driver carries these parts', () => {
    expect(codexDriver().account).toBe(codexAccount)
    expect(codexDriver().limits).toBe(codexLimits)
  })
})

describe('the folder Codex keeps its sign-in in', () => {
  it('is CODEX_HOME, else ~/.codex', () => {
    expect(codexHomeOf({ CODEX_HOME: '/somewhere/codex' })).toBe('/somewhere/codex')
    expect(codexHomeOf({ CODEX_HOME: '' })).toMatch(/[\\/]\.codex$/)
    expect(codexHomeOf({})).toMatch(/[\\/]\.codex$/)
  })
})

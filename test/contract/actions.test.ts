// The `actions` domain at its boundary (ticket 23): `actions.shipTicket` and `actions.runWave`
// registered through registerIpc, the same wrapper the app uses, over a fake launcher. The
// launcher gets only what the contract describes, a wrong type never reaches it, and the renderer
// gets only the contract's keys back.
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { actionsHandlers } from '../../src/main/ipc/actions'
import { appUrlMatcher, emit, registerIpc } from '../../src/main/ipc/index'
import { actionsLaunchesChanged } from '../../src/shared/ipc/actions'
import { failureReason, handlerFailure, IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { APP_URL, INDEX_HTML } from '../app-url'

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

/** Which renderer the registered handlers trust: the bundled index.html unless a dev server is given. */
async function register(options: { devServerUrl?: string } = {}) {
  const calls: unknown[][] = []
  const launcher = {
    shipTicket: async (...args: [string, string, number]) => {
      calls.push(['shipTicket', ...args])
      if (args[2] === 9) throw new Error('blocked by 08')
      return { nodeId: 'n1', sessionId: 'pending-1', text: '/ship-ticket e 07', cwd: '/secret', extra: true }
    },
    runWave: async (...args: [string, string]) => {
      calls.push(['runWave', ...args])
      return { sessionId: 'o1', text: '/epic-wave волна 1 эпика e', delivery: 'queued' as const, extra: 1 }
    },
    launched: (projectId: string) => {
      calls.push(['launched', projectId])
      return { projectId, revision: 3, tickets: [{ epic: 'e', num: 7, sessionId: 'secret' }], extra: true }
    },
  }
  const handlers = new Map<string, Listener>()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
    { modules: { './actions.ts': async () => actionsHandlers(() => launcher) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML, devServerUrl: options.devServerUrl }) },
  )
  const invokeFrom = async (frameUrl: string, channel: string, input: unknown): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}${channel}`)
    if (!listener) throw new Error(`${channel} is not registered`)
    return (await listener({ senderFrame: { url: frameUrl }, sender: {} } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  }
  const invoke = (channel: string, input: unknown): Promise<IpcResult<unknown>> => invokeFrom(APP_URL, channel, input)
  return { invoke, invokeFrom, calls }
}

describe('actions.shipTicket', () => {
  it('passes only the Project, the Epic and the number, and answers only the contract keys', async () => {
    const { invoke, calls } = await register()
    const result = await invoke('actions.shipTicket', { projectId: 'p', epic: 'e', num: 7, template: '/rm -rf', extra: true })
    expect(result).toStrictEqual({ ok: true, value: { nodeId: 'n1', sessionId: 'pending-1', text: '/ship-ticket e 07' } })
    expect(calls).toStrictEqual([['shipTicket', 'p', 'e', 7]])
  })

  it('refuses a wrong type before the launcher runs', async () => {
    const { invoke, calls } = await register()
    for (const input of [
      { projectId: 'p', epic: 'e', num: '7' },
      { projectId: 'p', epic: '../e', num: 7 },
      { projectId: 'p', epic: 'e', num: -1 },
      { projectId: 'p', epic: 'e', num: 1.5 },
      { projectId: '', epic: 'e', num: 7 },
      { epic: 'e', num: 7 },
      undefined,
    ]) {
      const result = await invoke('actions.shipTicket', input)
      expect(result.ok, JSON.stringify(input)).toBe(false)
      expect(!result.ok && result.error, JSON.stringify(input)).toMatch(/actions\.shipTicket: invalid input/)
    }
    expect(calls).toEqual([])
  })

  it('answers the launcher\'s refusal as {ok:false}, from which the renderer takes the reason alone', async () => {
    const { invoke } = await register()
    const result = await invoke('actions.shipTicket', { projectId: 'p', epic: 'e', num: 9 })
    expect(result).toEqual({ ok: false, error: handlerFailure('actions.shipTicket', 'blocked by 08') })
    // The button shows only the reason, however the wrapper words the failure.
    expect(failureReason('actions.shipTicket', (result as { error: string }).error)).toBe('blocked by 08')
    // Any other failure stays whole: an invalid input says so rather than losing its start.
    const invalid = await invoke('actions.shipTicket', { projectId: 'p', epic: 'e', num: 'x' })
    expect(invalid.ok).toBe(false)
    const error = (invalid as { error: string }).error
    expect(failureReason('actions.shipTicket', error)).toBe(error)
    expect(failureReason('actions.runWave', handlerFailure('actions.shipTicket', 'blocked by 08'))).toBe('actions.shipTicket failed: blocked by 08')
  })
})

describe('actions.runWave', () => {
  it('passes only the Project and the Epic, and answers only the contract keys', async () => {
    const { invoke, calls } = await register()
    const result = await invoke('actions.runWave', { projectId: 'p', epic: 'e', wave: 3 })
    expect(result).toStrictEqual({ ok: true, value: { sessionId: 'o1', text: '/epic-wave волна 1 эпика e', delivery: 'queued' } })
    expect(calls).toStrictEqual([['runWave', 'p', 'e']])
  })

  it('refuses a wrong type before the launcher runs', async () => {
    const { invoke, calls } = await register()
    for (const input of [{ projectId: 'p', epic: 7 }, { projectId: 'p', epic: 'a/b' }, { projectId: 'p' }]) {
      const result = await invoke('actions.runWave', input)
      expect(result.ok, JSON.stringify(input)).toBe(false)
      expect(!result.ok && result.error, JSON.stringify(input)).toMatch(/actions\.runWave: invalid input/)
    }
    expect(calls).toEqual([])
  })
})

describe('actions.launches', () => {
  it('passes only the Project, and answers only the contract keys', async () => {
    const { invoke, calls } = await register()
    const result = await invoke('actions.launches', { projectId: 'p', epic: 'e' })
    expect(result).toStrictEqual({ ok: true, value: { projectId: 'p', revision: 3, tickets: [{ epic: 'e', num: 7 }] } })
    expect(calls).toStrictEqual([['launched', 'p']])
  })

  it('refuses a wrong type before the launcher runs', async () => {
    const { invoke, calls } = await register()
    for (const input of [{ projectId: '' }, { projectId: 7 }, {}, undefined]) {
      const result = await invoke('actions.launches', input)
      expect(result.ok, JSON.stringify(input)).toBe(false)
      expect(!result.ok && result.error, JSON.stringify(input)).toMatch(/actions\.launches: invalid input/)
    }
    expect(calls).toEqual([])
  })
})

describe('actions.launches.changed', () => {
  it('sends only the contract keys, and refuses a payload of the wrong type', () => {
    const sent: unknown[][] = []
    const target = { send: (...args: unknown[]) => sent.push(args) }
    const extra = { projectId: 'p', revision: 2, tickets: [{ epic: 'e', num: 7, sessionId: 'secret' }], extra: true }
    emit(target, actionsLaunchesChanged, extra as unknown as Parameters<typeof emit<typeof actionsLaunchesChanged>>[2])
    expect(sent).toStrictEqual([[`${IPC_CHANNEL_PREFIX}actions.launches.changed`, { projectId: 'p', revision: 2, tickets: [{ epic: 'e', num: 7 }] }]])
    expect(() => emit(target, actionsLaunchesChanged, { projectId: 'p', revision: -1, tickets: [] })).toThrow('invalid event payload')
    expect(() => emit(target, actionsLaunchesChanged, { projectId: 'p', revision: 1, tickets: [{ epic: '../e', num: 7 }] })).toThrow('invalid event payload')
    expect(sent).toHaveLength(1)
  })
})

// In a dev run (ELECTRON_RENDERER_URL, ticket worfy-daily/16) the window loads from the dev server,
// and the sender check trusts that origin: any page of it, and nothing else. A packaged app never
// gets here with the variable (test/unit/renderer-entry.test.ts).
describe('the sender check with a dev server', () => {
  const DEV_SERVER = 'http://localhost:5173'

  it('accepts a call from any page of the dev server origin', async () => {
    const { invokeFrom, calls } = await register({ devServerUrl: DEV_SERVER })
    expect(await invokeFrom(`${DEV_SERVER}/`, 'actions.launches', { projectId: 'p' })).toMatchObject({ ok: true })
    expect(await invokeFrom(`${DEV_SERVER}/nested/page.html?x=1#y`, 'actions.launches', { projectId: 'p' })).toMatchObject({ ok: true })
    expect(calls).toStrictEqual([['launched', 'p'], ['launched', 'p']])
  })

  it.each([
    ['another port', 'http://localhost:5174/'],
    ['another host', 'http://127.0.0.1:5173/'],
    ['another scheme', 'https://localhost:5173/'],
    ['the bundled index.html', APP_URL],
    ['a Card', 'worfy-card://abc/index.html'],
    ['an opaque origin', 'data:text/html,hi'],
    ['a frame URL that does not parse', 'not a url'],
  ])('refuses a call from %s before the launcher runs', async (_what, frameUrl) => {
    const { invokeFrom, calls } = await register({ devServerUrl: DEV_SERVER })
    const result = await invokeFrom(frameUrl, 'actions.launches', { projectId: 'p' })
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.error).toContain('untrusted frame')
    expect(calls).toEqual([])
  })

  it.each(['not a url', 'localhost:5173', 'about:blank', 'file:///tmp/index.html'])(
    'refuses to build a check from the dev server address %j instead of trusting what it parses to',
    (devServerUrl) => {
      expect(() => appUrlMatcher({ indexHtml: INDEX_HTML, devServerUrl })).toThrow('not an http(s) URL')
    },
  )
})

// The `actions` domain at its boundary (ticket 23): `actions.shipTicket` and `actions.runWave`
// registered through registerIpc, the same wrapper the app uses, over a fake launcher. The
// launcher gets only what the contract describes, a wrong type never reaches it, and the renderer
// gets only the contract's keys back.
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { actionsHandlers } from '../../src/main/ipc/actions'
import { appUrlMatcher, registerIpc } from '../../src/main/ipc/index'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'

const INDEX_HTML = '/Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

async function register() {
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
  }
  const handlers = new Map<string, Listener>()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
    { modules: { './actions.ts': async () => actionsHandlers(() => launcher) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) },
  )
  const invoke = async (channel: string, input: unknown): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}${channel}`)
    if (!listener) throw new Error(`${channel} is not registered`)
    return (await listener({ senderFrame: { url: `file://${INDEX_HTML}` }, sender: {} } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  }
  return { invoke, calls }
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
      expect((await invoke('actions.shipTicket', input)).ok, JSON.stringify(input)).toBe(false)
    }
    expect(calls).toEqual([])
  })

  it('answers the launcher\'s refusal as {ok:false} with its reason', async () => {
    const { invoke } = await register()
    expect(await invoke('actions.shipTicket', { projectId: 'p', epic: 'e', num: 9 })).toEqual({ ok: false, error: 'actions.shipTicket failed: blocked by 08' })
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
      expect((await invoke('actions.runWave', input)).ok, JSON.stringify(input)).toBe(false)
    }
    expect(calls).toEqual([])
  })
})

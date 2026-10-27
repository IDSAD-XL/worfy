// A dial in progress, as the windows see it (worfy-link ticket 37): the row's "Reconnect" is inactive
// while worfy dials. LinkConnections says whether a dial to a Machine runs (isDialing) and announces
// both its start and its end with 'changed', and `link.state` carries it as `dialing` of the Linked
// machine. The IPC half goes through the real `link` handlers (src/main/ipc/link.ts) and the
// dispatcher that checks their answers against the shared schema, over a real service on the bench
// whose dials the test holds open and ends by hand.
import { EventEmitter } from 'node:events'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerIpc } from '../../src/main/ipc/index'
import { LinkConnections } from '../../src/main/link/connections'
import { wireAppLink, type AppLink, type LinkService } from '../../src/main/link/service'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { LinkState } from '../../src/shared/ipc/link'
import { LinkBench } from './link-bench'

const app = vi.hoisted(() => ({ link: undefined as AppLink | undefined }))

vi.mock('../../src/main/link/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/link/service')>()),
  appLink: () => app.link,
  appLinkService: () => app.link?.service,
}))

// The handlers send `link.changed` to the windows; there are none.
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))

/** A dial the test ends by hand. */
interface HeldDial {
  fail: (reason: string) => void
}

/** The part of LinkService that LinkConnections dials through; every dial waits for the test. */
class HeldService extends EventEmitter {
  readonly id = '66666666-6666-4666-8666-666666666666'
  isStopped = false
  readonly dials: HeldDial[] = []

  connect(): Promise<void> {
    return new Promise((_resolve, reject) => this.dials.push({ fail: (reason) => reject(new Error(reason)) }))
  }

  isConnected(): boolean {
    return false
  }

  linkedMachines(): { id: string; address: string; port: number }[] {
    return [{ id: this.id, address: '192.168.1.30', port: 53000 }]
  }
}

const keepers: LinkConnections[] = []

afterEach(() => {
  for (const keeper of keepers.splice(0)) keeper.stop()
})

describe('LinkConnections: a dial in progress', () => {
  it('isDialing is true from the start of a dial to its end, and both are announced with changed', async () => {
    const service = new HeldService()
    const keeper = new LinkConnections(service as unknown as LinkService, { firstDelayMs: 60_000, maxDelayMs: 60_000 })
    keepers.push(keeper)
    const seen: boolean[] = []
    keeper.on('changed', () => seen.push(keeper.isDialing(service.id)))

    expect(keeper.isDialing(service.id)).toBe(false)
    keeper.start()
    expect(service.dials).toHaveLength(1)
    expect(keeper.isDialing(service.id)).toBe(true)
    // The start is announced while the dial runs: a window learns of it without waiting for the end.
    expect(seen).toEqual([true])

    service.dials[0]?.fail('unreachable')
    await vi.waitFor(() => expect(keeper.isDialing(service.id)).toBe(false))
    expect(seen.at(-1)).toBe(false)

    // `link.reconnect`: a new dial starts, announced again.
    keeper.reconnect(service.id)
    expect(service.dials).toHaveLength(2)
    expect(keeper.isDialing(service.id)).toBe(true)
    expect(seen.at(-1)).toBe(true)
  })

  it('an unknown Machine is not dialling', () => {
    const keeper = new LinkConnections(new HeldService() as unknown as LinkService)
    keepers.push(keeper)
    expect(keeper.isDialing('77777777-7777-4777-8777-777777777777')).toBe(false)
  })
})

type Handler = (event: IpcMainInvokeEvent, input: unknown) => Promise<IpcResult<unknown>>

describe('link.state: dialing of a Linked machine', () => {
  let bench: LinkBench

  beforeEach(() => {
    bench = new LinkBench()
  })

  afterEach(async () => {
    const link = app.link
    app.link = undefined
    link?.connections.stop()
    link?.sleep.stop()
    await bench.close()
  })

  it('is true while a dial runs, started by link.reconnect too, and absent once it ended', async () => {
    const a = await bench.machine('alpha')
    const b = await bench.machine('beta')
    await bench.link(a, b)
    const bId = b.service.machine.id
    await b.service.stop()
    await vi.waitFor(() => expect(a.service.isConnected(bId)).toBe(false))

    const dials: HeldDial[] = []
    vi.spyOn(a.service, 'connect').mockImplementation(() => new Promise((_resolve, reject) => dials.push({ fail: (reason) => reject(new Error(reason)) })))
    app.link = wireAppLink(a.service, { bonjour: false, retry: { firstDelayMs: 60_000, maxDelayMs: 60_000 } })
    const handlers = new Map<string, Handler>()
    await registerIpc(
      { handle: (channel, listener) => handlers.set(channel, listener as Handler) },
      { modules: { './link.ts': () => import('../../src/main/ipc/link').then((module) => module.default) }, isTrustedSender: () => true },
    )
    const window = { id: 1, send: () => undefined, isDestroyed: () => false, once: () => undefined }
    const event = { senderFrame: { url: 'app://worfy/index.html' }, sender: window } as unknown as IpcMainInvokeEvent
    const call = async (name: string, input?: unknown): Promise<LinkState> => {
      const result = await handlers.get(`${IPC_CHANNEL_PREFIX}${name}`)?.(event, input)
      if (result?.ok !== true) throw new Error(`${name}: ${result?.ok === false ? result.error : 'not registered'}`)
      return result.value as LinkState
    }
    const dialingOf = (state: LinkState) => state.linked.find((machine) => machine.id === bId)?.dialing

    // The dial of the start runs.
    await vi.waitFor(() => expect(dials).toHaveLength(1))
    expect(dialingOf(await call('link.state'))).toBe(true)
    dials[0]?.fail('unreachable')
    await vi.waitFor(async () => expect(dialingOf(await call('link.state'))).toBeUndefined())

    // "Reconnect": its answer already says the dial runs.
    expect(dialingOf(await call('link.reconnect', { id: bId }))).toBe(true)
    expect(dials).toHaveLength(2)
    dials[1]?.fail('unreachable')
    await vi.waitFor(async () => expect(dialingOf(await call('link.state'))).toBeUndefined())
  })
})

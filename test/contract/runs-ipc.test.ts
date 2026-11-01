// The `runs` IPC domain (src/shared/ipc/runs.ts, src/main/ipc/runs.ts; worfy-flight-recorder ticket 17): the
// channels are `project` and `read`, so a window on a Linked machine reads the Runs on the Machine where they
// ran (decision 01, Q7), also with read-only access; with access off it gets neither the calls nor
// `runs.changed`, and the Runs it held open are let go. The handlers run over the link adapter as the app
// registers them (createLinkIpc), on a service stand-in: what the service computes is
// flight-recorder-service.test.ts's.
import { afterEach, describe, expect, it } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { ClientId } from '../../src/main/clients'
import type { FlightRecorder, RunSubscriber } from '../../src/main/flight-recorder/service'
import { handlerModules, registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import { runsHandlers } from '../../src/main/ipc/runs'
import { accessOffRefusal, createLinkIpc, LinkPeer } from '../../src/main/link/ipc-adapter'
import { accessOf, IPC_CHANNEL_PREFIX, useOf } from '../../src/shared/ipc/channels'
import { runsChanged, runsClose, runsList, runsOpen, runsRetry, runViewSchema, type RunView } from '../../src/shared/ipc/runs'
import type { AccessLevel } from '../../src/shared/ipc/link'

const MACHINE = 'Studio'
const RUN = '2026-10-17T22-29-32-707Z-58e783'
const PROJECT = 'demo-0a1b2c3d'

const VIEW: RunView = {
  projectId: PROJECT,
  run: RUN,
  epic: 'e',
  timeline: { runId: RUN, live: true, now: 2, spans: [], blocks: [], orchestratorMarks: [] },
  summary: { topStages: [], waits: [], work: [], workNote: 'summed; parallel', runDuration: 0 },
  github: { state: 'no-answer', at: 1, reason: 'gh failed' },
  repoUrl: 'https://github.com/someone/demo',
  profileReason: null,
  skippedLines: 0,
  error: null,
}

/** A service that answers VIEW and keeps who holds which Run. */
function stubService() {
  const subscribers = new Map<ClientId, RunSubscriber>()
  const calls: string[] = []
  const service: Pick<FlightRecorder, 'list' | 'open' | 'close' | 'drop' | 'retry'> = {
    list: async (projectId, epic) => {
      calls.push(`list ${projectId} ${epic ?? '-'}`)
      return [{ run: RUN, epic: 'e', startedAt: '2026-10-17T22:29:32.707Z', stoppedAt: null, reason: null, live: true, tickets: ['e/01'], by: 'button' }]
    },
    open: async (projectId, run, subscriber) => {
      calls.push(`open ${projectId} ${run}`)
      subscribers.set(subscriber.id, subscriber)
      return VIEW
    },
    close: (projectId, run, id) => {
      calls.push(`close ${projectId} ${run}`)
      return subscribers.delete(id)
    },
    drop: (id) => {
      calls.push('drop')
      subscribers.delete(id)
    },
    retry: async (projectId, run) => {
      calls.push(`retry ${projectId} ${run}`)
      return VIEW
    },
  }
  return { service, subscribers, calls, changed: () => [...subscribers.values()].forEach((subscriber) => subscriber.send({ ...VIEW, timeline: { ...VIEW.timeline, now: 3 } })) }
}

const peers: LinkPeer[] = []
afterEach(() => {
  for (const peer of peers.splice(0)) peer.close()
})

async function linked(level: AccessLevel) {
  const stub = stubService()
  const adapter = await createLinkIpc({ modules: { './runs.ts': async () => runsHandlers(async () => stub.service) }, isLinked: () => true })
  const got: [string, unknown][] = []
  const peer = new LinkPeer({ machineId: 'mac', describe: () => 'mac', push: (channel, payload) => got.push([channel, payload]), local: () => ({ id: 'here', name: MACHINE, protocol: 1, build: 'test' }), warn: () => undefined })
  peer.setAccess(level)
  peers.push(peer)
  return { stub, adapter, peer, got, call: (channel: string, input: unknown) => adapter.call(peer, channel, input, MACHINE) }
}

describe('the runs channels', () => {
  it('are `project` and `read`, and the handler module is found by the IPC index', () => {
    for (const channel of [runsList, runsOpen, runsClose, runsRetry, runsChanged]) {
      expect(accessOf(channel.name), channel.name).toBe('project')
      expect(useOf(channel.name), channel.name).toBe('read')
    }
    expect(Object.keys(handlerModules)).toContain('./runs.ts')
  })

  it('a Linked machine with read-only access lists the Runs, opens one, gets runs.changed, asks «Retry» and closes it', async () => {
    const machine = await linked('read')
    expect(machine.adapter.channels().sort()).toEqual(['runs.close', 'runs.list', 'runs.open', 'runs.retry'])
    expect(await machine.call('runs.list', { projectId: PROJECT, epic: 'e' })).toMatchObject({ ok: true, value: { runs: [{ run: RUN }] } })
    expect(await machine.call('runs.open', { projectId: PROJECT, run: RUN })).toEqual({ ok: true, value: runViewSchema.parse(VIEW) })
    machine.stub.changed()
    expect(machine.got.filter(([name]) => name === 'runs.changed').map(([, view]) => (view as RunView).timeline.now)).toEqual([3])
    expect(await machine.call('runs.retry', { projectId: PROJECT, run: RUN })).toMatchObject({ ok: true })
    expect(await machine.call('runs.close', { projectId: PROJECT, run: RUN })).toEqual({ ok: true, value: { closed: true } })
    expect(machine.stub.calls).toEqual([`list ${PROJECT} e`, `open ${PROJECT} ${RUN}`, `retry ${PROJECT} ${RUN}`, `close ${PROJECT} ${RUN}`])
  })

  it('with access off a Linked machine gets no call through, and the Runs it held are let go with no more runs.changed', async () => {
    const off = await linked('off')
    for (const [channel, input] of [
      ['runs.list', { projectId: PROJECT }],
      ['runs.open', { projectId: PROJECT, run: RUN }],
      ['runs.retry', { projectId: PROJECT, run: RUN }],
      ['runs.close', { projectId: PROJECT, run: RUN }],
    ] as const) {
      expect(await off.call(channel, input), channel).toEqual({ ok: false, error: accessOffRefusal(MACHINE) })
    }
    expect(off.stub.calls).toEqual([])

    // Access goes off while a Run is open: its client is destroyed, the service drops it, nothing more is pushed.
    const on = await linked('read')
    await on.call('runs.open', { projectId: PROJECT, run: RUN })
    expect(on.stub.subscribers.size).toBe(1)
    on.peer.setAccess('off')
    await new Promise((resolve) => setImmediate(resolve))
    expect(on.stub.calls.at(-1)).toBe('drop')
    expect(on.stub.subscribers.size).toBe(0)
    on.stub.changed()
    expect(on.got.filter(([name]) => name === 'runs.changed')).toEqual([])
  })

  it('refuses a run id that is not one, before the service is asked', async () => {
    const machine = await linked('read')
    const answer = await machine.call('runs.open', { projectId: PROJECT, run: '../../etc/passwd' })
    expect(answer.ok).toBe(false)
    expect(machine.stub.calls).toEqual([])
  })
})

describe('the runs channels of a window', () => {
  const APP_URL = 'app://worfy/index.html'

  /** The handlers as the app registers them for its windows (registerIpc), and one window calling them. */
  async function windowCalls() {
    const stub = stubService()
    const listeners = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
    const ipc: IpcMainLike = { handle: (channel, listener) => listeners.set(channel, listener) }
    await registerIpc(ipc, { modules: { './runs.ts': () => Promise.resolve(runsHandlers(async () => stub.service)) }, isTrustedSender: (url) => url === APP_URL })
    const sender = { id: 'window-1' as ClientId, send: () => undefined, isDestroyed: () => false, once: () => undefined }
    const call = (channel: string, input: unknown) => listeners.get(IPC_CHANNEL_PREFIX + channel)!({ senderFrame: { url: APP_URL }, sender } as unknown as IpcMainInvokeEvent, input)
    return { stub, call }
  }

  // The Run history screen (src/renderer/flight-recorder/store.ts) sends a close and the next open without
  // waiting for the answers, and trusts that the service gets them in that order.
  it('take one window\'s open and close in the order they were sent, the answers not awaited in between', async () => {
    const { stub, call } = await windowCalls()
    const input = { projectId: PROJECT, run: RUN }
    await Promise.all([call('runs.open', input), call('runs.close', input)])
    expect(stub.calls).toEqual([`open ${PROJECT} ${RUN}`, `close ${PROJECT} ${RUN}`])
    expect(stub.subscribers.size).toBe(0)
    await Promise.all([call('runs.open', input), call('runs.close', input), call('runs.open', input)])
    expect(stub.calls.slice(2)).toEqual([`open ${PROJECT} ${RUN}`, `close ${PROJECT} ${RUN}`, `open ${PROJECT} ${RUN}`])
    expect([...stub.subscribers.keys()]).toEqual(['window-1'])
  })
})

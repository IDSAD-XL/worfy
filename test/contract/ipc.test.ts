import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { appUrlMatcher, defineHandler, emit, handlerModules, registerIpc, type HandlerModule, type IpcMainLike } from '../../src/main/ipc/index'
import { createLinkIpc, LinkPeer } from '../../src/main/link/ipc-adapter'
import { invokeChannel, IPC_CHANNEL_PREFIX, LINKED_MACHINE_ACCESS, type IpcResult } from '../../src/shared/ipc/channels'
import { linkPing } from '../../src/shared/ipc/link'
import { APP_URL, INDEX_HTML } from '../app-url'
import { echoCalls } from './ipc-sample/main/sample'
import { sampleEcho, sampleFail, sampleLeak, sampleTicked } from './ipc-sample/shared/sample'

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

/** Stands in for Electron's ipcMain: keeps the registered handlers so a test can call them. */
function fakeIpcMain() {
  const handlers = new Map<string, Listener>()
  const ipc: IpcMainLike = {
    handle(channel, listener) {
      if (handlers.has(channel)) throw new Error(`second handler for ${channel}`)
      handlers.set(channel, listener)
    },
  }
  const call = async (channel: string, input: unknown, frameUrl: string | null = APP_URL): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    const event = { senderFrame: frameUrl === null ? null : { url: frameUrl } } as unknown as IpcMainInvokeEvent
    return (await listener(event, input)) as IpcResult<unknown>
  }
  return { ipc, handlers, call }
}

// The sample domain lives in two new files only (ipc-sample/shared/sample.ts and
// ipc-sample/main/sample.ts); they reach the router through the same glob discovery that
// src/main/ipc/index.ts uses for src/main/ipc/*.ts.
const sampleModules = import.meta.glob<unknown>('./ipc-sample/main/*.ts', { import: 'default' })

async function withSample() {
  echoCalls.length = 0
  const fake = fakeIpcMain()
  const names = await registerIpc(fake.ipc, { modules: sampleModules, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
  return { ...fake, names }
}

describe('IPC handler registration', () => {
  it('rejects an invalid input with the zod error text and keeps serving calls', async () => {
    const { call } = await withSample()
    const result = await call('sample.echo', { text: 42 })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/sample\.echo/)
    expect(!result.ok && result.error).toMatch(/expected string, received number/)
    expect(echoCalls).toEqual([])
    expect(await call('sample.echo', { text: 'still alive' })).toEqual({ ok: true, value: { echoed: 'still alive' } })
    expect(echoCalls).toEqual(['still alive'])
  })

  it('answers a valid input with the parsed output', async () => {
    const { call } = await withSample()
    expect(await call('sample.echo', { text: 'hi' })).toEqual({ ok: true, value: { echoed: 'hi' } })
  })

  it('refuses to send an output that is not in the contract', async () => {
    const { call } = await withSample()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const result = await call('sample.leak', { reply: { count: 'many', secret: 'x' } })
      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toMatch(/invalid output/)
      expect(JSON.stringify(result)).not.toContain('many')
      expect(await call('sample.leak', { reply: { count: 3 } })).toEqual({ ok: true, value: { count: 3 } })
    } finally {
      error.mockRestore()
    }
  })

  it('strips keys the contract does not declare from the handler output', async () => {
    const { call } = await withSample()
    // The handler returns a valid count plus a key that is not in the output schema: the caller
    // gets the parsed value, never the raw object the handler built (ADR-0006).
    const result = await call('sample.leak', { reply: { count: 3, secret: 'token-from-main' } })
    expect(result).toStrictEqual({ ok: true, value: { count: 3 } })
    expect(JSON.stringify(result)).not.toContain('token-from-main')
  })

  it('turns an exception in the handler into {ok:false}', async () => {
    const { call } = await withSample()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const result = await call('sample.fail', undefined)
      expect(result).toEqual({ ok: false, error: expect.stringMatching(/sample\.fail.*the sample handler broke/) })
    } finally {
      error.mockRestore()
    }
  })

  it('rejects a call from a frame that is not the app window, without running the handler', async () => {
    const { call } = await withSample()
    for (const frameUrl of ['https://example.com/', 'file:///tmp/other/index.html', null]) {
      const result = await call('sample.echo', { text: `from ${String(frameUrl)}` }, frameUrl)
      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toMatch(/untrusted/)
    }
    // The handler never ran for a foreign frame: not before the check, not hidden behind the rejection.
    expect(echoCalls).toEqual([])
    expect(await call('sample.echo', { text: 'hi' }, `${APP_URL}#/canvas`)).toEqual({ ok: true, value: { echoed: 'hi' } })
    expect(echoCalls).toEqual(['hi'])
  })

  it('registers a new domain from its two files without touching the central ones', async () => {
    const { names, handlers } = await withSample()
    expect(names).toEqual(['sample.echo', 'sample.leak', 'sample.fail'])
    expect([...handlers.keys()]).toEqual(['worfy:sample.echo', 'worfy:sample.leak', 'worfy:sample.fail'])
  })

  it('discovers every src/main/ipc/<domain>.ts and skips index.ts itself', () => {
    expect(Object.keys(handlerModules)).toContain('./app.ts')
    expect(Object.keys(handlerModules)).not.toContain('./index.ts')
  })

  it('fails loudly when two modules handle the same channel', async () => {
    const fake = fakeIpcMain()
    await expect(
      registerIpc(fake.ipc, { modules: { ...sampleModules, './again.ts': sampleModules['./ipc-sample/main/sample.ts']! }, isTrustedSender: () => true }),
    ).rejects.toThrow(/sample\.echo.*more than once/)
  })

  it('rejects a module whose default export is not a list of handlers', async () => {
    const fake = fakeIpcMain()
    await expect(registerIpc(fake.ipc, { modules: { './broken.ts': async () => ({ nope: true }) }, isTrustedSender: () => true })).rejects.toThrow(
      /broken\.ts/,
    )
  })
})

describe('app URL matcher', () => {
  it('accepts only the bundled index.html in a packaged run', () => {
    const trusted = appUrlMatcher({ indexHtml: INDEX_HTML })
    // The URL is written out here once. test/app-url.ts builds it with pathToFileURL, as the matcher
    // does; on Windows the drive of the working directory stands before the path.
    expect(APP_URL).toMatch(/^file:\/\/\/([A-Za-z]:\/)?Applications\/worfy\.app\/Contents\/Resources\/app\/out\/renderer\/index\.html$/)
    expect(trusted(APP_URL)).toBe(true)
    expect(trusted(`${APP_URL}?x=1#y`)).toBe(true)
    // Another file of the same folder: only the file name differs from the trusted URL.
    expect(trusted(new URL('other.html', APP_URL).href)).toBe(false)
    expect(trusted('http://localhost:5173/')).toBe(false)
    expect(trusted('not a url')).toBe(false)
  })

  it('accepts only the dev server origin when one is set', () => {
    const trusted = appUrlMatcher({ indexHtml: INDEX_HTML, devServerUrl: 'http://localhost:5173' })
    expect(trusted('http://localhost:5173/index.html')).toBe(true)
    expect(trusted('http://localhost:5174/')).toBe(false)
    expect(trusted(APP_URL)).toBe(false)
  })
})

describe('events from main', () => {
  it('sends a payload that matches the contract under the prefixed channel', () => {
    const send = vi.fn()
    emit({ send }, sampleTicked, { n: 1 })
    expect(send).toHaveBeenCalledWith('worfy:sample.ticked', { n: 1 })
  })

  it('throws instead of sending a payload outside the contract', () => {
    const send = vi.fn()
    expect(() => emit({ send }, sampleTicked, { n: 1.5 })).toThrow(/sample\.ticked/)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('the channel filter (worfy-link ticket 08)', () => {
  // The sample domain carries every mark but `link`: sample.echo `project`, sample.leak `local`,
  // sample.fail `desktop`; link.ping brings the `link` one. Each handler counts its calls.
  const ran: string[] = []
  const modules: Record<string, () => Promise<HandlerModule>> = {
    './sample.ts': async () => [
      defineHandler(sampleEcho, ({ text }) => {
        ran.push(`sample.echo ${text}`)
        return { echoed: text }
      }),
      defineHandler(sampleLeak, () => {
        ran.push('sample.leak')
        return { count: 1 }
      }),
      defineHandler(sampleFail, () => {
        ran.push('sample.fail')
      }),
    ],
    './link.ts': async () => [
      defineHandler(linkPing, () => {
        ran.push('link.ping')
        return { id: MACHINE, name: 'beta', protocol: 1, build: '0.2.0+test' }
      }),
    ],
  }
  const MACHINE = randomUUID()

  it('registerIpc with a filter registers only the channels it accepts; without one, every channel', async () => {
    const linked = fakeIpcMain()
    const names = await registerIpc(linked.ipc, { modules, isTrustedSender: () => true, channels: (channel) => LINKED_MACHINE_ACCESS.includes(channel.access) })
    expect(names).toEqual(['link.ping', 'sample.echo'])
    expect([...linked.handlers.keys()]).toEqual(['worfy:link.ping', 'worfy:sample.echo'])

    const windows = fakeIpcMain()
    expect(await registerIpc(windows.ipc, { modules, isTrustedSender: () => true })).toEqual(['link.ping', 'sample.echo', 'sample.leak', 'sample.fail'])
  })

  it('the link adapter answers a filtered or unknown channel "not open to Linked machines" before the input is parsed; the handler never runs', async () => {
    ran.length = 0
    const adapter = await createLinkIpc({ modules, isLinked: (id) => id === MACHINE })
    expect(adapter.channels()).toEqual(['link.ping', 'sample.echo'])
    const warnings: string[] = []
    const peer = new LinkPeer({
      machineId: MACHINE,
      describe: () => `${MACHINE} (alpha)`,
      push: () => undefined,
      local: () => ({ id: MACHINE, name: 'beta', protocol: 1, build: '0.2.0+test' }),
      warn: (message) => warnings.push(message),
    })
    peer.setAccess('all')
    for (const [channel, input] of [
      ['sample.fail', undefined],
      ['sample.leak', { reply: { count: 1 } }],
      // An input the schema would refuse: the refusal comes first all the same.
      ['sample.fail', { not: 'void' }],
      ['nobody.declares.this', undefined],
    ] as const) {
      expect(await adapter.call(peer, channel, input, 'beta'), channel).toEqual({ ok: false, error: `${channel}: not open to Linked machines` })
    }
    expect(ran).toEqual([])
    // The refusals are logged with the channel and the Machine.
    expect(warnings).toHaveLength(4)
    expect(warnings[0]).toBe(`[link] "sample.fail" from Machine ${MACHINE} (alpha) refused: not open to Linked machines`)

    expect(await adapter.call(peer, 'sample.echo', { text: 'hi' }, 'beta')).toEqual({ ok: true, value: { echoed: 'hi' } })
    expect(await adapter.call(peer, 'link.ping', undefined, 'beta')).toMatchObject({ ok: true })
    expect(ran).toEqual(['sample.echo hi', 'link.ping'])
  })

  it('with access off every call but a `link` one is refused "access is off"; the handler never runs', async () => {
    ran.length = 0
    const adapter = await createLinkIpc({ modules, isLinked: (id) => id === MACHINE })
    const peer = new LinkPeer({ machineId: MACHINE, describe: () => MACHINE, push: () => undefined, local: () => ({ id: MACHINE, name: 'beta', protocol: 1, build: 'x' }), warn: () => undefined })
    const off = { ok: false, error: 'Linked machines cannot work with the Projects of beta: access is off' }
    expect(await adapter.call(peer, 'sample.echo', { text: 'hi' }, 'beta')).toEqual(off)
    expect(await adapter.call(peer, 'sample.fail', undefined, 'beta')).toEqual(off)
    expect(await adapter.call(peer, 'nobody.declares.this', undefined, 'beta')).toEqual(off)
    expect(await adapter.call(peer, 'link.ping', undefined, 'beta')).toMatchObject({ ok: true })
    // On, then off again: the `project` client is gone and the calls are refused once more.
    peer.setAccess('all')
    expect(await adapter.call(peer, 'sample.echo', { text: 'on' }, 'beta')).toEqual({ ok: true, value: { echoed: 'on' } })
    peer.setAccess('off')
    expect(await adapter.call(peer, 'sample.echo', { text: 'off' }, 'beta')).toEqual(off)
    expect(ran).toEqual(['link.ping', 'sample.echo on'])
  })

  it('a call from a Machine that is not linked is refused by the trust check, even on an open channel', async () => {
    ran.length = 0
    const adapter = await createLinkIpc({ modules, isLinked: () => false })
    const peer = new LinkPeer({ machineId: MACHINE, describe: () => MACHINE, push: () => undefined, local: () => ({ id: MACHINE, name: 'beta', protocol: 1, build: 'x' }), warn: () => undefined })
    peer.setAccess('all')
    const result = await adapter.call(peer, 'sample.echo', { text: 'hi' }, 'beta')
    expect(!result.ok && result.error).toMatch(/untrusted/)
    expect(ran).toEqual([])
  })
})

describe('a channel name declared twice with two marks (round 2)', () => {
  const MACHINE = randomUUID()
  const peer = () => {
    const made = new LinkPeer({ machineId: MACHINE, describe: () => MACHINE, push: () => undefined, local: () => ({ id: MACHINE, name: 'beta', protocol: 1, build: 'x' }), warn: () => undefined })
    made.setAccess('all')
    return made
  }
  // Test-only channels outside the contract: their handlers are built by hand, defineHandler takes contract channels only.

  it('is not registered on the link adapter, though the definition in hand says `project`; the windows still get it', async () => {
    const asProject = invokeChannel('sample.twice', z.void(), z.object({ ran: z.boolean() }), 'project', 'write')
    invokeChannel('sample.twice', z.void(), z.object({ ran: z.boolean() }), 'local')
    let ran = 0
    const twice: Record<string, () => Promise<HandlerModule>> = {
      './twice.ts': async () => [
        {
          channel: asProject,
          handle: () => {
            ran += 1
            return { ran: true }
          },
        },
      ],
    }
    const adapter = await createLinkIpc({ modules: twice, isLinked: (id) => id === MACHINE })
    expect(adapter.channels()).toEqual([])
    expect(await adapter.call(peer(), 'sample.twice', undefined, 'beta')).toEqual({ ok: false, error: 'sample.twice: not open to Linked machines' })
    expect(ran).toBe(0)
    const windows = fakeIpcMain()
    expect(await registerIpc(windows.ipc, { modules: twice, isTrustedSender: () => true })).toEqual(['sample.twice'])
  })

  it('declared again with another mark after the adapter registered it: the call is refused, the handler never runs', async () => {
    const first = invokeChannel('sample.later', z.void(), z.object({ ran: z.boolean() }), 'project', 'write')
    let ran = 0
    const later: Record<string, () => Promise<HandlerModule>> = {
      './later.ts': async () => [
        {
          channel: first,
          handle: () => {
            ran += 1
            return { ran: true }
          },
        },
      ],
    }
    const adapter = await createLinkIpc({ modules: later, isLinked: (id) => id === MACHINE })
    expect(adapter.channels()).toEqual(['sample.later'])
    expect(await adapter.call(peer(), 'sample.later', undefined, 'beta')).toEqual({ ok: true, value: { ran: true } })
    invokeChannel('sample.later', z.void(), z.object({ ran: z.boolean() }), 'local')
    expect(await adapter.call(peer(), 'sample.later', undefined, 'beta')).toEqual({ ok: false, error: 'sample.later: not open to Linked machines' })
    expect(ran).toBe(1)
  })
})

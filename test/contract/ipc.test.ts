import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { appUrlMatcher, emit, handlerModules, registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { echoCalls } from './ipc-sample/main/sample'
import { sampleTicked } from './ipc-sample/shared/sample'

const APP_URL = 'file:///Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'

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
  const names = await registerIpc(fake.ipc, { modules: sampleModules, isTrustedSender: appUrlMatcher({ indexHtml: '/Applications/worfy.app/Contents/Resources/app/out/renderer/index.html' }) })
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
    const trusted = appUrlMatcher({ indexHtml: '/app/out/renderer/index.html' })
    expect(trusted('file:///app/out/renderer/index.html')).toBe(true)
    expect(trusted('file:///app/out/renderer/index.html?x=1#y')).toBe(true)
    expect(trusted('file:///app/out/renderer/other.html')).toBe(false)
    expect(trusted('http://localhost:5173/')).toBe(false)
    expect(trusted('not a url')).toBe(false)
  })

  it('accepts only the dev server origin when one is set', () => {
    const trusted = appUrlMatcher({ indexHtml: '/app/out/renderer/index.html', devServerUrl: 'http://localhost:5173' })
    expect(trusted('http://localhost:5173/index.html')).toBe(true)
    expect(trusted('http://localhost:5174/')).toBe(false)
    expect(trusted('file:///app/out/renderer/index.html')).toBe(false)
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

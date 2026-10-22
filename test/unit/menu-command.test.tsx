// Following one command of the app menu in a window (src/renderer/menu-command.ts; worfy-windows
// ticket 96): the page subscribes to `menu.command` first and only then tells main, with
// `menu.ready`, that it follows the command, so a command main held for it finds the listener.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { followMenuCommand } from '../../src/renderer/menu-command'

const globals = globalThis as { worfy?: WorfyBridge }

/** A preload bridge that records, in order, what the page subscribes to and what it calls. */
function recordingBridge(answer: { ok: true; value: undefined } | { ok: false; error: string } = { ok: true, value: undefined }) {
  const log: string[] = []
  const handlers = new Map<number, { channel: string; handler: (payload: unknown) => void }>()
  let next = 1
  globals.worfy = {
    invoke: (channel: string, input: unknown) => {
      log.push(`invoke ${channel} ${String(input)}`)
      return Promise.resolve(answer)
    },
    on: (channel: string, handler: (payload: unknown) => void) => {
      log.push(`on ${channel}`)
      handlers.set(next, { channel, handler })
      return next++
    },
    off: (id: number) => {
      log.push('off')
      handlers.delete(id)
    },
  } as unknown as WorfyBridge
  return {
    log,
    emit: (channel: string, payload: unknown) => {
      for (const each of [...handlers.values()]) if (each.channel === channel) each.handler(payload)
    },
  }
}

afterEach(() => {
  delete globals.worfy
  vi.restoreAllMocks()
})

describe('followMenuCommand', () => {
  it('subscribes to menu.command before it calls menu.ready with its command', () => {
    const bridge = recordingBridge()
    followMenuCommand('settings', () => undefined)
    expect(bridge.log).toEqual(['on menu.command', 'invoke menu.ready settings'])
  })

  it('runs for its own command only, and stops when unsubscribed', () => {
    const bridge = recordingBridge()
    const run = vi.fn()
    const unsubscribe = followMenuCommand('toggleSidebar', run)
    bridge.emit('menu.command', 'settings')
    expect(run).not.toHaveBeenCalled()
    bridge.emit('menu.command', 'toggleSidebar')
    expect(run).toHaveBeenCalledTimes(1)
    unsubscribe()
    bridge.emit('menu.command', 'toggleSidebar')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('says so in the console when main refuses menu.ready, and keeps the subscription', async () => {
    const bridge = recordingBridge({ ok: false, error: 'menu.ready: call rejected' })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const run = vi.fn()
    followMenuCommand('shortcuts', run)
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining("main does not send 'shortcuts'")))
    bridge.emit('menu.command', 'shortcuts')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('without the preload bridge subscribes to nothing and calls nothing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const unsubscribe = followMenuCommand('settings', () => undefined)
    expect(error).toHaveBeenCalledWith('menu.command: cannot subscribe', expect.any(Error))
    expect(() => unsubscribe()).not.toThrow()
  })
})

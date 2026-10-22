// Following one command of the app menu in a window (src/renderer/menu-command.ts; worfy-windows
// ticket 96): the page subscribes to `menu.command` first and only then tells main, with
// `menu.ready`, that it follows the command, so a command main held for it finds the listener.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { MenuCommand } from '../../src/shared/ipc/menu'
import { followMenuCommand } from '../../src/renderer/menu-command'
import { closeSettings, followMenuCommands, useSettingsWindow } from '../../src/renderer/settings/settings-window'
import { followSidebarCommand } from '../../src/renderer/shell/sidebar-visibility'
import { followShortcutsCommands } from '../../src/renderer/shortcuts/shortcuts-window'
import { toasts } from '../../src/renderer/toast/toasts'

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
  toasts.setState({ toasts: [] })
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

  it('without the preload bridge subscribes to nothing, calls nothing and shows no toast', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const unsubscribe = followMenuCommand('settings', () => undefined)
    expect(error).not.toHaveBeenCalled()
    expect(toasts.getState().toasts).toEqual([])
    expect(() => unsubscribe()).not.toThrow()
  })

  it('with the bridge in place, a subscription that fails shows the error toast and calls nothing', () => {
    const bridge = recordingBridge()
    const bridgeOf = globals.worfy as unknown as { on: () => number }
    bridgeOf.on = () => {
      throw new Error('on: channel refused')
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const unsubscribe = followMenuCommand('settings', () => undefined)
    expect(error).toHaveBeenCalledWith('menu.command: cannot subscribe', expect.any(Error))
    // showSubscribeError of src/renderer/ipc.ts: one error toast keyed by the channel.
    expect(toasts.getState().toasts).toEqual([expect.objectContaining({ kind: 'error', key: 'ipc:menu.command' })])
    expect(bridge.log).toEqual([])
    expect(() => unsubscribe()).not.toThrow()
  })
})

// The three subscribers of the app (worfy-windows ticket 103). Each must go through
// followMenuCommand, so that main hears `menu.ready` and sends the command it held for the window.
const subscribers: { command: MenuCommand; follow: () => () => void }[] = [
  { command: 'settings', follow: followMenuCommands },
  { command: 'toggleSidebar', follow: () => followSidebarCommand(() => undefined) },
  { command: 'shortcuts', follow: followShortcutsCommands },
]

describe('the settings subscriber', () => {
  afterEach(() => {
    closeSettings()
    useSettingsWindow.setState({ section: null })
  })

  // The Sidebar and Shortcuts subscribers are pinned by shell.test.tsx and
  // shortcuts-overlay.test.tsx; this one only by e2e until now.
  it("opens the Settings window when the app menu sends 'settings', and only then", () => {
    const bridge = recordingBridge()
    const unsubscribe = followMenuCommands()
    bridge.emit('menu.command', 'toggleSidebar')
    expect(useSettingsWindow.getState().open).toBe(false)
    bridge.emit('menu.command', 'settings')
    expect(useSettingsWindow.getState()).toEqual({ open: true, section: null })
    unsubscribe()
  })
})

describe.each(subscribers)('the $command subscriber', ({ command, follow }) => {
  it(`subscribes to menu.command, then calls menu.ready with '${command}'`, () => {
    const bridge = recordingBridge()
    const unsubscribe = follow()
    expect(bridge.log).toEqual(['on menu.command', `invoke menu.ready ${command}`])
    unsubscribe()
    expect(bridge.log).toEqual(['on menu.command', `invoke menu.ready ${command}`, 'off'])
  })

  it('without the preload bridge shows no toast and does not throw', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let unsubscribe: () => void = () => undefined
    expect(() => {
      unsubscribe = follow()
    }).not.toThrow()
    expect(() => unsubscribe()).not.toThrow()
    expect(toasts.getState().toasts).toEqual([])
    expect(error).not.toHaveBeenCalled()
  })
})

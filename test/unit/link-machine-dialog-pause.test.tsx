// "Link a machine" while linking is paused after too many failed pairing attempts within an hour
// (worfy-link ticket 28, src/main/link/pairing.ts): the dialog shows no code, says until when the
// pause lasts and that a restart of worfy lifts it (the owner's answer of 2026-10-21), and opens
// linking again by itself once the pause is over. Over the real renderer IPC client and a fake
// preload of this Machine.
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { LinkState } from '../../src/shared/ipc/link'

const linkState = (linking: Partial<LinkState['linking']>): LinkState => ({
  revision: 1,
  machine: { id: '11111111-1111-4111-8111-111111111111', name: 'Studio' },
  problem: null,
  listening: true,
  addresses: [],
  bonjour: false,
  linking: { open: true, code: null, expiresAt: null, linked: null, failure: null, ...linking },
  linked: [],
  discovered: [],
  projectsAccess: false,
  keepAwake: false,
})

/** This Machine's preload: `link.state` answers `link`, each `link.open` the next of `opens` (the last one again). */
function preload(link: LinkState, opens: LinkState[] = [link]): { opened: () => number } {
  let opened = 0
  const bridge: WorfyBridge = {
    invoke: (channel) => {
      if (channel === 'link.state') return Promise.resolve({ ok: true, value: link } as never)
      if (channel === 'link.open') {
        const value = opens[Math.min(opened, opens.length - 1)]
        opened += 1
        return Promise.resolve({ ok: true, value } as never)
      }
      return new Promise(() => undefined)
    },
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  return { opened: () => opened }
}

beforeEach(() => {
  // useMachines keeps its state in a module: every test starts with a fresh one.
  vi.resetModules()
})

afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

it('says until when linking is paused instead of showing a code', async () => {
  const until = new Date(2026, 9, 21, 15, 5).getTime()
  preload(linkState({ pausedUntil: until }))
  const { LinkMachineDialog } = await import('../../src/renderer/machines/LinkMachineDialog')
  render(<LinkMachineDialog onClose={() => undefined} />)
  const paused = await screen.findByTestId('link-paused')
  const time = new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  expect(paused.textContent).toBe(`Linking is paused until ${time} after repeated failed attempts. Restart worfy to link sooner.`)
  expect(screen.queryByTestId('link-code')).toBeNull()
})

it('opens linking again by itself when the pause is over, and shows the code', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date(2026, 9, 21, 14, 0))
  const until = Date.now() + 5 * 60_000
  const paused = linkState({ pausedUntil: until })
  const main = preload(paused, [paused, linkState({ code: '482913', expiresAt: until + 120_000 })])
  const { LinkMachineDialog } = await import('../../src/renderer/machines/LinkMachineDialog')
  render(<LinkMachineDialog onClose={() => undefined} />)
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(screen.getByTestId('link-paused')).toBeTruthy()
  expect(main.opened()).toBe(1)
  await act(() => vi.advanceTimersByTimeAsync(until - Date.now() - 1))
  expect(main.opened()).toBe(1)
  expect(screen.queryByTestId('link-code')).toBeNull()
  await act(() => vi.advanceTimersByTimeAsync(1))
  expect(main.opened()).toBe(2)
  expect(screen.getByTestId('link-code').textContent).toBe('482913')
  expect(screen.queryByTestId('link-paused')).toBeNull()
})

it('shows the code, and no pause, while linking is not paused', async () => {
  preload(linkState({ code: '482913', expiresAt: Date.now() + 60_000 }))
  const { LinkMachineDialog } = await import('../../src/renderer/machines/LinkMachineDialog')
  render(<LinkMachineDialog onClose={() => undefined} />)
  expect((await screen.findByTestId('link-code')).textContent).toBe('482913')
  expect(screen.queryByTestId('link-paused')).toBeNull()
})

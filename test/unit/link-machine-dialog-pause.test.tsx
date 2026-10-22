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

/**
 * This Machine's preload: `link.state` answers `link`, each `link.open` the next of `opens` (the last
 * one again), an `{ error }` entry as a failed call; `push` sends a state as main's `link.changed`
 * broadcast does.
 */
function preload(link: LinkState, opens: (LinkState | { error: string })[] = [link]): { opened: () => number; push: (state: LinkState) => void } {
  let opened = 0
  const handlers: ((payload: unknown) => void)[] = []
  const bridge: WorfyBridge = {
    invoke: (channel) => {
      if (channel === 'link.state') return Promise.resolve({ ok: true, value: link } as never)
      if (channel === 'link.open') {
        const value = opens[Math.min(opened, opens.length - 1)]
        opened += 1
        if (value !== undefined && 'error' in value) return Promise.resolve({ ok: false, error: value.error } as never)
        return Promise.resolve({ ok: true, value } as never)
      }
      return new Promise(() => undefined)
    },
    on: (channel, handler) => {
      if (channel === 'link.changed') handlers.push(handler)
      return handlers.length
    },
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  return { opened: () => opened, push: (state) => handlers.forEach((handler) => handler(state)) }
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

it('opens linking again when main ends the pause before the late timer does (the Mac slept)', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date(2026, 9, 21, 14, 0))
  const until = Date.now() + 5 * 60_000
  const paused = linkState({ pausedUntil: until })
  const main = preload(paused, [paused, { ...linkState({ code: '482913', expiresAt: until + 120_000 }), revision: 3 }])
  const { LinkMachineDialog } = await import('../../src/renderer/machines/LinkMachineDialog')
  render(<LinkMachineDialog onClose={() => undefined} />)
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(main.opened()).toBe(1)
  // Timers stood still while the Mac slept; main's clock did not, so its next state has no pause and no code.
  await act(async () => main.push({ ...linkState({}), revision: 2 }))
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(main.opened()).toBe(2)
  expect(screen.getByTestId('link-code').textContent).toBe('482913')
  await act(() => vi.advanceTimersByTimeAsync(10 * 60_000))
  expect(main.opened()).toBe(2)
  // Once the code is back the pause is over: linking closed later (failed attempts in a row) stays closed.
  await act(async () => main.push({ ...linkState({ failure: 'too many failed pairing attempts' }), revision: 4 }))
  expect(main.opened()).toBe(2)
})

it('does not open linking again on a state without a code when there was no pause', async () => {
  const main = preload(linkState({}))
  const { LinkMachineDialog } = await import('../../src/renderer/machines/LinkMachineDialog')
  render(<LinkMachineDialog onClose={() => undefined} />)
  await act(async () => undefined)
  expect(main.opened()).toBe(1)
  await act(async () => main.push({ ...linkState({}), revision: 2 }))
  expect(main.opened()).toBe(1)
  expect(screen.getByText('Opening…')).toBeTruthy()
})

it('does not open linking when the window is closed during the pause', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date(2026, 9, 21, 14, 0))
  const until = Date.now() + 5 * 60_000
  const main = preload(linkState({ pausedUntil: until }))
  const { LinkMachineDialog } = await import('../../src/renderer/machines/LinkMachineDialog')
  const view = render(<LinkMachineDialog onClose={() => undefined} />)
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(main.opened()).toBe(1)
  view.unmount()
  await act(() => vi.advanceTimersByTimeAsync(10 * 60_000))
  expect(main.opened()).toBe(1)
})

it('asks main again, once a second, while it answers the end-of-pause call with the same pause', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date(2026, 9, 21, 14, 0))
  const until = Date.now() + 5 * 60_000
  const paused = linkState({ pausedUntil: until })
  const main = preload(paused, [
    paused,
    // main's clock is a moment behind the window's: the pause is not over there yet.
    { ...paused, revision: 2 },
    { ...linkState({ code: '482913', expiresAt: until + 120_000 }), revision: 3 },
  ])
  const { LinkMachineDialog } = await import('../../src/renderer/machines/LinkMachineDialog')
  render(<LinkMachineDialog onClose={() => undefined} />)
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(main.opened()).toBe(1)
  await act(() => vi.advanceTimersByTimeAsync(until - Date.now()))
  expect(main.opened()).toBe(2)
  expect(screen.getByTestId('link-paused')).toBeTruthy()
  // Not at once: a main that keeps answering with the same pause is not asked in a tight loop.
  await act(() => vi.advanceTimersByTimeAsync(999))
  expect(main.opened()).toBe(2)
  await act(() => vi.advanceTimersByTimeAsync(1))
  expect(main.opened()).toBe(3)
  expect(screen.getByTestId('link-code').textContent).toBe('482913')
  expect(screen.queryByTestId('link-paused')).toBeNull()
  await act(() => vi.advanceTimersByTimeAsync(10 * 60_000))
  expect(main.opened()).toBe(3)
})

it('does not ask main again when the end-of-pause call fails, and shows the error once', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date(2026, 9, 21, 14, 0))
  const until = Date.now() + 5 * 60_000
  const paused = linkState({ pausedUntil: until })
  const main = preload(paused, [paused, { error: 'link is not running' }])
  const { LinkMachineDialog } = await import('../../src/renderer/machines/LinkMachineDialog')
  render(<LinkMachineDialog onClose={() => undefined} />)
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(main.opened()).toBe(1)
  await act(() => vi.advanceTimersByTimeAsync(until - Date.now()))
  expect(main.opened()).toBe(2)
  expect(screen.getByTestId('link-problem').textContent).toBe('link is not running')
  // The pause stays in the window's state: each new ask would start main's discovery once more.
  await act(() => vi.advanceTimersByTimeAsync(10_000))
  expect(main.opened()).toBe(2)
  expect(screen.getByTestId('link-problem').textContent).toBe('link is not running')
})

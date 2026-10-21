// "Link a machine" while linking is paused after too many failed pairing attempts within an hour
// (worfy-link ticket 28, src/main/link/pairing.ts): the dialog shows no code and says until when the
// pause lasts. Over the real renderer IPC client and a fake preload of this Machine.
import { render, screen } from '@testing-library/react'
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

function preload(link: LinkState): void {
  const bridge: WorfyBridge = {
    invoke: (channel) => (channel === 'link.state' || channel === 'link.open' ? Promise.resolve({ ok: true, value: link } as never) : new Promise(() => undefined)),
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
}

beforeEach(() => {
  // useMachines keeps its state in a module: every test starts with a fresh one.
  vi.resetModules()
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

it('says until when linking is paused instead of showing a code', async () => {
  const until = new Date(2026, 9, 21, 15, 5).getTime()
  preload(linkState({ pausedUntil: until }))
  const { LinkMachineDialog } = await import('../../src/renderer/machines/LinkMachineDialog')
  render(<LinkMachineDialog onClose={() => undefined} />)
  const paused = await screen.findByTestId('link-paused')
  expect(paused.textContent).toContain('Linking is paused until')
  expect(paused.textContent).toContain(new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
  expect(screen.queryByTestId('link-code')).toBeNull()
})

it('shows the code, and no pause, while linking is not paused', async () => {
  preload(linkState({ code: '482913', expiresAt: Date.now() + 60_000 }))
  const { LinkMachineDialog } = await import('../../src/renderer/machines/LinkMachineDialog')
  render(<LinkMachineDialog onClose={() => undefined} />)
  expect((await screen.findByTestId('link-code')).textContent).toBe('482913')
  expect(screen.queryByTestId('link-paused')).toBeNull()
})

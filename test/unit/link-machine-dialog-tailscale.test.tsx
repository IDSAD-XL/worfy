// "Link a machine" and Tailscale (worfy-link ticket 29; ADR-0070, point 5): the window marks this
// Machine's Tailscale address, says under the field where the port comes from and, while "Link
// through Tailscale" is on, that a MagicDNS name or a Tailscale address goes there; a name typed
// with the port is what the window links to. Over the real renderer IPC client and a fake preload.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { LinkState } from '../../src/shared/ipc/link'

const linkState = (change: Partial<LinkState> = {}): LinkState => ({
  revision: 1,
  machine: { id: '11111111-1111-4111-8111-111111111111', name: 'Studio' },
  problem: null,
  listening: true,
  addresses: [],
  bonjour: false,
  linking: { open: true, code: '482913', expiresAt: Date.now() + 60_000, linked: null, failure: null },
  linked: [],
  discovered: [],
  projectsAccess: false,
  keepAwake: false,
  tailscale: false,
  ...change,
})

/** This Machine's preload: `link.state` and `link.open` answer `link`; `link.pair` waits for the test. */
function preload(link: LinkState): { pairs: unknown[]; answer: (value: unknown) => void; push: (state: LinkState) => void } {
  const pairs: unknown[] = []
  let answer: (value: unknown) => void = () => undefined
  const handlers: ((payload: unknown) => void)[] = []
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      if (channel === 'link.state' || channel === 'link.open') return Promise.resolve({ ok: true, value: link } as never)
      if (channel === 'link.pair') {
        pairs.push(input)
        return new Promise((resolve) => {
          answer = (value) => resolve({ ok: true, value } as never)
        })
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
  return { pairs, answer: (value) => answer(value), push: (state) => handlers.forEach((handler) => handler(state)) }
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

/** The own addresses as the window shows them: the text, and whether it carries the Tailscale mark. */
const shownAddresses = (): [string, boolean][] =>
  screen.getAllByTestId('link-own-address').map((element) => {
    const entry = element.closest('[data-testid="link-own-address-entry"]')
    return [element.textContent ?? '', entry?.querySelector('[data-testid="link-tailscale-mark"]') != null]
  })

it('marks the Tailscale addresses of this Machine, IPv4 and IPv6, in the order main lists them', async () => {
  preload(linkState({ tailscale: true, addresses: ['100.101.102.103:52000', '[fd7a:115c:a1e0::1]:52000', '192.168.1.20:52000'] }))
  const { LinkMachineDialog } = await import('../../src/renderer/machines/LinkMachineDialog')
  render(<LinkMachineDialog onClose={() => undefined} />)
  await screen.findByTestId('link-code')
  expect(shownAddresses()).toEqual([
    ['100.101.102.103:52000', true],
    ['[fd7a:115c:a1e0::1]:52000', true],
    ['192.168.1.20:52000', false],
  ])
  expect(screen.getAllByTestId('link-tailscale-mark').map((mark) => mark.textContent)).toEqual(['Tailscale', 'Tailscale'])
})

it('marks a Tailscale address while the setting is off too, and says it needs the setting', async () => {
  preload(linkState({ tailscale: false, addresses: ['192.168.1.20:52000', '100.101.102.103:52000'] }))
  const { LinkMachineDialog } = await import('../../src/renderer/machines/LinkMachineDialog')
  render(<LinkMachineDialog onClose={() => undefined} />)
  await screen.findByTestId('link-code')
  expect(shownAddresses()).toEqual([
    ['192.168.1.20:52000', false],
    ['100.101.102.103:52000', true],
  ])
  expect(screen.getByTestId('link-tailscale-mark').getAttribute('title')).toMatch(/Link through Tailscale/)
})

it('says under the field where the port comes from; with the setting on, that a MagicDNS name or a Tailscale address goes there', async () => {
  const main = preload(linkState())
  const { LinkMachineDialog } = await import('../../src/renderer/machines/LinkMachineDialog')
  render(<LinkMachineDialog onClose={() => undefined} />)
  const hint = await screen.findByTestId('link-address-hint')
  expect(hint.textContent).toBe('The address and its port are under the code in Link a machine on the other worfy.')
  expect(screen.getByTestId('link-address-input').getAttribute('aria-describedby')).toBe(hint.id)
  act(() => main.push(linkState({ revision: 2, tailscale: true })))
  expect(screen.getByTestId('link-address-hint').textContent).toBe(
    'The address and its port are under the code in Link a machine on the other worfy. Through Tailscale, type its MagicDNS name or Tailscale address with that port, like pc:52000.',
  )
})

it('links to the MagicDNS name typed with its port; the field is gone while linking, so the address cannot change under the dial', async () => {
  const main = preload(linkState({ tailscale: true }))
  const { LinkMachineDialog } = await import('../../src/renderer/machines/LinkMachineDialog')
  render(<LinkMachineDialog onClose={() => undefined} />)
  fireEvent.change(await screen.findByTestId('link-address-input'), { target: { value: ' pc:52000 ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByRole('heading', { name: 'Link with pc:52000' })).toBeTruthy()
  fireEvent.change(screen.getByTestId('link-code-input'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'Link' }))
  await act(() => Promise.resolve())
  expect(main.pairs).toEqual([{ address: 'pc:52000', code: '123456' }])
  expect(screen.queryByTestId('link-address-input')).toBeNull()
  expect(screen.getByRole('button', { name: 'Back' }).hasAttribute('disabled')).toBe(true)
  await act(async () => main.answer({ status: 'failed', reason: 'could not reach pc:52000 (ENOTFOUND)', state: linkState({ tailscale: true }) }))
  expect(screen.getByTestId('link-error').textContent).toBe('could not reach pc:52000 (ENOTFOUND)')
  expect(main.pairs).toHaveLength(1)
})

// "Link a machine" and the machines of the user's tailnet (worfy-link ticket 30; ADR-0070, point 5):
// while "Link through Tailscale" is on, the window asks main for them and lists them; an online one
// puts its address in the field, the port still typed by hand; an offline one is greyed with an
// Offline mark and cannot be picked. No CLI — an empty answer — means no list and no error. Over
// the real renderer IPC client and a fake preload.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { LinkState, TailscalePeerView } from '../../src/shared/ipc/link'

const linkState = (change: Partial<LinkState> = {}): LinkState => ({
  revision: 1,
  machine: { id: '11111111-1111-4111-8111-111111111111', name: 'Studio' },
  problem: null,
  listening: true,
  addresses: ['192.168.1.20:52000'],
  bonjour: false,
  linking: { open: true, code: '482913', expiresAt: Date.now() + 60_000, linked: null, failure: null },
  linked: [],
  discovered: [],
  projectsAccess: false,
  keepAwake: false,
  tailscale: true,
  ...change,
})

const PEERS: TailscalePeerView[] = [
  { name: 'pc', address: '100.101.102.104', online: true },
  { name: 'lab', address: 'fd7a:115c:a1e0::6501:6670', online: true },
  { name: 'nas', address: '100.101.102.105', online: false },
]

type PeersAnswer = { ok: true; value: TailscalePeerView[] } | { ok: false; error: string }

/** This Machine's preload: `link.state` and `link.open` answer `link`; `link.tailscalePeers` waits for the test. */
function preload(link: LinkState) {
  const asked: ((answer: PeersAnswer) => void)[] = []
  const handlers: ((payload: unknown) => void)[] = []
  const bridge: WorfyBridge = {
    invoke: (channel) => {
      if (channel === 'link.state' || channel === 'link.open') return Promise.resolve({ ok: true, value: link } as never)
      if (channel === 'link.tailscalePeers') return new Promise((resolve) => asked.push((answer) => resolve(answer as never)))
      return new Promise(() => undefined)
    },
    on: (channel, handler) => {
      if (channel === 'link.changed') handlers.push(handler)
      return handlers.length
    },
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  return {
    asked,
    answer: async (answer: PeersAnswer, index = asked.length - 1) => act(async () => asked[index]?.(answer)),
    push: (state: LinkState) => act(() => handlers.forEach((handler) => handler(state))),
  }
}

async function open(link: LinkState) {
  const main = preload(link)
  const { LinkMachineDialog } = await import('../../src/renderer/machines/LinkMachineDialog')
  render(<LinkMachineDialog onClose={() => undefined} />)
  await screen.findByTestId('link-code')
  return main
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const rows = () => screen.queryAllByTestId('link-tailscale-row')

it('without the Tailscale CLI (an empty answer) the window opens with no list and no error', async () => {
  const main = await open(linkState())
  expect(main.asked).toHaveLength(1)
  await main.answer({ ok: true, value: [] })
  expect(screen.queryByTestId('link-tailscale-list')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByTestId('link-address-input')).toBeTruthy()
})

it('a failed call is no list and no error either', async () => {
  const main = await open(linkState())
  await main.answer({ ok: false, error: 'the link service has not started yet' })
  expect(screen.queryByTestId('link-tailscale-list')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('lists the tailnet: online ones can be picked, an offline one is greyed with an Offline mark and cannot', async () => {
  const main = await open(linkState())
  await main.answer({ ok: true, value: PEERS })
  const list = screen.getByRole('list', { name: 'In your tailnet' })
  expect(within(list).getAllByTestId('link-tailscale-row').map((row) => [row.textContent, row.querySelector('button')?.disabled])).toEqual([
    ['pc100.101.102.104', false],
    ['labfd7a:115c:a1e0::6501:6670', false],
    ['nas100.101.102.105Offline', true],
  ])
  const offline = rows()[2]?.querySelector('button') as HTMLButtonElement
  expect(within(offline).getByTestId('link-tailscale-offline').textContent).toBe('Offline')
  expect(offline.style.color).toBe('var(--text-muted)')
  expect(rows()[0]?.querySelector('[data-testid="link-tailscale-offline"]')).toBeNull()
  fireEvent.click(offline)
  expect((screen.getByTestId('link-address-input') as HTMLInputElement).value).toBe('')
})

it('picking an online machine puts its address in the field, caret after the colon, for the port to be typed', async () => {
  const main = await open(linkState())
  await main.answer({ ok: true, value: PEERS })
  const field = screen.getByTestId('link-address-input') as HTMLInputElement
  const pc = screen.getByText('pc').closest('button') as HTMLButtonElement
  // A click moves focus to the row in a browser; jsdom's click does not.
  pc.focus()
  fireEvent.click(pc)
  expect(field.value).toBe('100.101.102.104:')
  expect(document.activeElement).toBe(field)
  expect([field.selectionStart, field.selectionEnd]).toEqual([field.value.length, field.value.length])
  // Still the address step: the port is not known, nothing is linked yet.
  expect(screen.queryByTestId('link-code-input')).toBeNull()
  fireEvent.click(screen.getByText('lab').closest('button') as HTMLButtonElement)
  expect(field.value).toBe('[fd7a:115c:a1e0::6501:6670]:')
  fireEvent.change(field, { target: { value: '[fd7a:115c:a1e0::6501:6670]:52000' } })
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByRole('heading', { name: 'Link with [fd7a:115c:a1e0::6501:6670]:52000' })).toBeTruthy()
})

it('picking clears an error shown under the field', async () => {
  const main = await open(linkState())
  await main.answer({ ok: true, value: PEERS })
  fireEvent.change(screen.getByTestId('link-address-input'), { target: { value: 'pc' } })
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByTestId('link-address-error')).toBeTruthy()
  fireEvent.click(screen.getByText('pc').closest('button') as HTMLButtonElement)
  expect(screen.queryByTestId('link-address-error')).toBeNull()
})

it('with "Link through Tailscale" off it does not ask; turned on, it asks and lists; turned off, the list goes', async () => {
  const main = await open(linkState({ tailscale: false }))
  expect(main.asked).toHaveLength(0)
  main.push(linkState({ revision: 2, tailscale: true }))
  expect(main.asked).toHaveLength(1)
  await main.answer({ ok: true, value: PEERS })
  expect(rows()).toHaveLength(3)
  main.push(linkState({ revision: 3, tailscale: false }))
  expect(screen.queryByTestId('link-tailscale-list')).toBeNull()
})

it('an answer that comes after the setting was turned off is dropped', async () => {
  const main = await open(linkState())
  main.push(linkState({ revision: 2, tailscale: false }))
  await main.answer({ ok: true, value: PEERS }, 0)
  expect(screen.queryByTestId('link-tailscale-list')).toBeNull()
})

it('asks again when the Linked machines change, and a machine linked meanwhile drops out without a gap', async () => {
  const main = await open(linkState())
  await main.answer({ ok: true, value: PEERS })
  const linked = { id: '22222222-2222-4222-8222-222222222222', name: 'pc', state: 'online' as const, certificateChanged: false, access: 'off' as const }
  main.push(linkState({ revision: 2, linked: [linked] }))
  expect(main.asked).toHaveLength(2)
  // Until main answers, the window keeps the list it has.
  expect(rows()).toHaveLength(3)
  await main.answer({ ok: true, value: PEERS.filter((peer) => peer.name !== 'pc') })
  expect(rows().map((row) => row.querySelector('span span')?.textContent)).toEqual(['lab', 'nas'])
  // A state that changes something else does not ask again.
  main.push(linkState({ revision: 3, linked: [linked], keepAwake: true }))
  expect(main.asked).toHaveLength(2)
})

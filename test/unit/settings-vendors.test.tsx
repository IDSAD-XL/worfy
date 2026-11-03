// Settings → Vendors (src/renderer/settings/VendorsSection.tsx, worfy-multi-vendor ticket 29) over the real
// renderer IPC client and a fake preload: who is signed in to each Vendor, the sign-in to Codex and its
// end, a Vendor that signs in in its own terminal, a Vendor not in the build, and a check that fails —
// each a line in its row, never a toast. What main does — the account parts, one sign-in at a time — is
// checked in test/contract/vendors-ipc.test.ts.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { VendorConnection, VendorEntry } from '../../src/shared/ipc/vendors'

const CLAUDE: VendorConnection = { provider: 'anthropic', signedIn: true, email: 'me@example.com', plan: 'Claude Max' }
const CODEX_OUT: VendorConnection = { provider: 'openai', signedIn: false, email: null, plan: null }
const CODEX_PLUS: VendorConnection = { provider: 'openai', signedIn: true, email: 'user@example.com', plan: 'plus' }

const BOTH: VendorEntry[] = [
  { vendor: 'claude', inBuild: true, required: true },
  { vendor: 'codex', inBuild: true, required: false },
]

type Answer = { ok: true; value: unknown } | { ok: false; error: string }

interface FakeMain {
  calls: { channel: string; input: unknown }[]
  /** The answer of each `vendors.account` by Vendor. */
  account: Record<string, Answer>
  /** Settles the pending `vendors.startLogin`. */
  finishLogin: (answer: Answer) => void
}

function preload(vendors: VendorEntry[], account: Record<string, Answer>): FakeMain {
  const main: FakeMain = { calls: [], account, finishLogin: () => undefined }
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      main.calls.push({ channel, input })
      const vendor = (input as { vendor?: string } | undefined)?.vendor ?? ''
      switch (channel) {
        case 'vendors.list':
          return Promise.resolve({ ok: true, value: { vendors } } as never)
        case 'vendors.account':
          return Promise.resolve((main.account[vendor] ?? { ok: false, error: `no ${vendor}` }) as never)
        case 'vendors.startLogin':
          return new Promise((resolve) => (main.finishLogin = (answer) => resolve(answer as never)))
        case 'vendors.cancelLogin':
          main.finishLogin({ ok: false, error: 'the Codex sign-in was cancelled' })
          return Promise.resolve({ ok: true, value: undefined } as never)
        default:
          return Promise.resolve({ ok: false, error: `no ${channel} here` } as never)
      }
    },
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  return main
}

const ok = (connections: VendorConnection[]): Answer => ({ ok: true, value: { connections } })

/** Renders the section and waits for its rows. */
async function renderSection() {
  const module = await import('../../src/renderer/settings/VendorsSection')
  render(<module.default />)
  await screen.findAllByTestId('vendor-row')
  return module
}

/** The text of the element `testId` of `vendor`'s row, once it is there. */
const lineOf = (vendor: string, testId: string): Promise<string> => waitFor(() => within(row(vendor)).getByTestId(testId).textContent ?? '')
/** The button `name` of `vendor`'s row, once it is there. */
const buttonOf = (vendor: string, name: string): Promise<HTMLElement> => waitFor(() => within(row(vendor)).getByRole('button', { name }))

const row = (vendor: string): HTMLElement => {
  const found = screen.getAllByTestId('vendor-row').find((each) => each.dataset.vendor === vendor)
  if (found === undefined) throw new Error(`no row of ${vendor}`)
  return found
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

describe('Settings → Vendors', () => {
  it('is the section «Vendors», after Terminal AI and before Sessions', async () => {
    const module = await import('../../src/renderer/settings/VendorsSection')
    expect(module.title).toBe('Vendors')
    expect(module.order).toBeGreaterThan(50)
    expect(module.order).toBeLessThan(60)
  })

  it('shows each signed-in account as the first-run check does, and Codex signed out with «Sign in to Codex»', async () => {
    preload(BOTH, { claude: ok([CLAUDE]), codex: ok([CODEX_OUT]) })
    await renderSection()
    expect(await lineOf('claude', 'vendor-account')).toBe('Signed in: me@example.com · Claude Max')
    expect(row('claude').dataset.state).toBe('signed-in')
    await buttonOf('codex', 'Sign in to Codex')
    expect(await lineOf('codex', 'vendor-signed-out')).toBe('Not signed in. Sign in to start Sessions on Codex too.')
    expect(row('codex').dataset.state).toBe('known')
  })

  it('«Sign in to Codex» waits for the sign-in in the browser, then shows the account it ended with', async () => {
    const main = preload(BOTH, { claude: ok([CLAUDE]), codex: ok([CODEX_OUT]) })
    await renderSection()
    fireEvent.click(await buttonOf('codex', 'Sign in to Codex'))
    expect(main.calls.filter((call) => call.channel === 'vendors.startLogin')).toEqual([{ channel: 'vendors.startLogin', input: { vendor: 'codex' } }])
    expect(await lineOf('codex', 'vendor-signing-in')).toBe('Finish the sign-in in your browser…')
    main.finishLogin({ ok: true, value: { connections: [CODEX_PLUS], command: null } })
    expect(await lineOf('codex', 'vendor-account')).toBe('Signed in: user@example.com · plus')
    expect(row('codex').dataset.state).toBe('signed-in')
  })

  it('a cancelled sign-in shows no failure and asks the sign-in again; a failed one says why in its row', async () => {
    const main = preload(BOTH, { claude: ok([CLAUDE]), codex: ok([CODEX_OUT]) })
    await renderSection()
    fireEvent.click(await buttonOf('codex', 'Sign in to Codex'))
    fireEvent.click(await buttonOf('codex', 'Cancel'))
    await buttonOf('codex', 'Sign in to Codex')
    expect(within(row('codex')).queryByTestId('vendor-sign-in-failed')).toBeNull()
    expect(main.calls.map((call) => call.channel)).toContain('vendors.cancelLogin')
    expect(main.calls.filter((call) => call.channel === 'vendors.account' && (call.input as { vendor: string }).vendor === 'codex')).toHaveLength(2)

    fireEvent.click(await buttonOf('codex', 'Sign in to Codex'))
    main.finishLogin({ ok: false, error: 'the Codex sign-in failed: denied' })
    expect(await lineOf('codex', 'vendor-sign-in-failed')).toBe('The sign-in did not finish: the Codex sign-in failed: denied')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a Vendor that signs in in its own terminal gets the command and «Check again»', async () => {
    const main = preload(BOTH, { claude: ok([{ ...CLAUDE, signedIn: false, email: null, plan: null }]), codex: ok([CODEX_OUT]) })
    await renderSection()
    expect(await lineOf('claude', 'vendor-signed-out')).toBe('Not signed in. worfy needs Claude Code for its Sessions.')
    fireEvent.click(await buttonOf('claude', 'Sign in to Claude Code'))
    main.finishLogin({ ok: true, value: { connections: null, command: 'claude' } })
    expect(await lineOf('claude', 'vendor-terminal-hint')).toBe('Run claude in a Terminal Node and sign in there, then check again.')
    main.account.claude = ok([CLAUDE])
    fireEvent.click(await buttonOf('claude', 'Check again'))
    expect(await lineOf('claude', 'vendor-account')).toBe('Signed in: me@example.com · Claude Max')
  })

  it('a Vendor not in the build says so and asks nothing; a check that fails is a line with «Check again», no alert', async () => {
    const main = preload([BOTH[0]!, { vendor: 'codex', inBuild: false, required: false }], { claude: { ok: false, error: 'Claude Code did not answer' } })
    await renderSection()
    expect(await lineOf('codex', 'vendor-absent')).toBe('Codex is not part of this build of worfy.')
    expect(row('codex').dataset.state).toBe('absent')
    expect(within(row('codex')).queryByRole('button')).toBeNull()
    expect(await lineOf('claude', 'vendor-unknown')).toBe('Could not check the sign-in: Claude Code did not answer')
    await buttonOf('claude', 'Check again')
    expect(main.calls.some((call) => call.channel === 'vendors.account' && (call.input as { vendor: string }).vendor === 'codex')).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

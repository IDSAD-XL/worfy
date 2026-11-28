// The owner's mark in the view of a PR (src/renderer/pr-inbox/VerificationChange.tsx, worfy-harness-guarantees ticket
// 10): the view reads what the mark would allow (`prInbox.verification`) and shows Allow verification change for a PR
// that needs it; only a click sends `prInbox.allowVerification`, with the head the view showed. Main is a fake bridge.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { OwnerMarkLook, OwnerMarkResult } from '../../src/shared/ipc/pr-inbox'
import { VerificationChange } from '../../src/renderer/pr-inbox/VerificationChange'

const HEAD = 'c'.repeat(40)
const NEEDED: OwnerMarkLook = { needed: true, head: HEAD, lines: ['adds .github/workflows/ci.yml to the trail of worfy-x 07'], allowed: false, error: null }

function fakeMain(look: OwnerMarkLook, allow: (input: unknown) => IpcResult<OwnerMarkResult> = () => ({ ok: true, value: { outcome: 'allowed', reason: null, look: { ...look, allowed: true } } })) {
  const calls: { channel: string; input: unknown }[] = []
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      calls.push({ channel, input })
      if (channel === 'prInbox.verification') return Promise.resolve({ ok: true, value: look } as never)
      if (channel === 'prInbox.allowVerification') return Promise.resolve(allow(input) as never)
      return Promise.resolve({ ok: false, error: `not in this test: ${channel}` } as never)
    },
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  return calls
}

afterEach(() => {
  cleanup()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const strip = (readOnly: string | null = null) => render(<VerificationChange projectId="web-00000001" repo="example-org/web" number={1852} head={HEAD} readOnly={readOnly} />)

describe('Allow verification change in the view of a PR', () => {
  it('a PR that adds a verification path to a trail: the line and the button; opening the view only reads', async () => {
    const calls = fakeMain(NEEDED)
    strip()
    await waitFor(() => expect(screen.getByTestId('pr-inbox-verification-line').textContent).toBe('Verification paths: adds .github/workflows/ci.yml to the trail of worfy-x 07'))
    expect(screen.getByTestId('pr-inbox-allow-verification').textContent).toBe('Allow verification change')
    expect(calls.map((call) => call.channel)).toEqual(['prInbox.verification'])
  })

  it('the click sends allowVerification once, with the head the view showed; then the mark is shown and the button goes', async () => {
    const calls = fakeMain(NEEDED)
    strip()
    const button = await screen.findByTestId('pr-inbox-allow-verification')
    await act(async () => {
      fireEvent.click(button)
      await Promise.resolve()
    })
    await waitFor(() => expect(screen.getByTestId('pr-inbox-verification-allowed').textContent).toBe('Allowed: the commit status owner is on cccccccc, and land may merge it'))
    expect(screen.queryByTestId('pr-inbox-allow-verification')).toBeNull()
    expect(calls.filter((call) => call.channel === 'prInbox.allowVerification').map((call) => call.input)).toEqual([{ projectId: 'web-00000001', repo: 'example-org/web', number: 1852, head: HEAD }])
  })

  it('a refusal of main (the head moved) is said beside the button, which stays', async () => {
    fakeMain(NEEDED, () => ({ ok: true, value: { outcome: 'refused', reason: 'The PR moved to dddddddd since the view showed cccccccc: look at the new head first', look: NEEDED } }))
    strip()
    fireEvent.click(await screen.findByTestId('pr-inbox-allow-verification'))
    await waitFor(() => expect(screen.getByTestId('pr-inbox-verification-note').textContent).toContain('The PR moved to dddddddd'))
    expect(screen.getByTestId('pr-inbox-allow-verification')).toBeTruthy()
  })

  it('a PR that needs no mark shows nothing; an allowed one shows the mark without the button', async () => {
    const calls = fakeMain({ needed: false, head: HEAD, lines: [], allowed: false, error: null })
    const { container } = strip()
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(container.textContent).toBe('')
    cleanup()
    fakeMain({ ...NEEDED, allowed: true })
    strip()
    await screen.findByTestId('pr-inbox-verification-allowed')
    expect(screen.queryByTestId('pr-inbox-allow-verification')).toBeNull()
  })

  it('a look that failed says why, and offers nothing; a Linked machine reads nothing', async () => {
    fakeMain({ needed: false, head: null, lines: [], allowed: false, error: 'land --verification exit 2: no profile' })
    strip()
    expect((await screen.findByTestId('pr-inbox-verification-error')).textContent).toBe('Verification paths could not be read: land --verification exit 2: no profile')
    expect(screen.queryByTestId('pr-inbox-allow-verification')).toBeNull()
    cleanup()
    const calls = fakeMain(NEEDED)
    const { container } = strip('Read only on this Machine')
    await act(async () => Promise.resolve())
    expect(calls).toEqual([])
    expect(container.textContent).toBe('')
  })
})

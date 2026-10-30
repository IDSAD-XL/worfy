// The cost switch of the demo (worfy-onboarding ticket 09; src/renderer/getting-started/CostSwitch.tsx)
// over the real renderer IPC client and a fake preload: a pick goes to main as `gettingStarted.setCost`,
// and main's refusal — the live Session kept its settings — shows in the switch's own error line.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handlerFailure, type IpcResult, type WorfyBridge } from '../../src/shared/ipc/channels'
import type { GettingStartedSnapshot } from '../../src/shared/ipc/getting-started'

const REASON = 'Saved for the next start of the Orchestrator; its running Session kept its settings: setModel failed'

const STATE: GettingStartedSnapshot = {
  user: 'new',
  section: 'shown',
  steps: {},
  reworkSeen: false,
  noticeShown: false,
  demo: { projectId: 'demo', path: '/Users/u/worfy-demo', profile: 'worfy-demo', cost: 'more-expensive' },
}

let asked: unknown[] = []

/** This Machine's preload: `gettingStarted.setCost` answers `answer`. */
function preload(answer: IpcResult<unknown>): void {
  asked = []
  ;(globalThis as { worfy?: WorfyBridge }).worfy = {
    invoke: (channel, input) => {
      if (channel === 'gettingStarted.setCost') asked.push(input)
      return Promise.resolve(answer as never)
    },
    on: () => 1,
    off: () => undefined,
  }
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

describe('CostSwitch', () => {
  it('sends the pick to main and shows the reason when the running Session refused it', async () => {
    preload({ ok: false, error: handlerFailure('gettingStarted.setCost', REASON) })
    const { default: CostSwitch } = await import('../../src/renderer/getting-started/CostSwitch')
    render(<CostSwitch cost="cheaper" />)
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Opus — a bit more expensive' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(REASON))
    expect(asked).toEqual([{ cost: 'more-expensive' }])
    // The switch is free again for the next pick.
    expect((screen.getByRole('radio', { name: 'Sonnet — a bit cheaper' }) as HTMLInputElement).disabled).toBe(false)
  })

  it('shows no error line when main takes the pick', async () => {
    preload({ ok: true, value: STATE })
    const { default: CostSwitch } = await import('../../src/renderer/getting-started/CostSwitch')
    render(<CostSwitch cost="cheaper" />)
    fireEvent.click(screen.getByRole('radio', { name: 'Opus — a bit more expensive' }))
    await waitFor(() => expect(asked).toEqual([{ cost: 'more-expensive' }]))
    await waitFor(() => expect((screen.getByRole('radio', { name: 'Opus — a bit more expensive' }) as HTMLInputElement).disabled).toBe(false))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

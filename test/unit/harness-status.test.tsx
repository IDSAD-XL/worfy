import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HarnessState, HarnessStatus } from '../../src/shared/ipc/harness'
import { HarnessStatusView } from '../../src/renderer/shell/toolbar/HarnessStatus'

// worfy-harness ticket 13: the Harness item of the toolbar. A dev run on the real ~/.claude
// (canInstall false) shows the state and offers no install; a run that may install shows the button.

const status = (state: HarnessState, canInstall: boolean): HarnessStatus => ({
  state,
  bundledVersion: '0.2.0+bbbbbbb',
  canInstall,
  pluginDir: '/Users/me/.claude/worfy-harness/plugin',
})

const STATES: HarnessState[] = [
  { kind: 'not-installed' },
  { kind: 'outdated', from: '0.2.0+aaaaaaa', to: '0.2.0+bbbbbbb' },
  { kind: 'error', step: 'marketplace add', reason: 'claude plugin marketplace add … exited with 1' },
]

afterEach(cleanup)

describe('HarnessStatusView', () => {
  it.each(STATES)('in a dev build without WORFY_CLAUDE_HOME shows the state "$kind" and no install button', (state) => {
    render(<HarnessStatusView status={status(state, false)} busy={false} failure={undefined} onInstall={() => undefined} />)
    expect(screen.getByTestId('harness-status').getAttribute('data-state')).toBe(state.kind)
    expect(screen.getByTestId('harness-text').textContent).toBe(
      { 'not-installed': 'Harness not installed', outdated: 'Harness 0.2.0+aaaaaaa → 0.2.0+bbbbbbb', error: 'Harness error: marketplace add' }[state.kind as 'not-installed'],
    )
    expect(screen.queryByTestId('harness-action')).toBeNull()
  })

  it('with the install offered: Install, Update Harness and Retry call the action', () => {
    const labels = { 'not-installed': 'Install', outdated: 'Update Harness', error: 'Retry' } as Record<string, string>
    for (const state of STATES) {
      const onInstall = vi.fn()
      render(<HarnessStatusView status={status(state, true)} busy={false} failure={undefined} onInstall={onInstall} />)
      const button = screen.getByTestId('harness-action')
      expect(button.textContent).toBe(labels[state.kind])
      fireEvent.click(button)
      expect(onInstall).toHaveBeenCalledTimes(1)
      cleanup()
    }
  })

  it('an installed Harness shows its version and no button, also when the install is offered', () => {
    render(<HarnessStatusView status={status({ kind: 'installed', version: '0.2.0+bbbbbbb', enabled: true }, true)} busy={false} failure={undefined} onInstall={() => undefined} />)
    expect(screen.getByTestId('harness-text').textContent).toBe('Harness 0.2.0+bbbbbbb')
    expect(screen.queryByTestId('harness-action')).toBeNull()
  })

  it('an error carries its reason in the tooltip', () => {
    render(<HarnessStatusView status={status(STATES[2]!, true)} busy={false} failure={undefined} onInstall={() => undefined} />)
    expect(screen.getByTestId('harness-text').getAttribute('title')).toBe('claude plugin marketplace add … exited with 1')
  })
})

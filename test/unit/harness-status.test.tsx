import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HarnessState, HarnessStatus } from '../../src/shared/ipc/harness'
import { HarnessStatusView } from '../../src/renderer/shell/toolbar/HarnessStatus'

// worfy-harness ticket 13: the Harness item of the toolbar. A dev run on the real ~/.claude
// (canInstall false) shows the state and offers no install; a run that may install shows the button.
// Ticket 30: Retry installs a missing dependency itself, so its hint names no command to run by hand.

const status = (state: HarnessState, canInstall: boolean): HarnessStatus => ({
  state,
  bundledVersion: '0.2.0+bbbbbbb',
  canInstall,
  pluginDir: '/Users/me/.claude/worfy-harness/plugin',
  dependencies: [{ id: 'mattpocock-skills@claude-plugins-official', status: state.kind === 'installed' ? 'installed' : 'unchecked', version: null }],
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

  it('with the install offered: Install, Update Harness and Retry are icon buttons with their names, and call the action', () => {
    const labels = { 'not-installed': 'Install', outdated: 'Update Harness', error: 'Retry' } as Record<string, string>
    for (const state of STATES) {
      const onInstall = vi.fn()
      render(<HarnessStatusView status={status(state, true)} busy={false} failure={undefined} onInstall={onInstall} />)
      const button = screen.getByRole('button', { name: labels[state.kind] })
      expect(button.getAttribute('data-testid')).toBe('harness-action')
      // An icon, not a word: the name is the aria-label, the tooltip is the title.
      expect(button.textContent).toBe('')
      expect(button.querySelector('svg')).not.toBeNull()
      expect(button.className).toContain('w-toolbar__icon-button')
      expect(button.getAttribute('title')).not.toBe('')
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

  it('an error of `dependency install` names the step, and the hint of Retry tells of no command to run by hand', () => {
    const state: HarnessState = { kind: 'error', step: 'dependency install', reason: 'the Harness needs mattpocock-skills@claude-plugins-official, and Claude Code does not list it as installed' }
    const onInstall = vi.fn()
    render(<HarnessStatusView status={{ ...status(state, true), dependencies: [{ id: 'mattpocock-skills@claude-plugins-official', status: 'missing', version: null }] }} busy={false} failure={undefined} onInstall={onInstall} />)
    expect(screen.getByTestId('harness-text').textContent).toBe('Harness error: dependency install')
    expect(screen.getByTestId('harness-text').getAttribute('title')).toBe(state.reason)
    const retry = screen.getByTestId('harness-action')
    expect(retry.getAttribute('aria-label')).toBe('Retry')
    const hint = retry.getAttribute('title') ?? ''
    expect(hint).not.toContain('claude plugin install')
    expect(hint).not.toMatch(/install it with|by hand|yourself|first/i)
    // Retry installs what is missing: the hint says so.
    expect(hint).toMatch(/Retry .*missing dependency/)
    fireEvent.click(retry)
    expect(onInstall).toHaveBeenCalledTimes(1)
  })

  it('an outdated Harness with the update offered: its version on the line, "Update Harness: OLD → NEW" as the icon\'s tooltip', () => {
    render(<HarnessStatusView status={status(STATES[1]!, true)} busy={false} failure={undefined} onInstall={() => undefined} />)
    expect(screen.getByTestId('harness-text').textContent).toBe('Harness 0.2.0+aaaaaaa')
    const update = screen.getByRole('button', { name: 'Update Harness' })
    expect(update.getAttribute('title')).toBe('Update Harness: 0.2.0+aaaaaaa → 0.2.0+bbbbbbb')
  })

  it('"Move old Harness…" is an icon button with that name and tooltip', () => {
    const onMigrate = vi.fn()
    render(<HarnessStatusView status={status({ kind: 'installed', version: '0.2.0+bbbbbbb', enabled: true }, true)} busy={false} failure={undefined} onInstall={() => undefined} onMigrate={onMigrate} />)
    const move = screen.getByRole('button', { name: 'Move old Harness…' })
    expect(move.getAttribute('data-testid')).toBe('harness-migrate')
    expect(move.getAttribute('title')).toBe('Move old Harness…')
    expect(move.textContent).toBe('')
    fireEvent.click(move)
    expect(onMigrate).toHaveBeenCalledTimes(1)
  })

  it('the app version is the second line, under the Harness line, in one column', () => {
    render(<HarnessStatusView status={status({ kind: 'installed', version: '0.3.0+e61cb1fe', enabled: true }, false)} busy={false} failure={undefined} onInstall={() => undefined} version="0.3.0+e61cb1fe" />)
    const column = screen.getByTestId('harness-column')
    expect(column.style.flexDirection).toBe('column')
    expect([...column.children].map((child) => child.getAttribute('data-testid'))).toEqual(['harness-status', 'app-version'])
    expect(screen.getByTestId('app-version').textContent).toBe('v0.3.0+e61cb1fe')
    // The Harness line itself carries no version of the app.
    expect(screen.getByTestId('harness-status').textContent).toBe('Harness 0.3.0+e61cb1fe')
  })

  it('the app version shows also before the Harness state arrives, and not before its own answer', () => {
    const { rerender } = render(<HarnessStatusView status={undefined} busy={false} failure={undefined} onInstall={() => undefined} />)
    expect(screen.queryByTestId('app-version')).toBeNull()
    rerender(<HarnessStatusView status={undefined} busy={false} failure={undefined} onInstall={() => undefined} version="0.3.0" />)
    expect(screen.getByTestId('app-version').textContent).toBe('v0.3.0')
    expect(screen.queryByTestId('harness-status')).toBeNull()
  })
})

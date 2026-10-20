import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { HarnessState, HarnessStatus as Status } from '../../src/shared/ipc/harness'
import { HarnessStatus, HarnessStatusView } from '../../src/renderer/shell/toolbar/HarnessStatus'

// worfy-harness ticket 13: the Harness item of the toolbar. A dev run on the real ~/.claude
// (canInstall false) shows the state and offers no install; a run that may install shows the button.
// Ticket 30: Retry installs a missing dependency itself, so its hint names no command to run by hand.
// Ticket 40: the item follows `harness.changed` and `harnessMigration.changed` from main, so an install
// or a move started elsewhere (the first-run screen, another window) shows without a reload.

const status = (state: HarnessState, canInstall: boolean): Status => ({
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

  it('the Install icon names the version and the folder it installs into in its tooltip', () => {
    render(<HarnessStatusView status={status(STATES[0]!, true)} busy={false} failure={undefined} onInstall={() => undefined} />)
    expect(screen.getByRole('button', { name: 'Install' }).getAttribute('title')).toBe('Install the Harness 0.2.0+bbbbbbb into /Users/me/.claude/worfy-harness/plugin')
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
    // The second line holds the version, then worfy's memory when it is on (worfy-ui ticket 20).
    expect([...column.children].map((child) => child.getAttribute('data-testid'))).toEqual(['harness-status', 'app-line'])
    expect(screen.getByTestId('app-version').parentElement).toBe(screen.getByTestId('app-line'))
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

const globals = globalThis as { worfy?: WorfyBridge }

/** A preload bridge with no main behind it: scripted answers per channel, and events the test sends. */
function fakeBridge(answers: Record<string, () => Promise<unknown>>) {
  const handlers = new Map<number, { channel: string; handler: (payload: unknown) => void }>()
  let next = 1
  const calls: string[] = []
  globals.worfy = {
    invoke: (channel: string) => {
      calls.push(channel)
      const answer = answers[channel]
      return answer ? answer() : Promise.resolve({ ok: false, error: `${channel}: not in this test` })
    },
    on: (channel: string, handler: (payload: unknown) => void) => {
      handlers.set(next, { channel, handler })
      return next++
    },
    off: (id: number) => handlers.delete(id),
  } as unknown as WorfyBridge
  return {
    calls,
    listeners: (channel: string) => [...handlers.values()].filter((each) => each.channel === channel).length,
    emit: (channel: string, payload: unknown) => {
      for (const each of [...handlers.values()]) if (each.channel === channel) each.handler(payload)
    },
  }
}

const ok = (value: unknown) => () => Promise.resolve({ ok: true, value })
const notInstalled = status({ kind: 'not-installed' }, true)
const installed = status({ kind: 'installed', version: '0.2.0+bbbbbbb', enabled: true }, true)

describe('HarnessStatus (the item over IPC)', () => {
  afterEach(() => {
    cleanup()
    delete globals.worfy
  })

  it('shows the state `harness.state` answered when it appears', async () => {
    fakeBridge({ 'harness.state': ok(notInstalled), 'harnessMigration.offer': ok({ offered: false }) })
    render(<HarnessStatus />)
    expect((await screen.findByTestId('harness-text')).textContent).toBe('Harness not installed')
    expect(screen.getByTestId('harness-action').getAttribute('aria-label')).toBe('Install')
  })

  it('`harness.changed` (an install from the first-run screen or another window) replaces the state without a reload', async () => {
    const main = fakeBridge({ 'harness.state': ok(notInstalled), 'harnessMigration.offer': ok({ offered: false }) })
    render(<HarnessStatus />)
    await screen.findByTestId('harness-action')
    act(() => main.emit('harness.changed', installed))
    expect(screen.getByTestId('harness-text').textContent).toBe('Harness 0.2.0+bbbbbbb')
    expect(screen.queryByTestId('harness-action')).toBeNull()
    // Asked once: the event carries the state, nothing is read again.
    expect(main.calls.filter((channel) => channel === 'harness.state')).toHaveLength(1)
  })

  it('`harness.changed` with an error after a failed step shows the error and Retry', async () => {
    const main = fakeBridge({ 'harness.state': ok(notInstalled), 'harnessMigration.offer': ok({ offered: false }) })
    render(<HarnessStatus />)
    await screen.findByTestId('harness-action')
    act(() => main.emit('harness.changed', status({ kind: 'error', step: 'install', reason: 'exited with 1' }, true)))
    expect(screen.getByTestId('harness-text').textContent).toBe('Harness error: install')
    expect(screen.getByTestId('harness-action').getAttribute('aria-label')).toBe('Retry')
  })

  it('`harness.changed` replaces a failed first read ("Harness unavailable")', async () => {
    const main = fakeBridge({ 'harness.state': () => Promise.resolve({ ok: false, error: 'claude is missing' }), 'harnessMigration.offer': ok({ offered: false }) })
    render(<HarnessStatus />)
    expect((await screen.findByTestId('harness-status')).textContent).toBe('Harness unavailable')
    act(() => main.emit('harness.changed', installed))
    expect(screen.getByTestId('harness-text').textContent).toBe('Harness 0.2.0+bbbbbbb')
  })

  it('an event during its own install keeps "Installing Harness…" and never brings the old text back', async () => {
    let answer: (value: unknown) => void = () => undefined
    const main = fakeBridge({
      'harness.state': ok(notInstalled),
      'harnessMigration.offer': ok({ offered: false }),
      'harness.install': () => new Promise((resolve) => (answer = resolve)),
    })
    render(<HarnessStatus />)
    fireEvent.click(await screen.findByTestId('harness-action'))
    expect(screen.getByTestId('harness-status').textContent).toBe('Installing Harness…')
    // Main announces the run before the call's own answer arrives.
    act(() => main.emit('harness.changed', installed))
    expect(screen.getByTestId('harness-status').textContent).toBe('Installing Harness…')
    await act(async () => answer({ ok: true, value: { outcome: 'done', status: installed } }))
    expect(screen.getByTestId('harness-text').textContent).toBe('Harness 0.2.0+bbbbbbb')
    expect(screen.queryByTestId('harness-action')).toBeNull()
  })

  it('an event that arrives before the first `harness.state` answer wins over that older answer', async () => {
    let answer: (value: unknown) => void = () => undefined
    const main = fakeBridge({ 'harness.state': () => new Promise((resolve) => (answer = resolve)), 'harnessMigration.offer': ok({ offered: false }) })
    render(<HarnessStatus />)
    act(() => main.emit('harness.changed', installed))
    expect(screen.getByTestId('harness-text').textContent).toBe('Harness 0.2.0+bbbbbbb')
    await act(async () => answer({ ok: true, value: notInstalled }))
    expect(screen.getByTestId('harness-text').textContent).toBe('Harness 0.2.0+bbbbbbb')
  })

  it('a `harnessMigration.changed` that arrives before the first `harnessMigration.offer` answer wins over that older answer', async () => {
    let answer: (value: unknown) => void = () => undefined
    const main = fakeBridge({ 'harness.state': ok(installed), 'harnessMigration.offer': () => new Promise((resolve) => (answer = resolve)) })
    render(<HarnessStatus />)
    await screen.findByTestId('harness-text')
    act(() => main.emit('harnessMigration.changed', { offered: false }))
    await act(async () => answer({ ok: true, value: { offered: true } }))
    expect(screen.queryByTestId('harness-migrate')).toBeNull()
  })

  it('`harnessMigration.changed` (a move from the first-run screen) hides "Move old Harness…" without a reload', async () => {
    const main = fakeBridge({ 'harness.state': ok(installed), 'harnessMigration.offer': ok({ offered: true }) })
    render(<HarnessStatus />)
    await screen.findByTestId('harness-migrate')
    act(() => main.emit('harnessMigration.changed', { offered: false }))
    expect(screen.queryByTestId('harness-migrate')).toBeNull()
  })

  it('stops listening when it leaves the window', async () => {
    const main = fakeBridge({ 'harness.state': ok(installed), 'harnessMigration.offer': ok({ offered: false }) })
    const { unmount } = render(<HarnessStatus />)
    await screen.findByTestId('harness-text')
    expect(main.listeners('harness.changed')).toBe(1)
    expect(main.listeners('harnessMigration.changed')).toBe(1)
    unmount()
    expect(main.listeners('harness.changed')).toBe(0)
    expect(main.listeners('harnessMigration.changed')).toBe(0)
  })

  it('a bridge without events (no `on`) still shows the state `harness.state` answered, and unmounts cleanly', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      fakeBridge({ 'harness.state': ok(notInstalled), 'harnessMigration.offer': ok({ offered: true }) })
      const bridge = globals.worfy as unknown as Record<string, unknown>
      delete bridge.on
      delete bridge.off
      const { unmount } = render(<HarnessStatus />)
      expect((await screen.findByTestId('harness-text')).textContent).toBe('Harness not installed')
      expect(await screen.findByTestId('harness-migrate')).not.toBeNull()
      expect(() => unmount()).not.toThrow()
      expect(errors.mock.calls.map((call) => String(call[0]))).toEqual(expect.arrayContaining(['harness.changed: cannot subscribe', 'harnessMigration.changed: cannot subscribe']))
    } finally {
      errors.mockRestore()
    }
  })

  it('with no bridge at all (the preload did not run) the item renders "Harness unavailable" instead of taking the toolbar down', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      render(<HarnessStatus />)
      expect((await screen.findByTestId('harness-status')).textContent).toBe('Harness unavailable')
    } finally {
      errors.mockRestore()
    }
  })
})

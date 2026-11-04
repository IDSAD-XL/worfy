import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { HarnessHooksTrust, HarnessStatus as Status } from '../../src/shared/ipc/harness'
import CodexHooksStep from '../../src/renderer/harness/CodexHooksStep'
import { HarnessStatus } from '../../src/renderer/shell/toolbar/HarnessStatus'

// worfy-multi-vendor ticket 39: the step "Approve the Harness hooks in Codex". It says what to open in
// Codex (/hooks), and "Check again" asks main (`harness.codexHooks`). The toolbar's Harness item opens it
// when an install or update in Codex leaves hooks to approve, and on a click of "Codex: approve hooks".

const globals = globalThis as { worfy?: WorfyBridge }

/** A preload bridge with scripted answers per channel and events the test sends. */
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
    emit: (channel: string, payload: unknown) => {
      for (const each of [...handlers.values()]) if (each.channel === channel) each.handler(payload)
    },
  }
}

const ok = (value: unknown) => () => Promise.resolve({ ok: true, value })

const withCodex = (hooksToApprove: boolean): Status => ({
  state: { kind: 'installed', version: '0.2.0+bbbbbbb', enabled: true },
  bundledVersion: '0.2.0+bbbbbbb',
  canInstall: true,
  pluginDir: '/Users/me/.claude/worfy-harness/plugin',
  dependencies: [],
  codex: { state: { kind: 'installed', version: '0.2.0+bbbbbbb' }, agentsDir: '/Users/me/.codex/agents', hooksToApprove, skippedAgents: [] },
})

afterEach(() => {
  cleanup()
  delete globals.worfy
})

describe('CodexHooksStep', () => {
  it('names the step, what to open in Codex and the button that checks again', () => {
    fakeBridge({})
    render(<CodexHooksStep onClose={() => undefined} onStatus={() => undefined} />)
    const step = screen.getByRole('dialog', { name: 'Approve the Harness hooks in Codex' })
    expect(step.textContent).toContain('a Codex Autopilot Run does not start')
    expect(screen.getByTestId('codex-hooks-step-steps').textContent).toContain('/hooks')
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy()
    expect(screen.getByTestId('codex-hooks-step-result').textContent).toBe('')
  })

  it.each<[HarnessHooksTrust, string]>([
    ['not-approved', 'The Harness hooks are still off in Codex. Approve them in /hooks, then check again.'],
    ['unknown', 'worfy could not read the hooks from Codex. Check that the Harness is installed in Codex, then check again.'],
  ])('Check again answered %s: says so, keeps the button, and hands on the status main answered', async (trust, text) => {
    const status = withCodex(true)
    const main = fakeBridge({ 'harness.codexHooks': ok({ trust, status }) })
    const onStatus = vi.fn()
    render(<CodexHooksStep onClose={() => undefined} onStatus={onStatus} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(screen.getByTestId('codex-hooks-step-result').textContent).toBe('Asking Codex…')
    await vi.waitFor(() => expect(screen.getByTestId('codex-hooks-step-result').getAttribute('data-trust')).toBe(trust))
    expect(screen.getByTestId('codex-hooks-step-result').textContent).toBe(text)
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy()
    expect(onStatus).toHaveBeenCalledWith(status)
    expect(main.calls).toEqual(['harness.codexHooks'])
  })

  it('Check again answered approved: says the Run can start, and Done closes the step', async () => {
    fakeBridge({ 'harness.codexHooks': ok({ trust: 'approved', status: withCodex(false) }) })
    const onClose = vi.fn()
    render(<CodexHooksStep onClose={onClose} onStatus={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await vi.waitFor(() => expect(screen.getByTestId('codex-hooks-step-result').getAttribute('data-trust')).toBe('approved'))
    expect(screen.getByTestId('codex-hooks-step-result').textContent).toContain('a Codex Autopilot Run can start')
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a check that fails says so; Escape closes the step', async () => {
    fakeBridge({ 'harness.codexHooks': () => Promise.resolve({ ok: false, error: 'main is gone' }) })
    const onClose = vi.fn()
    render(<CodexHooksStep onClose={onClose} onStatus={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await vi.waitFor(() => expect(screen.getByTestId('codex-hooks-step-result').textContent).toBe('The check failed: main is gone'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('the step from the toolbar Harness item', () => {
  it('opens by itself when an install in Codex leaves hooks to approve, and once approved the item no longer asks', async () => {
    const main = fakeBridge({
      'harness.state': ok(withCodex(false)),
      'harnessMigration.offer': ok({ offered: false }),
      'harness.codexHooks': ok({ trust: 'approved', status: withCodex(false) }),
    })
    render(<HarnessStatus />)
    await screen.findByTestId('harness-text')
    expect(screen.queryByTestId('codex-hooks-step')).toBeNull()
    // An install from this window, another one or the first-run screen: `harness.changed`.
    act(() => main.emit('harness.changed', withCodex(true)))
    expect(screen.getByTestId('codex-hooks-step')).toBeTruthy()
    expect(screen.getByTestId('harness-codex').textContent).toBe('· Codex: approve hooks')
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await vi.waitFor(() => expect(screen.queryByTestId('harness-codex')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByTestId('codex-hooks-step')).toBeNull()
  })

  it('a window that opens while hooks wait shows the step too; closed, a status that still asks does not reopen it, and "Codex: approve hooks" does', async () => {
    const main = fakeBridge({ 'harness.state': ok(withCodex(true)), 'harnessMigration.offer': ok({ offered: false }) })
    render(<HarnessStatus />)
    await screen.findByTestId('codex-hooks-step')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('codex-hooks-step')).toBeNull()
    act(() => main.emit('harness.changed', withCodex(true)))
    expect(screen.queryByTestId('codex-hooks-step')).toBeNull()
    fireEvent.click(screen.getByTestId('harness-codex'))
    expect(screen.getByTestId('codex-hooks-step')).toBeTruthy()
  })
})

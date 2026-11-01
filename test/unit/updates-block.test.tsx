// Settings → General → Updates (src/renderer/settings/UpdatesBlock.tsx, worfy-update ticket 09): the
// line of the Update state with "Check now" and "Update worfy" (or "Restart now" / "Restart when
// idle" once built), the switch "Update automatically" and "Roll back to previous version". The texts
// are the spec's (.scratch/worfy-update/spec.md, "Settings → General → Updates"). main is a fake
// preload bridge: each channel answers what the test gave it, and every call is recorded; the Update
// snapshot is put into the renderer's store (src/renderer/update/store.ts) as main would send it.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { updateSnapshotSchema, type UpdateSnapshot } from '../../src/shared/ipc/update'
import { defaultAppSettings, type AppSettings } from '../../src/shared/settings/app-settings'
import GeneralSection from '../../src/renderer/settings/GeneralSection'
import { UpdatesBlock } from '../../src/renderer/settings/UpdatesBlock'
import { useUpdateStore } from '../../src/renderer/update/store'

type Answer = { ok: true; value: unknown } | { ok: false; error: string }
type Handler = (input: unknown) => Answer | Promise<Answer>

const handlers: Record<string, Handler> = {}
const invoke = vi.fn((channel: string, input?: unknown): Promise<Answer> => Promise.resolve((handlers[channel] ?? (() => ({ ok: false, error: `${channel}: not in this test` })))(input)))
;(globalThis as { worfy?: WorfyBridge }).worfy = { invoke, on: () => 1, off: () => undefined } as unknown as WorfyBridge

const callsOf = (channel: string): unknown[] => invoke.mock.calls.filter(([name]) => name === channel).map(([, input]) => input)

/** A snapshot of an enabled Update: the copy runs 1.4.0+aaaaaaa, checked once, nothing else. */
const snapshot = (over: Partial<UpdateSnapshot> = {}): UpdateSnapshot =>
  updateSnapshotSchema.parse({
    enabled: true,
    checking: false,
    running: { commit: 'a'.repeat(40), version: '1.4.0+aaaaaaa' },
    lastCheck: { at: '2026-10-31T09:05:00.000Z', result: 'ok' },
    ...over,
  })

const available = { sha: 'b'.repeat(40), version: '1.5.0+bbbbbbb', quiet: false }

/** What main has now: `update.state` answers it, and the store takes it as an `update.changed` would. */
let current: UpdateSnapshot = snapshot()
function give(next: UpdateSnapshot): void {
  current = next
  act(() => useUpdateStore.setState({ snapshot: next }))
}

const settings = (over: Partial<AppSettings> = {}): AppSettings => ({ ...defaultAppSettings(), revision: 1, ...over })

beforeEach(() => {
  invoke.mockClear()
  for (const key of Object.keys(handlers)) delete handlers[key]
  current = snapshot()
  useUpdateStore.setState({ snapshot: current })
  handlers['update.state'] = () => ({ ok: true, value: current })
  handlers['appSettings.get'] = () => ({ ok: true, value: settings() })
  handlers['app.version'] = () => ({ ok: true, value: { version: '1.4.0+aaaaaaa' } })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useUpdateStore.setState({ starting: false })
})

const row = () => screen.getByTestId('settings-updates-row')
const disabled = (element: HTMLElement): boolean => (element as HTMLButtonElement).disabled

describe('Settings → General → Updates (worfy-update ticket 09)', () => {
  it('"Check now" calls update.check and takes its snapshot; it is inactive while a check runs', async () => {
    let finish: (answer: Answer) => void = () => undefined
    handlers['update.check'] = () => new Promise<Answer>((done) => (finish = done))
    render(<UpdatesBlock />)
    const button = within(row()).getByRole('button', { name: 'Check now' })
    fireEvent.click(button)
    expect(callsOf('update.check')).toHaveLength(1)
    // Main says a check runs: the button waits for it.
    give(snapshot({ checking: true }))
    expect(disabled(button)).toBe(true)
    await act(async () => finish({ ok: true, value: snapshot({ available }) }))
    expect(screen.getByTestId('settings-updates-status').textContent).toContain('worfy 1.5.0+bbbbbbb is available.')
    expect(disabled(within(row()).getByRole('button', { name: 'Check now' }))).toBe(false)
  })

  it('"Check now" is inactive while main says a check runs, without a press here', () => {
    give(snapshot({ checking: true }))
    render(<UpdatesBlock />)
    expect(disabled(within(row()).getByRole('button', { name: 'Check now' }))).toBe(true)
  })

  it('before the first check main does not know the copy that runs: the line names the build version it was given, or only what is known', () => {
    give(snapshot({ running: null, lastCheck: null }))
    const { rerender } = render(<UpdatesBlock version="1.4.0+aaaaaaa" />)
    expect(screen.getByTestId('settings-updates-status').textContent).toBe('worfy 1.4.0+aaaaaaa.')
    rerender(<UpdatesBlock />)
    expect(screen.getByTestId('settings-updates-status').textContent).toBe('')
    give(snapshot({ running: null }))
    expect(screen.getByTestId('settings-updates-status').textContent).toMatch(/^Last checked .+\.$/u)
  })

  it('without an Available update the line names the copy and the last check, and there is no "Update worfy"', () => {
    render(<UpdatesBlock />)
    const status = screen.getByTestId('settings-updates-status')
    expect(status.textContent).toMatch(/^worfy 1\.4\.0\+aaaaaaa\. Last checked .+\.$/u)
    expect(within(row()).queryByRole('button', { name: 'Update worfy' })).toBeNull()
  })

  it('a skipped check shows its reason under the line after "Check now", not before', async () => {
    give(snapshot({ lastCheck: { at: '2026-10-31T09:05:00.000Z', result: 'skipped', reason: 'GitHub answered 403' } }))
    handlers['update.check'] = () => ({ ok: true, value: current })
    render(<UpdatesBlock />)
    expect(screen.queryByTestId('settings-updates-reason')).toBeNull()
    fireEvent.click(within(row()).getByRole('button', { name: 'Check now' }))
    expect((await screen.findByTestId('settings-updates-reason')).textContent).toContain('GitHub answered 403')
  })

  it('a refused "Check now" shows the reason', async () => {
    handlers['update.check'] = () => ({ ok: false, error: 'update.check: main is gone' })
    render(<UpdatesBlock />)
    fireEvent.click(within(row()).getByRole('button', { name: 'Check now' }))
    expect((await screen.findByTestId('settings-updates-reason')).textContent).toContain('main is gone')
  })

  it('"Update worfy" builds the Available update (update.install); while it builds the line says so and the button is inactive', async () => {
    give(snapshot({ available }))
    handlers['update.install'] = () => ({ ok: true, value: snapshot({ available, build: { phase: 'building', sha: available.sha, version: available.version } }) })
    render(<UpdatesBlock />)
    expect(screen.getByTestId('settings-updates-status').textContent).toContain('worfy 1.5.0+bbbbbbb is available.')
    await act(async () => fireEvent.click(within(row()).getByRole('button', { name: 'Update worfy' })))
    expect(callsOf('update.install')).toHaveLength(1)
    give(snapshot({ available, build: { phase: 'building', sha: available.sha, version: available.version, step: 'fetch', steps: 3 } }))
    expect(screen.getByTestId('settings-updates-status').textContent).toContain('Building worfy 1.5.0+bbbbbbb…')
    expect(disabled(within(row()).getByRole('button', { name: 'Update worfy' }))).toBe(true)
  })

  it('built and something still works: "Restart when idle" calls update.restart with idle', async () => {
    give(snapshot({ available, idle: false, build: { phase: 'ready', sha: available.sha, version: available.version } }))
    handlers['update.restart'] = () => ({ ok: true, value: { outcome: 'waiting' } })
    render(<UpdatesBlock />)
    expect(screen.getByTestId('settings-updates-status').textContent).toContain('worfy 1.5.0+bbbbbbb is ready.')
    expect(within(row()).queryByRole('button', { name: 'Restart now' })).toBeNull()
    expect(within(row()).queryByRole('button', { name: 'Update worfy' })).toBeNull()
    fireEvent.click(within(row()).getByRole('button', { name: 'Restart when idle' }))
    await waitFor(() => expect(callsOf('update.restart')).toEqual([{ when: 'idle' }]))
    // The wish waits: the line says when worfy restarts.
    give(snapshot({ available, idle: false, restartWhenIdle: true, build: { phase: 'ready', sha: available.sha, version: available.version } }))
    expect(row().textContent).toContain('worfy restarts when no Session is working and Autopilot has stopped')
  })

  it('built and nothing works: "Restart now" calls update.restart with now; a refusal shows its reason', async () => {
    give(snapshot({ available, idle: true, build: { phase: 'ready', sha: available.sha, version: available.version } }))
    handlers['update.restart'] = () => ({ ok: true, value: { outcome: 'refused', reason: 'a Session started a turn', busy: true } })
    render(<UpdatesBlock />)
    fireEvent.click(within(row()).getByRole('button', { name: 'Restart now' }))
    expect(callsOf('update.restart')).toEqual([{ when: 'now' }])
    expect((await screen.findByTestId('settings-updates-reason')).textContent).toContain('a Session started a turn')
  })

  it('the switch "Update automatically" is on by default and writes autoUpdate: false', async () => {
    handlers['appSettings.set'] = (patch) => ({ ok: true, value: settings({ ...(patch as Partial<AppSettings>), revision: 2 }) })
    render(<UpdatesBlock />)
    const toggle = screen.getByRole('switch', { name: 'Update automatically' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('settings-updates-auto-row').textContent).toContain('Build new versions of worfy in the background. worfy restarts only when you say so.')
    fireEvent.click(toggle)
    expect(callsOf('appSettings.set')).toEqual([{ autoUpdate: false }])
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'))
  })

  it('without a previous copy the roll back is inactive and says so', () => {
    render(<UpdatesBlock />)
    const rollback = screen.getByTestId('settings-updates-rollback-row')
    expect(rollback.textContent).toContain('Roll back to previous version')
    expect(rollback.textContent).toContain('No previous version is kept.')
    expect(disabled(within(rollback).getByRole('button', { name: 'Roll back' }))).toBe(true)
    expect(callsOf('update.rollback')).toEqual([])
  })

  it('with a previous copy the roll back names it and calls update.rollback; Cancel in the dialog changes nothing', async () => {
    give(snapshot({ previous: { version: '1.3.0+ccccccc' } }))
    handlers['update.rollback'] = () => ({ ok: true, value: { outcome: 'cancelled' } })
    render(<UpdatesBlock />)
    const rollback = screen.getByTestId('settings-updates-rollback-row')
    expect(rollback.textContent).toContain('Return to worfy 1.3.0+ccccccc. Automatic updates wait for the next commit on main.')
    fireEvent.click(within(rollback).getByRole('button', { name: 'Roll back' }))
    await waitFor(() => expect(callsOf('update.rollback')).toHaveLength(1))
    expect(screen.queryByTestId('settings-updates-rollback-problem')).toBeNull()
  })

  it('a refused roll back shows its reason', async () => {
    give(snapshot({ previous: { version: '1.3.0+ccccccc' } }))
    handlers['update.rollback'] = () => ({ ok: true, value: { outcome: 'refused', reason: 'a restart is under way' } })
    render(<UpdatesBlock />)
    fireEvent.click(within(screen.getByTestId('settings-updates-rollback-row')).getByRole('button', { name: 'Roll back' }))
    expect((await screen.findByTestId('settings-updates-rollback-problem')).textContent).toContain('a restart is under way')
  })

  it('missing tools: one line names them and points to Health', () => {
    give(snapshot({ available, build: { phase: 'failed', missing: ['pnpm', 'git'] } }))
    render(<UpdatesBlock />)
    expect(screen.getByTestId('settings-updates-missing').textContent).toContain('Updates need git, node and pnpm: pnpm, git not found. See Settings → Health.')
  })

  it('after a roll back a line says which version runs and that automatic updates wait', () => {
    give(snapshot({ rolledBackFrom: 'b'.repeat(40), available: { ...available, quiet: true } }))
    render(<UpdatesBlock />)
    expect(row().textContent).toContain('worfy is back to 1.4.0+aaaaaaa. Automatic updates wait for the next commit on main.')
    // The commit rolled back from is quiet: no "is available", no "Update worfy".
    expect(screen.getByTestId('settings-updates-status').textContent).not.toContain('is available')
    expect(within(row()).queryByRole('button', { name: 'Update worfy' })).toBeNull()
  })

  it('without Update (enabled: false) there is no block, and none before main has answered', () => {
    give(snapshot({ enabled: false }))
    const { container, rerender } = render(<UpdatesBlock />)
    expect(container.innerHTML).toBe('')
    act(() => useUpdateStore.setState({ snapshot: null }))
    rerender(<UpdatesBlock />)
    expect(container.innerHTML).toBe('')
  })

  it('Settings → General shows the block under the line "Version", with the build version until main knows the copy that runs', async () => {
    give(snapshot({ running: null, lastCheck: null }))
    render(<GeneralSection />)
    const version = screen.getByTestId('settings-version-row')
    const updates = screen.getByTestId('settings-updates-row')
    expect(version.compareDocumentPosition(updates) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('settings-version').textContent).toContain('1.4.0+aaaaaaa'))
    expect(screen.getByTestId('settings-updates-status').textContent).toBe('worfy 1.4.0+aaaaaaa.')
  })
})

// worfy-update ticket 16: while it builds, the row says the step, its place and the time since the
// build began, counting on each second, with "Show log" beside the button; a press answers at once.
describe('Settings → General → Updates while it builds (worfy-update ticket 16)', () => {
  const STARTED = '2026-11-01T10:00:00.000Z'
  const building = (build: Partial<UpdateSnapshot['build']> = {}): UpdateSnapshot =>
    snapshot({ available, build: { phase: 'building', sha: available.sha, version: available.version, startedAt: STARTED, ...build } })

  it('the line has the step, its place and the time since the build began, counting on each second', () => {
    vi.useFakeTimers()
    let now = Date.parse(STARTED) + 192_000
    give(building({ step: 'install', steps: 3 }))
    render(<UpdatesBlock now={() => now} />)
    const status = (): string => screen.getByTestId('settings-updates-status').textContent ?? ''
    expect(status()).toBe('Building worfy 1.5.0+bbbbbbb… 2/3 Installing dependencies · 3:12')
    act(() => {
      now += 1000
      vi.advanceTimersByTime(1000)
    })
    expect(status()).toBe('Building worfy 1.5.0+bbbbbbb… 2/3 Installing dependencies · 3:13')
    give(building({ step: 'electron', steps: 4 }))
    expect(status()).toBe('Building worfy 1.5.0+bbbbbbb… 3/4 Downloading Electron · 3:13')
    // Built: the clock stops.
    give(snapshot({ available, build: { phase: 'ready', sha: available.sha, version: available.version } }))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('"Show log" is there while it builds and opens the log (update.showLog); a refusal shows its reason', async () => {
    handlers['update.showLog'] = () => ({ ok: false, error: 'update.showLog failed: there is no build log yet: no Update was built' })
    give(building({ step: 'package', steps: 3 }))
    render(<UpdatesBlock />)
    fireEvent.click(within(row()).getByRole('button', { name: 'Show log' }))
    expect(callsOf('update.showLog')).toHaveLength(1)
    expect((await screen.findByTestId('settings-updates-reason')).textContent).toContain('there is no build log yet')
    give(snapshot({ available }))
    expect(within(row()).queryByRole('button', { name: 'Show log' })).toBeNull()
  })

  it('"Update worfy" answers at once: "Starting update…" until main answers, and while the build has no step yet', async () => {
    let answer: (value: Answer) => void = () => undefined
    handlers['update.install'] = () => new Promise<Answer>((done) => (answer = done))
    give(snapshot({ available }))
    render(<UpdatesBlock />)
    fireEvent.click(within(row()).getByRole('button', { name: 'Update worfy' }))
    const starting = within(row()).getByRole('button', { name: 'Starting update…' })
    expect(disabled(starting)).toBe(true)
    await act(async () => answer({ ok: true, value: building() }))
    // Main has begun, and no step has come yet.
    expect(disabled(within(row()).getByRole('button', { name: 'Starting update…' }))).toBe(true)
    give(building({ step: 'fetch', steps: 3 }))
    expect(within(row()).queryByRole('button', { name: 'Starting update…' })).toBeNull()
  })
})

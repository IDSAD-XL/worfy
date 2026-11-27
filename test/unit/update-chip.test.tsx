import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { updateSnapshotSchema, type UpdateSnapshot } from '../../src/shared/ipc/update'
import { pressToastAction, resetToasts, toasts } from '../../src/renderer/toast/toasts'
import { INSTALL_REFUSED_KEY, useUpdateStore } from '../../src/renderer/update/store'
import type { HarnessStatusState } from '../../src/renderer/harness/useHarnessStatus'
import { VersionChipView } from '../../src/renderer/shell/footer/VersionChip'

// worfy-update ticket 06, moved to the footer by worfy-layout ticket 03: the version chip. It is a button
// with the app version; an Available update that is not quiet, a build that runs, is ready or failed puts
// the amber dot on it (src/renderer/shell/footer/version-dot.ts, test/unit/version-dot.test.tsx). Its
// popover's first row has the Update's actions the chip's menu had: "Update worfy" (or "Restart now" /
// "Restart when idle" once built, an inactive "Building worfy <version>…" while it builds) and "What's new"
// (ticket 10, test/unit/whats-new-view.test.tsx); Esc closes the popover, so "Later" is gone. Texts: the
// draft texts of the spec.

const SHA = 'b'.repeat(40)
const NEW = '0.5.0+bbbbbbb'

/** A snapshot of main with Update on, the given fields over the empty state. */
const snapshot = (fields: Partial<UpdateSnapshot> = {}): UpdateSnapshot => ({ ...updateSnapshotSchema.parse({ enabled: true, checking: false }), ...fields })
const available = (quiet = false): UpdateSnapshot['available'] => ({ sha: SHA, version: NEW, quiet })

const globals = globalThis as { worfy?: WorfyBridge }

/** A preload bridge that records each call with its input and answers it as main would. */
function fakeBridge() {
  const calls: { channel: string; input: unknown }[] = []
  globals.worfy = {
    invoke: (channel: string, input: unknown) => {
      calls.push({ channel, input })
      if (channel === 'update.install') return Promise.resolve({ ok: true, value: snapshot() })
      if (channel === 'update.restart') return Promise.resolve({ ok: true, value: { outcome: 'waiting' } })
      return Promise.resolve({ ok: false, error: `${channel}: not in this test` })
    },
    on: () => 0,
    off: () => undefined,
  } as unknown as WorfyBridge
  return calls
}

afterEach(() => {
  cleanup()
  delete globals.worfy
  vi.useRealTimers()
  resetToasts()
  useUpdateStore.setState({ snapshot: null, starting: false })
})

/** No Harness state yet: the popover has the app row alone. */
const NO_HARNESS: HarnessStatusState = {
  status: undefined,
  busy: false,
  busyText: 'Installing Harness…',
  failure: undefined,
  migration: false,
  onInstall: () => undefined,
  onEnable: () => undefined,
  enableFailure: undefined,
  onMigrate: undefined,
  onApproveHooks: () => undefined,
  harnessBehind: null,
  dialogs: null,
}

/** The chip with the app version and the Update snapshot given, and no Harness. */
function UpdateChip({ version, update, now }: { version: string; update: UpdateSnapshot | null; now?: () => number }) {
  return <VersionChipView version={{ version }} update={update} harness={NO_HARNESS} memoryShown={false} {...(now === undefined ? {} : { now })} />
}

const chip = (): HTMLElement => screen.getByTestId('app-version')
const dot = (): Element | null => chip().querySelector('.w-version-dot')
const popover = (): HTMLElement | null => screen.queryByRole('dialog', { name: 'worfy version' })
/** The buttons of the popover's app row. */
const items = (): string[] => [...screen.getByTestId('version-app-line').querySelectorAll('button')].map((item) => item.textContent ?? '')
const step = (): string | undefined => chip().querySelector('.w-footer__chip-step')?.textContent ?? undefined

describe('the version chip and the Update', () => {
  it('without Update (off in this copy, or before main answered): the version, no dot, and a popover row without buttons', () => {
    for (const update of [null, { ...snapshot({ available: available() }), enabled: false }]) {
      render(<UpdateChip version="0.4.0+aaaaaaa" update={update} />)
      expect(chip().tagName).toBe('BUTTON')
      expect(chip().textContent).toBe('v0.4.0+aaaaaaa')
      expect(chip().getAttribute('aria-label')).toBe('worfy v0.4.0+aaaaaaa')
      expect(dot()).toBeNull()
      fireEvent.click(chip())
      expect(screen.getByTestId('version-app-line').textContent).toBe('worfy v0.4.0+aaaaaaa')
      expect(items()).toEqual([])
      cleanup()
    }
  })

  it('with Update on and nothing to install: no dot, no Update action', () => {
    render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot()} />)
    expect(dot()).toBeNull()
    fireEvent.click(chip())
    expect(items()).toEqual([])
  })

  it(`an Available update: the amber dot and its reason; the popover has "Update worfy" and "What's new", and "Update worfy" calls update.install`, async () => {
    const calls = fakeBridge()
    render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available() })} />)
    // The text stays the version alone: the dot is a mark, not a character.
    expect(chip().textContent).toBe('v0.4.0+aaaaaaa')
    expect(dot()?.classList.contains('w-version-dot--amber')).toBe(true)
    expect(chip().getAttribute('title')).toBe(`worfy v0.4.0+aaaaaaa — worfy ${NEW} is available`)
    expect(chip().getAttribute('aria-label')).toBe(`worfy v0.4.0+aaaaaaa — worfy ${NEW} is available`)
    expect(chip().getAttribute('aria-haspopup')).toBe('dialog')
    expect(popover()).toBeNull()
    fireEvent.click(chip())
    expect(chip().getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('version-app-line').textContent).toContain(`worfy v0.4.0+aaaaaaa · update ${NEW} available`)
    expect(items()).toEqual(['Update worfy', "What's new"])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Update worfy' }))
      await Promise.resolve()
    })
    expect(calls).toEqual([{ channel: 'update.install', input: undefined }])
  })

  it('Escape and a click outside close the popover', () => {
    fakeBridge()
    render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available() })} />)
    fireEvent.click(chip())
    expect(popover()).not.toBeNull()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Update worfy' }), { key: 'Escape' })
    expect(popover()).toBeNull()
    fireEvent.click(chip())
    expect(popover()).not.toBeNull()
    fireEvent.mouseDown(document.body)
    fireEvent.click(document.body)
    expect(popover()).toBeNull()
  })

  it('the actions of an open popover go with the signal, and a signal that comes back does not open it by itself', () => {
    fakeBridge()
    const { rerender } = render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available() })} />)
    fireEvent.click(chip())
    expect(items()).toEqual(['Update worfy', "What's new"])
    // Installed elsewhere (Settings, another window): nothing to install, the row has the version alone.
    rerender(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot()} />)
    expect(items()).toEqual([])
    fireEvent.keyDown(screen.getByTestId('version-app-line'), { key: 'Escape' })
    // A newer Update arrives: the dot, the popover stays closed until a press.
    rerender(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available() })} />)
    expect(dot()).not.toBeNull()
    expect(popover()).toBeNull()
    expect(chip().getAttribute('aria-expanded')).toBe('false')
  })

  it('a quiet Available update (the commit rolled back from): no dot, but the actions are in the popover', () => {
    fakeBridge()
    render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available(true) })} />)
    expect(dot()).toBeNull()
    fireEvent.click(chip())
    expect(items()).toEqual(['Update worfy', "What's new"])
  })

  it('while it builds: the spinner (ticket 16), "Building worfy <version>…" in the tooltip and as an inactive button that calls nothing', () => {
    const calls = fakeBridge()
    render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available(), build: { phase: 'building', sha: SHA, version: NEW } })} />)
    expect(chip().querySelector('.w-update-spinner')).not.toBeNull()
    expect(chip().getAttribute('title')).toBe(`worfy v0.4.0+aaaaaaa — Building worfy ${NEW}…\nStarting update…`)
    fireEvent.click(chip())
    expect(items()).toEqual([`Building worfy ${NEW}…`, "What's new"])
    const building = screen.getByRole('button', { name: `Building worfy ${NEW}…` })
    expect(building.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(building)
    expect(calls).toEqual([])
  })

  it('built and nothing works: "Restart now" calls update.restart { when: now }', async () => {
    const calls = fakeBridge()
    render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available(), idle: true, build: { phase: 'ready', sha: SHA, version: NEW } })} />)
    expect(dot()).not.toBeNull()
    expect(chip().getAttribute('title')).toBe(`worfy v0.4.0+aaaaaaa — worfy ${NEW} is ready — restart to update`)
    fireEvent.click(chip())
    expect(items()).toEqual(['Restart now', "What's new"])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Restart now' }))
      await Promise.resolve()
    })
    expect(calls).toEqual([{ channel: 'update.restart', input: { when: 'now' } }])
  })

  it('built while a Session works (idle: false): "Restart when idle" calls update.restart { when: idle }', async () => {
    const calls = fakeBridge()
    render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available(), idle: false, build: { phase: 'ready', sha: SHA, version: NEW } })} />)
    fireEvent.click(chip())
    expect(items()).toEqual(['Restart when idle', 'Restart now', "What's new"])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Restart when idle' }))
      await Promise.resolve()
    })
    expect(calls).toEqual([{ channel: 'update.restart', input: { when: 'idle' } }])
  })

  it('built while a Session works: "Restart now" next to it calls update.restart { when: now } (worfy-continuity ticket 08)', async () => {
    const calls = fakeBridge()
    render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available(), idle: false, build: { phase: 'ready', sha: SHA, version: NEW } })} />)
    fireEvent.click(chip())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Restart now' }))
      await Promise.resolve()
    })
    expect(calls).toEqual([{ channel: 'update.restart', input: { when: 'now' } }])
  })

  it('a failed build: the dot, the failure in the tooltip, and "Update worfy" builds again', async () => {
    const calls = fakeBridge()
    render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available(), build: { phase: 'failed', sha: SHA, version: NEW } })} />)
    expect(dot()).not.toBeNull()
    expect(chip().getAttribute('title')).toBe(`worfy v0.4.0+aaaaaaa — The update to ${NEW} failed — see Settings → Health`)
    fireEvent.click(chip())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Update worfy' }))
      await Promise.resolve()
    })
    expect(calls).toEqual([{ channel: 'update.install', input: undefined }])
  })

  it('the dots are drawn in the colours of the Health check button: red critical, amber warning', () => {
    // jsdom loads no stylesheet: the rules are read from the file itself.
    const css = readFileSync(join(import.meta.dirname, '../../src/renderer/shell/shell.css'), 'utf8')
    const rule = (selector: string): string => {
      // The rule of the selector alone, at the start of a line: not a descendant rule that ends with it.
      const start = css.indexOf(`\n${selector} {`)
      expect(start, selector).toBeGreaterThanOrEqual(0)
      return css.slice(start, css.indexOf('}', start))
    }
    expect(rule('.w-version-dot--red')).toMatch(/background:\s*var\(--health-critical\);/)
    expect(rule('.w-version-dot--amber')).toMatch(/background:\s*var\(--health-warning\);/)
    // The Harness's own Update button keeps the accent dot.
    expect(rule('.w-update-dot')).toMatch(/background:\s*var\(--accent\);/)
  })
})

describe('the version chip while the Harness installs (worfy-layout ticket 03, rework round 1)', () => {
  // While its own install runs the Harness line says "Installing Harness…": the chip keeps no dot of the state
  // read before it, so a not-installed Harness shows its red dot only once the install is not running.
  const notInstalled = (busy: boolean): HarnessStatusState => ({
    ...NO_HARNESS,
    busy,
    status: { state: { kind: 'not-installed' }, bundledVersion: '0.2.0+bbbbbbb', canInstall: true, pluginDir: '/Users/someone/.claude/worfy-harness/plugin', dependencies: [] },
  })

  it('busy with a not-installed Harness: no dot and no reason; idle again: the red dot of Install', () => {
    const view = render(<VersionChipView version={{ version: '0.4.0' }} update={snapshot()} harness={notInstalled(true)} memoryShown={false} />)
    expect(chip().hasAttribute('data-dot')).toBe(false)
    expect(dot()).toBeNull()
    expect(chip().getAttribute('aria-label')).toBe('worfy v0.4.0')
    view.rerender(<VersionChipView version={{ version: '0.4.0' }} update={snapshot()} harness={notInstalled(false)} memoryShown={false} />)
    expect(chip().getAttribute('data-dot')).toBe('red')
    expect(chip().getAttribute('aria-label')).toBe('worfy v0.4.0 — Harness needs Install')
  })
})

// worfy-update ticket 16: the build is seen without a hover. The chip names the step and its place,
// the tooltip the time since the build began; a press answers at once ("Starting update…"), a
// refusal comes as a toast, and a restart that began is "Restarting…".
describe('the version chip while an update is under way (ticket 16)', () => {
  const STARTED = '2026-11-01T10:00:00.000Z'
  /** 3 min 12 s after the build began. */
  const later = (): number => Date.parse(STARTED) + 192_000
  const building = (build: Partial<UpdateSnapshot['build']>): UpdateSnapshot =>
    snapshot({ available: available(), build: { phase: 'building', sha: SHA, version: NEW, startedAt: STARTED, ...build } })
  const spinner = (): Element | null => chip().querySelector('.w-update-spinner')

  it('names the step and its place on the chip itself, with a spinner in place of the dot', () => {
    const cases: [Partial<UpdateSnapshot['build']>, string][] = [
      [{ step: 'fetch', steps: 3 }, 'Updating · 1/3 Fetching source'],
      [{ step: 'install', steps: 3 }, 'Updating · 2/3 Installing dependencies'],
      [{ step: 'electron', steps: 4 }, 'Updating · 3/4 Downloading Electron'],
      [{ step: 'package', steps: 4 }, 'Updating · 4/4 Building app'],
      [{ step: 'package', steps: 3 }, 'Updating · 3/3 Building app'],
    ]
    for (const [build, text] of cases) {
      render(<UpdateChip version="0.4.0+aaaaaaa" update={building(build)} now={later} />)
      expect(step()).toBe(text)
      expect(chip().getAttribute('data-update')).toBe('building')
      expect(spinner()).not.toBeNull()
      expect(dot()).toBeNull()
      cleanup()
    }
  })

  it('a build that has not reached its first step yet is "Starting update…"', () => {
    render(<UpdateChip version="0.4.0+aaaaaaa" update={building({})} now={later} />)
    expect(step()).toBe('Starting update…')
    expect(spinner()).not.toBeNull()
  })

  it('the tooltip has the time since the build began, and counts on each second while the pointer is on the chip', () => {
    vi.useFakeTimers()
    let now = later()
    render(<UpdateChip version="0.4.0+aaaaaaa" update={building({ step: 'install', steps: 3 })} now={() => now} />)
    expect(chip().getAttribute('title')).toBe(`worfy v0.4.0+aaaaaaa — Building worfy ${NEW}…\nUpdating · 2/3 Installing dependencies\nBuilding worfy ${NEW}… 3:12`)
    fireEvent.mouseEnter(chip())
    act(() => {
      now += 1000
      vi.advanceTimersByTime(1000)
    })
    expect(chip().getAttribute('title')).toContain(`Updating · 2/3 Installing dependencies\nBuilding worfy ${NEW}… 3:13`)
    act(() => {
      now += 3600_000
      vi.advanceTimersByTime(1000)
    })
    expect(chip().getAttribute('title')).toContain(`Updating · 2/3 Installing dependencies\nBuilding worfy ${NEW}… 1:03:13`)
    // The pointer gone, nothing ticks.
    fireEvent.mouseLeave(chip())
    expect(vi.getTimerCount()).toBe(0)
  })

  // worfy-polish ticket 48 kept a pointer from counting on after its button was gone; the footer's chip stays one button.
  it('the chip stays one button while an Update restarts and builds again: its mouseleave and blur stop the count', () => {
    vi.useFakeTimers()
    const version = '0.4.0+aaaaaaa'
    const view = render(<UpdateChip version={version} update={building({ step: 'install', steps: 3 })} now={later} />)
    fireEvent.mouseEnter(chip())
    fireEvent.focus(chip())
    expect(vi.getTimerCount()).toBe(1)
    // Restarting: still the same button, and nothing ticks.
    view.rerender(<UpdateChip version={version} update={{ ...snapshot({ available: available(), idle: true, build: { phase: 'ready', sha: SHA, version: NEW } }), restarting: true }} now={later} />)
    expect(chip().tagName).toBe('BUTTON')
    expect(vi.getTimerCount()).toBe(0)
    fireEvent.mouseLeave(chip())
    fireEvent.blur(chip())
    // The restart did not happen and a build runs again: no one points at the chip.
    view.rerender(<UpdateChip version={version} update={building({ step: 'fetch', steps: 3 })} now={later} />)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('the step is cut with an ellipsis on the chip (shell.css), and is the first line of the tooltip after the chip\'s name', () => {
    render(<UpdateChip version="0.4.0+aaaaaaa" update={building({ step: 'install', steps: 3 })} now={later} />)
    expect(step()).toBe('Updating · 2/3 Installing dependencies')
    expect(chip().getAttribute('title')?.split('\n').slice(1)).toEqual(['Updating · 2/3 Installing dependencies', `Building worfy ${NEW}… 3:12`])
    const css = readFileSync(join(import.meta.dirname, '../../src/renderer/shell/shell.css'), 'utf8')
    const start = css.indexOf('\n.w-footer__chip-step {')
    expect(start).toBeGreaterThanOrEqual(0)
    const rule = css.slice(start, css.indexOf('}', start))
    expect(rule).toMatch(/max-width:\s*\d+ch;/)
    expect(rule).toMatch(/text-overflow:\s*ellipsis;/)
    expect(rule).toMatch(/overflow:\s*hidden;/)
  })

  it('"Update worfy" answers at once: "Starting update…" until main answers', async () => {
    let answer: (value: unknown) => void = () => undefined
    globals.worfy = {
      invoke: (channel: string) => (channel === 'update.install' ? new Promise((done) => (answer = done)) : Promise.resolve({ ok: false, error: `${channel}: not in this test` })),
      on: () => 0,
      off: () => undefined,
    } as unknown as WorfyBridge
    render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available() })} now={later} />)
    fireEvent.click(chip())
    fireEvent.click(screen.getByRole('button', { name: 'Update worfy' }))
    expect(step()).toBe('Starting update…')
    expect(spinner()).not.toBeNull()
    await act(async () => {
      answer({ ok: true, value: building({ step: 'fetch', steps: 3 }) })
      await Promise.resolve()
    })
    expect(useUpdateStore.getState().starting).toBe(false)
  })

  it('a refusal of update.install is a toast with its reason and "Show log" when there is a log, not a line in the console', async () => {
    const calls: string[] = []
    globals.worfy = {
      invoke: (channel: string) => {
        calls.push(channel)
        return Promise.resolve(channel === 'update.install' ? { ok: false, error: 'update.install failed: this update is being built already' } : { ok: true, value: undefined })
      },
      on: () => 0,
      off: () => undefined,
    } as unknown as WorfyBridge
    const failed = snapshot({ available: available(), build: { phase: 'failed', sha: SHA, version: NEW, log: '/data/update/build.log' } })
    render(<UpdateChip version="0.4.0+aaaaaaa" update={failed} />)
    fireEvent.click(chip())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Update worfy' }))
      await Promise.resolve()
      await Promise.resolve()
    })
    const told = toasts.getState().toasts.find((toast) => toast.id === INSTALL_REFUSED_KEY)
    expect(told).toMatchObject({ kind: 'action', text: 'The update did not start: this update is being built already' })
    expect(told?.actions?.map((action) => action.label)).toEqual(['Show log'])
    // The chip is back to what main says: the press is over.
    expect(chip().textContent).toBe('v0.4.0+aaaaaaa')
    act(() => pressToastAction(INSTALL_REFUSED_KEY, 0))
    expect(calls).toEqual(['update.install', 'update.showLog'])
  })

  it('a refusal without a build log is an error toast with no button', async () => {
    globals.worfy = {
      invoke: () => Promise.resolve({ ok: false, error: 'update.install failed: there is no new version to build' }),
      on: () => 0,
      off: () => undefined,
    } as unknown as WorfyBridge
    render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available() })} />)
    fireEvent.click(chip())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Update worfy' }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(toasts.getState().toasts.map(({ id, kind, text }) => ({ id, kind, text }))).toEqual([
      { id: INSTALL_REFUSED_KEY, kind: 'error', text: 'The update did not start: there is no new version to build' },
    ])
  })

  it('a restart that began is "Restarting…" with the spinner, and the popover offers no Update action', () => {
    render(<UpdateChip version="0.4.0+aaaaaaa" update={{ ...snapshot({ available: available(), idle: true, build: { phase: 'ready', sha: SHA, version: NEW } }), restarting: true }} />)
    expect(chip().textContent).toBe('Restarting…')
    expect(chip().getAttribute('data-update')).toBe('restarting')
    expect(spinner()).not.toBeNull()
    expect(dot()).toBeNull()
    fireEvent.click(chip())
    expect(screen.getByTestId('version-app-line').textContent).toBe('worfy v0.4.0+aaaaaaa · restarting…')
    expect(items()).toEqual([])
  })

  it('the spinner turns, and stands still with reduced motion', () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/renderer/shell/shell.css'), 'utf8')
    const start = css.indexOf('\n.w-update-spinner {')
    expect(start).toBeGreaterThanOrEqual(0)
    expect(css.slice(start, css.indexOf('}', start))).toMatch(/animation:\s*w-update-spin /)
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*\.w-update-spinner \{([^}]*)\}/)
    expect(reduced?.[1]).toMatch(/animation:\s*none;/)
  })
})

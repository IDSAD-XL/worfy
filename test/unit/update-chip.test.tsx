import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { updateSnapshotSchema, type UpdateSnapshot } from '../../src/shared/ipc/update'
import { pressToastAction, resetToasts, toasts } from '../../src/renderer/toast/toasts'
import { INSTALL_REFUSED_KEY, useUpdateStore } from '../../src/renderer/update/store'
import UpdateChip from '../../src/renderer/update/UpdateChip'

// worfy-update ticket 06: the version chip of the toolbar. The app version is the same small line
// as before; an Available update, a build that runs, is ready or failed puts an accent dot on it and
// makes it a button with a menu: "Update worfy" (or "Restart now" / "Restart when idle" once built,
// an inactive "Building worfy <version>…" while it builds), "What's new" (ticket 10,
// test/unit/whats-new-view.test.tsx) and "Later". Texts: the draft texts of the spec.

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

const chip = (): HTMLElement => screen.getByTestId('app-version')
const dot = (): Element | null => chip().querySelector('.w-update-dot')
const items = (): string[] => screen.getAllByRole('menuitem').map((item) => item.textContent ?? '')

describe('UpdateChip', () => {
  it('without Update (off in this copy, or before main answered) is the plain version line: no dot, no button', () => {
    for (const update of [null, { ...snapshot({ available: available() }), enabled: false }]) {
      render(<UpdateChip version="0.4.0+aaaaaaa" update={update} />)
      expect(chip().tagName).toBe('SMALL')
      expect(chip().textContent).toBe('v0.4.0+aaaaaaa')
      expect(dot()).toBeNull()
      expect(screen.queryByRole('button')).toBeNull()
      cleanup()
    }
  })

  it('with Update on and nothing to install: the plain line, no dot, no button', () => {
    render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot()} />)
    expect(chip().tagName).toBe('SMALL')
    expect(dot()).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it(`an Available update: a dot and its tooltip; the menu has "Update worfy", "What's new" and "Later", and "Update worfy" calls update.install`, async () => {
    const calls = fakeBridge()
    render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available() })} />)
    expect(chip().tagName).toBe('BUTTON')
    // The text stays the version alone: the dot is a mark, not a character.
    expect(chip().textContent).toBe('v0.4.0+aaaaaaa')
    expect(dot()).not.toBeNull()
    expect(chip().getAttribute('title')).toBe(`worfy ${NEW} is available`)
    expect(chip().getAttribute('aria-haspopup')).toBe('menu')
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(chip())
    expect(chip().getAttribute('aria-expanded')).toBe('true')
    expect(items()).toEqual(['Update worfy', "What's new", 'Later'])
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Update worfy' }))
      await Promise.resolve()
    })
    expect(calls).toEqual([{ channel: 'update.install', input: undefined }])
    // The press closes the menu.
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('"Later" only closes the menu: nothing is called, the dot stays (spec R12)', () => {
    const calls = fakeBridge()
    render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available() })} />)
    fireEvent.click(chip())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Later' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(calls).toEqual([])
    expect(dot()).not.toBeNull()
  })

  it('Escape and a click outside close the menu', () => {
    fakeBridge()
    render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available() })} />)
    fireEvent.click(chip())
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(chip())
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('an open menu goes with the signal, and does not open again by itself when a signal comes back', () => {
    fakeBridge()
    const { rerender } = render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available() })} />)
    fireEvent.click(chip())
    expect(screen.queryByRole('menu')).not.toBeNull()
    // Installed elsewhere (Settings, another window): nothing to install, the plain line.
    rerender(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot()} />)
    expect(screen.queryByRole('menu')).toBeNull()
    // A newer Update arrives: the dot, the menu stays closed until a press.
    rerender(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available() })} />)
    expect(dot()).not.toBeNull()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(chip().getAttribute('aria-expanded')).toBe('false')
  })

  it('a quiet Available update (the commit rolled back from): no dot, but still a button with the menu', () => {
    fakeBridge()
    render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available(true) })} />)
    expect(dot()).toBeNull()
    fireEvent.click(chip())
    expect(items()).toEqual(['Update worfy', "What's new", 'Later'])
  })

  it('while it builds: the dot, "Building worfy <version>…" as the tooltip and as an inactive item that calls nothing', () => {
    const calls = fakeBridge()
    render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available(), build: { phase: 'building', sha: SHA, version: NEW } })} />)
    expect(dot()).not.toBeNull()
    expect(chip().getAttribute('title')).toBe(`Building worfy ${NEW}…`)
    fireEvent.click(chip())
    expect(items()).toEqual([`Building worfy ${NEW}…`, "What's new", 'Later'])
    const building = screen.getByRole('menuitem', { name: `Building worfy ${NEW}…` })
    expect(building.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(building)
    expect(calls).toEqual([])
  })

  it('built and nothing works: "Restart now" calls update.restart { when: now }', async () => {
    const calls = fakeBridge()
    render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available(), idle: true, build: { phase: 'ready', sha: SHA, version: NEW } })} />)
    expect(dot()).not.toBeNull()
    expect(chip().getAttribute('title')).toBe(`worfy ${NEW} is ready — restart to update`)
    fireEvent.click(chip())
    expect(items()).toEqual(['Restart now', "What's new", 'Later'])
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Restart now' }))
      await Promise.resolve()
    })
    expect(calls).toEqual([{ channel: 'update.restart', input: { when: 'now' } }])
  })

  it('built while a Session works (idle: false): "Restart when idle" calls update.restart { when: idle }', async () => {
    const calls = fakeBridge()
    render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available(), idle: false, build: { phase: 'ready', sha: SHA, version: NEW } })} />)
    fireEvent.click(chip())
    expect(items()).toEqual(['Restart when idle', "What's new", 'Later'])
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Restart when idle' }))
      await Promise.resolve()
    })
    expect(calls).toEqual([{ channel: 'update.restart', input: { when: 'idle' } }])
  })

  it('a failed build: the dot, the failure tooltip, and "Update worfy" builds again', async () => {
    const calls = fakeBridge()
    render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available(), build: { phase: 'failed', sha: SHA, version: NEW } })} />)
    expect(dot()).not.toBeNull()
    expect(chip().getAttribute('title')).toBe(`The update to ${NEW} failed — see Settings → Health`)
    fireEvent.click(chip())
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Update worfy' }))
      await Promise.resolve()
    })
    expect(calls).toEqual([{ channel: 'update.install', input: undefined }])
  })

  it('the dot is drawn in the accent colour of the theme, and the chip keeps the 13px line of the version', () => {
    // jsdom loads no stylesheet: the rules are read from the file itself.
    const css = readFileSync(join(import.meta.dirname, '../../src/renderer/shell/shell.css'), 'utf8')
    const rule = (selector: string): string => {
      // The rule of the selector alone, at the start of a line: not a descendant rule that ends with it.
      const start = css.indexOf(`\n${selector} {`)
      expect(start, selector).toBeGreaterThanOrEqual(0)
      return css.slice(start, css.indexOf('}', start))
    }
    expect(rule('.w-update-dot')).toMatch(/background:\s*var\(--accent\);/)
    expect(rule('.w-toolbar__version-chip')).toMatch(/line-height:\s*13px;/)
  })
})

// worfy-update ticket 16: the build is seen without a hover. The chip names the step and its place,
// the tooltip the time since the build began; a press answers at once ("Starting update…"), a
// refusal comes as a toast, and a restart that began is "Restarting…".
describe('UpdateChip while an update is under way (ticket 16)', () => {
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
      expect(chip().textContent).toBe(text)
      expect(chip().getAttribute('data-update')).toBe('building')
      expect(spinner()).not.toBeNull()
      expect(dot()).toBeNull()
      cleanup()
    }
  })

  it('a build that has not reached its first step yet is "Starting update…"', () => {
    render(<UpdateChip version="0.4.0+aaaaaaa" update={building({})} now={later} />)
    expect(chip().textContent).toBe('Starting update…')
    expect(spinner()).not.toBeNull()
  })

  it('the tooltip has the time since the build began, and counts on each second while the pointer is on the chip', () => {
    vi.useFakeTimers()
    let now = later()
    render(<UpdateChip version="0.4.0+aaaaaaa" update={building({ step: 'install', steps: 3 })} now={() => now} />)
    expect(chip().getAttribute('title')).toBe(`Building worfy ${NEW}… 3:12`)
    fireEvent.mouseEnter(chip())
    act(() => {
      now += 1000
      vi.advanceTimersByTime(1000)
    })
    expect(chip().getAttribute('title')).toBe(`Building worfy ${NEW}… 3:13`)
    act(() => {
      now += 3600_000
      vi.advanceTimersByTime(1000)
    })
    expect(chip().getAttribute('title')).toBe(`Building worfy ${NEW}… 1:03:13`)
    // The pointer gone, nothing ticks.
    fireEvent.mouseLeave(chip())
    expect(vi.getTimerCount()).toBe(0)
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
    fireEvent.click(screen.getByRole('menuitem', { name: 'Update worfy' }))
    expect(chip().textContent).toBe('Starting update…')
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
        return Promise.resolve(channel === 'update.install' ? { ok: false, error: 'update.install: this update is being built already' } : { ok: true, value: undefined })
      },
      on: () => 0,
      off: () => undefined,
    } as unknown as WorfyBridge
    const failed = snapshot({ available: available(), build: { phase: 'failed', sha: SHA, version: NEW, log: '/data/update/build.log' } })
    render(<UpdateChip version="0.4.0+aaaaaaa" update={failed} />)
    fireEvent.click(chip())
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Update worfy' }))
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
      invoke: () => Promise.resolve({ ok: false, error: 'update.install: there is no new version to build' }),
      on: () => 0,
      off: () => undefined,
    } as unknown as WorfyBridge
    render(<UpdateChip version="0.4.0+aaaaaaa" update={snapshot({ available: available() })} />)
    fireEvent.click(chip())
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Update worfy' }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(toasts.getState().toasts.map(({ id, kind, text }) => ({ id, kind, text }))).toEqual([
      { id: INSTALL_REFUSED_KEY, kind: 'error', text: 'The update did not start: there is no new version to build' },
    ])
  })

  it('a restart that began is "Restarting…" with the spinner, and no longer a button with a menu', () => {
    render(<UpdateChip version="0.4.0+aaaaaaa" update={{ ...snapshot({ available: available(), idle: true, build: { phase: 'ready', sha: SHA, version: NEW } }), restarting: true }} />)
    expect(chip().textContent).toBe('Restarting…')
    expect(chip().tagName).not.toBe('BUTTON')
    expect(chip().getAttribute('data-update')).toBe('restarting')
    expect(spinner()).not.toBeNull()
  })

  it('the spinner turns, and stands still with reduced motion; its text keeps the 13px line', () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/renderer/shell/shell.css'), 'utf8')
    const start = css.indexOf('\n.w-update-spinner {')
    expect(start).toBeGreaterThanOrEqual(0)
    expect(css.slice(start, css.indexOf('}', start))).toMatch(/animation:\s*w-update-spin /)
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*\.w-update-spinner \{([^}]*)\}/)
    expect(reduced?.[1]).toMatch(/animation:\s*none;/)
  })
})

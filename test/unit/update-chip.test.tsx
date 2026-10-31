import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { updateSnapshotSchema, type UpdateSnapshot } from '../../src/shared/ipc/update'
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

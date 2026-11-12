// The kit's ContextMenu (src/renderer/theme/kit/ContextMenu.tsx, worfy-ui-kit ticket 12, ADR-0106),
// seen from outside: the role and the name, the keys that move in it, what Esc does and to whom, where
// the focus goes — back to where it was, and to the opener under a window an item opens —, what closes
// it, and its place at the edge of the window.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState, type KeyboardEvent } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu, type ContextMenuPoint, type ContextMenuProps } from '../../src/renderer/theme/kit/ContextMenu'
import { Dialog } from '../../src/renderer/theme/kit/Dialog'
import { MenuItem, MenuSeparator } from '../../src/renderer/theme/kit/Menu'
import { LAYERS } from '../../src/renderer/theme/layers'

/** A pointer press as a browser sends it: pointerdown, mousedown, pointerup, mouseup, click. */
function press(element: Element): void {
  fireEvent.pointerDown(element, { button: 0, pointerType: 'mouse' })
  fireEvent.mouseDown(element, { button: 0 })
  fireEvent.pointerUp(element, { button: 0, pointerType: 'mouse' })
  fireEvent.mouseUp(element, { button: 0 })
  fireEvent.click(element, { button: 0 })
}

/** Lets Base UI's effects and timers run. */
const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))

type Options = Partial<Omit<ContextMenuProps, 'at' | 'onClose' | 'children' | 'label'>> & { onChoose?: (what: string) => void; withOpener?: boolean }

/**
 * An area with a right-click menu of three items, one of them inactive, and a button that had the
 * focus before; its state kept here as the places keep it. "Settings…" opens a window of the kit.
 */
function Area({ onChoose = () => undefined, withOpener = false, ...options }: Options) {
  const [at, setAt] = useState<ContextMenuPoint | null>(null)
  const [settings, setSettings] = useState(false)
  const [row, setRow] = useState<HTMLButtonElement | null>(null)
  return (
    <>
      <button type="button">Before</button>
      <div
        data-testid="area"
        onContextMenu={(event) => {
          event.preventDefault()
          setAt({ x: event.clientX, y: event.clientY })
        }}
      >
        <button type="button" ref={setRow}>
          Row
        </button>
      </div>
      <ContextMenu at={at} onClose={() => setAt(null)} label="Row actions" testId="menu" opener={withOpener ? row : undefined} {...options}>
        <MenuItem testId="item-run" onClick={() => onChoose('run')}>
          Run
        </MenuItem>
        <MenuItem disabled title="Nothing to stop" onClick={() => onChoose('stop')}>
          Stop
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          onClick={() => {
            setAt(null)
            setSettings(true)
          }}
        >
          Settings…
        </MenuItem>
      </ContextMenu>
      {settings ? (
        <Dialog open onClose={() => setSettings(false)} label="Settings" className="">
          <button type="button" onClick={() => setSettings(false)}>
            Cancel
          </button>
        </Dialog>
      ) : null}
    </>
  )
}

const menu = () => screen.queryByRole('menu', { name: 'Row actions' })
const item = (name: string) => screen.getByRole('menuitem', { name })
const button = (name: string) => screen.getByRole('button', { name })

async function openAt(x = 100, y = 120): Promise<HTMLElement> {
  fireEvent.contextMenu(screen.getByTestId('area'), { clientX: x, clientY: y })
  await flush()
  return screen.getByRole('menu', { name: 'Row actions' })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the kit ContextMenu', () => {
  it('is a menu named by its label, its items menuitems, drawn into the body on the popover layer, without a backdrop', async () => {
    const { container } = render(<Area />)
    expect(menu()).toBeNull()
    const opened = await openAt()
    expect(opened.getAttribute('data-testid')).toBe('menu')
    expect(opened.classList.contains('w-kit-menu')).toBe(true)
    expect([...opened.querySelectorAll('[role="menuitem"]')].map((each) => each.textContent)).toEqual(['Run', 'Stop', 'Settings…'])
    expect(item('Stop').getAttribute('aria-disabled')).toBe('true')
    expect(container.contains(opened)).toBe(false)
    const portal = opened.closest<HTMLElement>('[data-base-ui-portal], body > div')!
    expect(portal.style.zIndex).toBe(String(LAYERS.popover))
    expect(portal.style.position).toBe('relative')
    // modal={false}: nothing lies over the window, and the page stays readable by a screen reader.
    expect(document.querySelector('div[role="presentation"][data-base-ui-inert]')).toBeNull()
    expect(button('Row').closest('[aria-hidden="true"], [inert]')).toBeNull()
  })

  it('opens on the first item; the arrows go round, Home and End go to the ends, a letter goes to its item', async () => {
    render(<Area />)
    await openAt()
    expect(document.activeElement).toBe(item('Run'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(item('Stop'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(item('Settings…'))
    // Going round, Base UI moves the focus a frame later.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    await flush()
    expect(document.activeElement).toBe(item('Run'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    await flush()
    expect(document.activeElement).toBe(item('Settings…'))
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(document.activeElement).toBe(item('Run'))
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(document.activeElement).toBe(item('Settings…'))
    fireEvent.keyDown(document.activeElement!, { key: 's' })
    await flush()
    expect(document.activeElement).toBe(item('Stop'))
  })

  it('focusOnOpen names another first item: the first active one', async () => {
    render(<Area focusOnOpen='[role="menuitem"]:not([aria-disabled="true"])' />)
    fireEvent.contextMenu(screen.getByTestId('area'), { clientX: 10, clientY: 10 })
    await flush()
    expect(document.activeElement).toBe(item('Run'))
  })

  it('Esc closes only the menu, marked handled, out of reach of an ancestor with an Esc of its own; the focus goes back to where it was', async () => {
    const ancestor = vi.fn()
    const onWindow = vi.fn((event: globalThis.KeyboardEvent) => event.defaultPrevented)
    window.addEventListener('keydown', onWindow)
    render(
      <div onKeyDown={(event: KeyboardEvent) => event.key === 'Escape' && ancestor()}>
        <Area />
      </div>,
    )
    button('Before').focus()
    await openAt()
    expect(document.activeElement).toBe(item('Run'))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await flush()
    window.removeEventListener('keydown', onWindow)
    expect(menu()).toBeNull()
    expect(ancestor).not.toHaveBeenCalled()
    expect(onWindow.mock.results.every((result) => result.value === true)).toBe(true)
    expect(document.activeElement).toBe(button('Before'))
  })

  it('Esc on an inactive item closes the menu too', async () => {
    render(<Area />)
    await openAt()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(item('Stop'))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await flush()
    expect(menu()).toBeNull()
  })

  it('choosing an item runs it, closes the menu and gives the focus back to the opener; an inactive item does nothing', async () => {
    const onChoose = vi.fn()
    render(<Area onChoose={onChoose} withOpener />)
    await openAt()
    press(item('Stop'))
    await flush()
    expect(onChoose).not.toHaveBeenCalled()
    expect(menu()).not.toBeNull()
    press(item('Run'))
    await flush()
    expect(onChoose).toHaveBeenCalledWith('run')
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(button('Row'))
  })

  it('a window an item opens gives the focus back to the opener when it closes, not to the page', async () => {
    render(<Area withOpener />)
    await openAt()
    press(item('Settings…'))
    await flush()
    expect(menu()).toBeNull()
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    expect(dialog.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await flush()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(button('Row'))
  })

  it('the same by the keyboard: Enter on the item, Cancel in the window', async () => {
    render(<Area withOpener />)
    await openAt()
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(document.activeElement).toBe(item('Settings…'))
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
    fireEvent.click(document.activeElement!)
    await flush()
    press(within('dialog', 'Cancel'))
    await flush()
    expect(document.activeElement).toBe(button('Row'))
  })

  it('Tab closes the menu and gives the focus to the opener first, so the focus moves on from there', async () => {
    render(<Area withOpener />)
    await openAt()
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    await flush()
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(button('Row'))
  })

  it('a press outside closes it; the focus moved elsewhere closes it and stays there', async () => {
    render(<Area withOpener />)
    await openAt()
    press(document.body)
    await flush()
    expect(menu()).toBeNull()

    await openAt()
    act(() => button('Before').focus())
    await flush()
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(button('Before'))
  })

  it('closes when the window loses the focus', async () => {
    render(<Area />)
    await openAt()
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    await flush()
    expect(menu()).toBeNull()
  })

  it('stands at the point; at the edge of the window it moves inside the window', async () => {
    // jsdom lays nothing out: the window is 800×600, the menu 200×100.
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(800)
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(600)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.querySelector('[role="menu"]') !== null || this.getAttribute('role') === 'menu' ? 200 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.querySelector('[role="menu"]') !== null || this.getAttribute('role') === 'menu' ? 100 : 0
    })
    render(<Area />)
    const place = async (x: number, y: number) => {
      const opened = await openAt(x, y)
      await flush()
      const positioner = opened.parentElement!
      // Base UI places it by a transform from the top left of the window.
      const [left, top] = /translate\(([-\d.]+)px, ([-\d.]+)px\)/u.exec(positioner.style.transform)!.slice(1).map(Number)
      const at = { left: left!, top: top! }
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
      await flush()
      return at
    }
    // Room on every side: just right of and under the point.
    const middle = await place(100, 120)
    expect(middle.left).toBeGreaterThanOrEqual(100)
    expect(middle.left).toBeLessThanOrEqual(104)
    expect(middle.top).toBeGreaterThanOrEqual(120)
    expect(middle.top).toBeLessThanOrEqual(124)
    // At the right edge it slides left, inside the window; at the bottom it flips above the point.
    const corner = await place(790, 590)
    expect(corner.left + 200).toBeLessThanOrEqual(800 - 8)
    expect(corner.top + 100).toBeLessThanOrEqual(590)
    expect(corner.top).toBeGreaterThanOrEqual(0)
  })
})

/** A button inside the open dialog. */
function within(role: 'dialog', name: string): HTMLElement {
  return [...screen.getByRole(role).querySelectorAll<HTMLElement>('button')].find((each) => each.textContent === name)!
}

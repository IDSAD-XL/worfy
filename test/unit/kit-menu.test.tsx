// The kit's Menu (src/renderer/theme/kit/Menu.tsx, worfy-ui-kit ticket 11, ADR-0106), seen from
// outside: the roles and the name, the keys that move in it, what Esc does and to whom, where the
// focus goes, what closes it — a blur of the window, Tab, the wheel outside a menu of a Node — and
// the layer it is drawn on.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Menu, MenuCheckboxItem, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, type MenuProps } from '../../src/renderer/theme/kit/Menu'
import { insideNodePopup } from '../../src/renderer/theme/kit/layer'
import { LAYERS } from '../../src/renderer/theme/layers'
import { escapeBelongsToPopup, openLayers } from '../../src/renderer/theme/open-layers'

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

type Options = Partial<Omit<MenuProps, 'open' | 'onOpenChange' | 'trigger' | 'children' | 'label'>> & { onChoose?: (what: string) => void }

/** A Menu of the kit with three plain items, one of them inactive; its open state kept here as its users keep it. */
function Actions({ onChoose = () => undefined, ...options }: Options) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      label="Ticket actions"
      testId="menu"
      trigger={
        <button type="button" className="w-action" title="More actions">
          More
        </button>
      }
      {...options}
    >
      <MenuItem testId="item-run" onClick={() => onChoose('run')}>
        Run
      </MenuItem>
      <MenuItem disabled title="Nothing to stop" onClick={() => onChoose('stop')}>
        Stop
      </MenuItem>
      <MenuSeparator />
      <MenuItem onClick={() => onChoose('history')}>History</MenuItem>
    </Menu>
  )
}

const trigger = () => screen.getByRole('button', { name: 'More' })
const menu = () => screen.queryByRole('menu', { name: 'Ticket actions' })
const item = (name: string) => screen.getByRole('menuitem', { name })

async function openIt(): Promise<HTMLElement> {
  trigger().focus()
  fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
  await flush()
  return screen.getByRole('menu', { name: 'Ticket actions' })
}

afterEach(() => {
  cleanup()
})

describe('the kit Menu', () => {
  it('is a menu named by its label, with its items; the trigger says it opens a menu and whether it is open', async () => {
    render(<Actions />)
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(trigger().className).toBe('w-action')
    expect(trigger().title).toBe('More actions')
    expect(menu()).toBeNull()
    press(trigger())
    await flush()
    const opened = menu()!
    expect(opened.getAttribute('data-testid')).toBe('menu')
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('menuitem').map((each) => each.textContent)).toEqual(['Run', 'Stop', 'History'])
    expect(screen.getAllByRole('separator')).toHaveLength(1)
    expect(openLayers()).toContain(opened)
    // The inactive item stays, focusable, with its tooltip.
    expect(item('Stop').getAttribute('aria-disabled')).toBe('true')
    expect(item('Stop').getAttribute('title')).toBe('Nothing to stop')
  })

  it('ArrowDown on the trigger opens it on the first item; the arrows go round, Home and End go to the ends, a letter goes to its item', async () => {
    render(<Actions />)
    await openIt()
    expect(document.activeElement).toBe(item('Run'))
    fireEvent.keyDown(item('Run'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(item('Stop'))
    fireEvent.keyDown(item('Stop'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(item('History'))
    // Going round, Base UI moves the focus on the next frame.
    fireEvent.keyDown(item('History'), { key: 'ArrowDown' })
    await flush()
    expect(document.activeElement).toBe(item('Run'))
    fireEvent.keyDown(item('Run'), { key: 'ArrowUp' })
    await flush()
    expect(document.activeElement).toBe(item('History'))
    fireEvent.keyDown(item('History'), { key: 'Home' })
    expect(document.activeElement).toBe(item('Run'))
    fireEvent.keyDown(item('Run'), { key: 'End' })
    expect(document.activeElement).toBe(item('History'))
    fireEvent.keyDown(item('History'), { key: 's' })
    expect(document.activeElement).toBe(item('Stop'))
  })

  it('a press on the trigger opens it on the first item too, as every menu of worfy did before the kit; focusOnOpen names another', async () => {
    const { unmount } = render(<Actions />)
    press(trigger())
    await flush()
    expect(document.activeElement).toBe(item('Run'))
    unmount()
    render(<Actions focusOnOpen='[data-testid="item-run"] ~ [role="menuitem"]:not([aria-disabled="true"])' />)
    press(trigger())
    await flush()
    expect(document.activeElement).toBe(item('History'))
  })

  it('without loopFocus the arrows stop at the ends', async () => {
    render(<Actions loopFocus={false} />)
    await openIt()
    fireEvent.keyDown(item('Run'), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(item('Run'))
    fireEvent.keyDown(item('Run'), { key: 'End' })
    fireEvent.keyDown(item('History'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(item('History'))
  })

  it('choosing an item runs it, closes the menu and gives the focus back to the trigger; an inactive item does nothing', async () => {
    const onChoose = vi.fn()
    render(<Actions onChoose={onChoose} />)
    await openIt()
    press(item('Stop'))
    await flush()
    expect(onChoose).not.toHaveBeenCalled()
    expect(menu()).not.toBeNull()
    press(item('Run'))
    await flush()
    expect(onChoose).toHaveBeenCalledWith('run')
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('Esc closes only the menu, marked handled, out of reach of an ancestor with an Esc of its own; the focus goes back to the trigger', async () => {
    const panel = vi.fn()
    const heard = vi.fn()
    document.addEventListener('keydown', heard)
    try {
      render(
        <div
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key === 'Escape') panel()
          }}
        >
          <Actions />
        </div>,
      )
      await openIt()
      const esc = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      act(() => void item('Run').dispatchEvent(esc))
      await flush()
      expect(esc.defaultPrevented).toBe(true)
      expect(menu()).toBeNull()
      expect(panel).not.toHaveBeenCalled()
      expect(heard).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(trigger())
      // With the menu closed, Esc on the trigger is the ancestor's again.
      fireEvent.keyDown(trigger(), { key: 'Escape' })
      expect(panel).toHaveBeenCalledTimes(1)
    } finally {
      document.removeEventListener('keydown', heard)
    }
  })

  it('a field outside that keeps the focus learns that Esc belongs to the open menu', async () => {
    render(
      <>
        <textarea aria-label="Message" />
        <Actions />
      </>,
    )
    const field = screen.getByRole('textbox', { name: 'Message' })
    await openIt()
    expect(escapeBelongsToPopup(field)).toBe(true)
    fireEvent.keyDown(item('Run'), { key: 'Escape' })
    await flush()
    expect(escapeBelongsToPopup(field)).toBe(false)
  })

  it('Tab closes the menu and gives the focus to the trigger first, so the focus moves on from there', async () => {
    render(<Actions />)
    await openIt()
    fireEvent.keyDown(item('Run'), { key: 'Tab' })
    await flush()
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('a press outside closes it; a press on the trigger closes it too', async () => {
    render(<Actions />)
    await openIt()
    press(document.body)
    await flush()
    expect(menu()).toBeNull()
    await openIt()
    press(trigger())
    await flush()
    expect(menu()).toBeNull()
  })

  it('closes when the window loses the focus (a press inside a <webview>)', async () => {
    render(<Actions />)
    await openIt()
    act(() => void window.dispatchEvent(new Event('blur')))
    await flush()
    expect(menu()).toBeNull()
  })

  it('is modal={false}: no backdrop over the window, and a press outside reaches what it was meant for', async () => {
    const outside = vi.fn()
    render(
      <>
        <button type="button" onClick={outside}>
          Elsewhere
        </button>
        <Actions />
      </>,
    )
    await openIt()
    expect(document.querySelector('[role="presentation"][data-base-ui-inert]')).toBeNull()
    press(screen.getByRole('button', { name: 'Elsewhere' }))
    await flush()
    expect(outside).toHaveBeenCalledTimes(1)
    expect(menu()).toBeNull()
  })

  it('is drawn on the popover layer of the scale by default, over a dialog on the dialog-menu layer when asked', async () => {
    const { unmount } = render(<Actions />)
    const portal = (await openIt()).closest<HTMLElement>('[data-base-ui-portal], body > div')!
    expect(portal.style.zIndex).toBe(String(LAYERS.popover))
    expect(portal.style.position).toBe('relative')
    unmount()
    render(<Actions layer="dialogMenu" />)
    const over = (await openIt()).closest<HTMLElement>('body > div')!
    expect(over.style.zIndex).toBe(String(LAYERS.dialogMenu))
    expect(LAYERS.dialogMenu).toBeGreaterThan(LAYERS.dialog)
  })

  it('a menu of a Node carries the in-node mark; the wheel outside closes it, the wheel over it does not', async () => {
    const node = vi.fn()
    render(
      <div onClick={node}>
        <Actions inNode />
      </div>,
    )
    const opened = await openIt()
    expect(insideNodePopup(item('Run'))).toBe(true)
    expect(opened.className).toContain('nodrag')
    fireEvent.click(item('History'))
    // The click on the item does not reach the Node through React's tree.
    expect(node).not.toHaveBeenCalled()
    await openIt()
    fireEvent.wheel(menu()!)
    expect(menu()).not.toBeNull()
    fireEvent.wheel(document.body)
    await flush()
    expect(menu()).toBeNull()
  })

  it('a menu off the Canvas keeps open under the wheel', async () => {
    render(<Actions />)
    await openIt()
    fireEvent.wheel(document.body)
    await flush()
    expect(menu()).not.toBeNull()
  })
})

/** A menu with a checkbox item and a radio group, the state kept here as Modes keeps it. */
function Modes({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [eco, setEco] = useState(false)
  const [mode, setMode] = useState<string | null>('off')
  return (
    <Menu open={open} onOpenChange={setOpen} label="Modes" trigger={<button type="button">Modes</button>}>
      <MenuCheckboxItem checked={eco} onCheckedChange={setEco}>
        Eco mode
      </MenuCheckboxItem>
      <MenuRadioGroup heading="Auto-approval" value={mode} onValueChange={setMode}>
        <MenuRadioItem value="off">Off</MenuRadioItem>
        <MenuRadioItem value="on">On</MenuRadioItem>
      </MenuRadioGroup>
      {children}
    </Menu>
  )
}

describe('checkbox and radio items', () => {
  it('a menuitemcheckbox and a named group of menuitemradio; a choice shows in the open menu', async () => {
    render(<Modes />)
    fireEvent.click(screen.getByRole('button', { name: 'Modes' }))
    await flush()
    const eco = screen.getByRole('menuitemcheckbox', { name: 'Eco mode' })
    expect(eco.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('group', { name: 'Auto-approval' })).toBeTruthy()
    const off = screen.getByRole('menuitemradio', { name: 'Off' })
    const on = screen.getByRole('menuitemradio', { name: 'On' })
    expect([off.getAttribute('aria-checked'), on.getAttribute('aria-checked')]).toEqual(['true', 'false'])
    press(eco)
    press(on)
    await flush()
    expect(screen.getByRole('menu', { name: 'Modes' })).toBeTruthy()
    expect(eco.getAttribute('aria-checked')).toBe('true')
    expect([off.getAttribute('aria-checked'), on.getAttribute('aria-checked')]).toEqual(['false', 'true'])
  })
})

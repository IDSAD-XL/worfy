// The kit's Popover (src/renderer/theme/kit/Popover.tsx, worfy-ui-kit ticket 09, ADR-0106), seen from
// outside: its role and name, where the focus goes, what Esc does and to whom, what closes it and
// what does not — a blur of the window closes it, a press on the toasts does not — and the in-node
// mark of a popover of a Node on the Canvas.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Popover, type PopoverProps } from '../../src/renderer/theme/kit/Popover'
import { insideNodePopup } from '../../src/renderer/theme/kit/layer'
import { LAYERS } from '../../src/renderer/theme/layers'
import { openLayers } from '../../src/renderer/theme/open-layers'

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

type Options = Partial<Omit<PopoverProps, 'open' | 'onOpenChange' | 'trigger' | 'children'>>

/** A Popover of the kit with a button and a field in it, its open state kept here as its users keep it. */
function Trash(options: Options) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Trash"
      testId="popover"
      trigger={
        <button type="button" className="w-trash__button" title="Deleted Nodes of the last 3 days">
          Trash
        </button>
      }
      {...options}
    >
      <button type="button">Restore</button>
      <input aria-label="Search" />
    </Popover>
  )
}

const trigger = () => screen.getByRole('button', { name: 'Trash' })
const popover = () => screen.queryByRole('dialog', { name: 'Trash' })

async function openIt(): Promise<HTMLElement> {
  press(trigger())
  await flush()
  return screen.getByRole('dialog', { name: 'Trash' })
}

afterEach(() => {
  cleanup()
})

describe('the kit Popover', () => {
  it('is a dialog named by its label; the trigger says whether it is open', async () => {
    render(<Trash />)
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(trigger().getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger().className).toBe('w-trash__button')
    expect(trigger().title).toBe('Deleted Nodes of the last 3 days')
    expect(popover()).toBeNull()
    const dialog = await openIt()
    expect(dialog.getAttribute('data-testid')).toBe('popover')
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(openLayers()).toContain(dialog)
  })

  it('takes the focus in and gives it back to the trigger when it closes', async () => {
    render(<Trash />)
    trigger().focus()
    const dialog = await openIt()
    expect(dialog.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await flush()
    expect(popover()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('the trigger closes it again', async () => {
    render(<Trash />)
    await openIt()
    press(trigger())
    await flush()
    expect(popover()).toBeNull()
  })

  it('draws it on the layer of the scale, on the side asked for', async () => {
    render(<Trash side="top" />)
    const dialog = await openIt()
    const portal = dialog.closest<HTMLElement>('[style*="z-index"]')
    expect(portal?.style.zIndex).toBe(String(LAYERS.popover))
    expect(portal?.style.position).toBe('relative')
    expect(dialog.getAttribute('data-side')).toBe('top')
    expect(dialog.classList.contains('w-kit-popover')).toBe(true)
  })
})

describe('Esc in the kit Popover: one press, one action', () => {
  /** An element with its own Esc, as the rail panel of session/ProductSessionPanel.tsx has. */
  function Panel({ onEscape, children }: { onEscape: () => void; children: ReactNode }) {
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onEscape()
    }
    return (
      <div role="region" aria-label="Panel" onKeyDown={onKeyDown}>
        {children}
      </div>
    )
  }

  /** The Esc presses that reached the window, as the Canvas's and focus mode's listeners get them. */
  const reachedWindow: Event[] = []
  const onWindowKey = (event: Event) => {
    if ((event as globalThis.KeyboardEvent).key === 'Escape') reachedWindow.push(event)
  }
  beforeEach(() => {
    reachedWindow.length = 0
    window.addEventListener('keydown', onWindowKey)
  })
  afterEach(() => {
    window.removeEventListener('keydown', onWindowKey)
  })

  it('Esc in the popover closes only the popover and is marked handled; the next Esc is the panel\'s', async () => {
    const panelEscape = vi.fn()
    render(
      <Panel onEscape={panelEscape}>
        <Trash />
      </Panel>,
    )
    await openIt()
    const free = fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search' }), { key: 'Escape' })
    await flush()
    expect(free).toBe(false)
    expect(popover()).toBeNull()
    expect(panelEscape).not.toHaveBeenCalled()
    expect(reachedWindow).toHaveLength(0)
    fireEvent.keyDown(trigger(), { key: 'Escape' })
    expect(panelEscape).toHaveBeenCalledTimes(1)
  })

  it('Esc with the focus outside the popover closes it and goes no further than the document', async () => {
    render(<Trash />)
    await openIt()
    act(() => (document.activeElement as HTMLElement).blur())
    const pressed = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => {
      document.body.dispatchEvent(pressed)
    })
    await flush()
    expect(popover()).toBeNull()
    expect(pressed.defaultPrevented).toBe(true)
    expect(reachedWindow).toHaveLength(0)
  })
})

describe('what closes the kit Popover', () => {
  it('a blur of the window closes it', async () => {
    render(<Trash />)
    await openIt()
    await act(async () => {
      window.dispatchEvent(new Event('blur'))
    })
    await flush()
    expect(popover()).toBeNull()
  })

  it('a press on the toasts leaves it open; a press elsewhere closes it', async () => {
    render(
      <>
        <section className="w-toasts" aria-label="Notifications">
          <div className="w-toast">
            <button type="button">Dismiss</button>
          </div>
        </section>
        <div data-testid="elsewhere">Canvas</div>
        <Trash />
      </>,
    )
    await openIt()
    press(screen.getByRole('button', { name: 'Dismiss' }))
    await flush()
    expect(popover()).not.toBeNull()
    press(screen.getByTestId('elsewhere'))
    await flush()
    expect(popover()).toBeNull()
  })
})

describe('a kit Popover of a Node on the Canvas', () => {
  it('carries the React Flow classes and the in-node mark; a click inside does not reach the Node it was opened from', async () => {
    const nodeClick = vi.fn()
    render(
      // The Node's own click, as React Flow's node wrapper has it.
      <div className="react-flow__node" onClick={nodeClick} onDoubleClick={nodeClick}>
        <Trash inNode />
      </div>,
    )
    const dialog = await openIt()
    nodeClick.mockClear()
    for (const name of ['nodrag', 'nopan', 'nowheel']) expect(dialog.classList.contains(name)).toBe(true)
    const restore = screen.getByRole('button', { name: 'Restore' })
    expect(insideNodePopup(restore)).toBe(true)
    fireEvent.click(restore)
    fireEvent.doubleClick(restore)
    expect(nodeClick).not.toHaveBeenCalled()
  })

  it('a popover elsewhere carries no in-node mark', async () => {
    render(<Trash />)
    const dialog = await openIt()
    expect(dialog.classList.contains('nodrag')).toBe(false)
    expect(insideNodePopup(screen.getByRole('button', { name: 'Restore' }))).toBe(false)
  })
})

describe('a kit Popover without a trigger, and what its place may keep open (worfy-ui-kit ticket 10)', () => {
  /** A popover placed against a chip, opened by its place: What's new under the version chip. */
  function Anchored({ onDismiss }: { onDismiss?: PopoverProps['onDismiss'] }) {
    const [open, setOpen] = useState(true)
    const [chip, setChip] = useState<HTMLButtonElement | null>(null)
    return (
      <>
        <button type="button" ref={setChip}>
          Chip
        </button>
        <input aria-label="Search or run" />
        {chip !== null ? (
          <Popover open={open} onOpenChange={setOpen} label="What's new" anchor={chip} {...(onDismiss !== undefined ? { onDismiss } : {})}>
            <button type="button">Update</button>
          </Popover>
        ) : null}
      </>
    )
  }
  const shown = () => screen.queryByRole('dialog', { name: "What's new" })

  it('is placed against its anchor; a press on the anchor is not a press outside, a press elsewhere is', async () => {
    render(<Anchored />)
    await flush()
    expect(shown()).not.toBeNull()
    press(screen.getByRole('button', { name: 'Chip' }))
    await flush()
    expect(shown()).not.toBeNull()
    press(document.body)
    await flush()
    expect(shown()).toBeNull()
  })

  it('the focus going to anything else of the window closes it; the focus on its anchor does not', async () => {
    render(<Anchored />)
    await flush()
    act(() => screen.getByRole('button', { name: 'Chip' }).focus())
    await flush()
    expect(shown()).not.toBeNull()
    act(() => screen.getByRole('textbox', { name: 'Search or run' }).focus())
    await flush()
    expect(shown()).toBeNull()
  })

  it('onDismiss answering false keeps it open on a press outside, a blur of the window and the focus leaving; Esc closes it all the same', async () => {
    const onDismiss = vi.fn<(reason: string) => boolean>(() => false)
    render(<Anchored onDismiss={onDismiss} />)
    await flush()
    press(document.body)
    await act(async () => {
      window.dispatchEvent(new Event('blur'))
    })
    act(() => screen.getByRole('textbox', { name: 'Search or run' }).focus())
    await flush()
    expect(shown()).not.toBeNull()
    expect(onDismiss.mock.calls.map(([reason]) => reason)).toEqual(expect.arrayContaining(['outside-press', 'blur', 'focus-out']))
    act(() => {
      document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    await flush()
    expect(shown()).toBeNull()
  })
})

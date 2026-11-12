// The kit's PreviewCard (src/renderer/theme/kit/PreviewCard.tsx, worfy-ui-kit ticket 10, ADR-0106), seen
// from outside: the card opens when the pointer rests on its trigger and when the trigger takes the
// focus; it closes when the pointer leaves and on Esc, which goes no further. A card without a trigger
// is placed against a box on the screen and opened by its place alone.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreviewCard, type PreviewCardProps } from '../../src/renderer/theme/kit/PreviewCard'
import { LAYERS } from '../../src/renderer/theme/layers'
import { escapeBelongsToPopup, openLayers } from '../../src/renderer/theme/open-layers'

/** Lets Base UI's effects and timers run: the delays below are 10 ms. */
const flush = (ms = 40) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))

type Options = Partial<Omit<PreviewCardProps, 'open' | 'onOpenChange' | 'children' | 'label'>>

/** A hover card on a link, its open state kept here as its users keep it. */
function Card(options: Options) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <PreviewCard
        open={open}
        onOpenChange={setOpen}
        label="Comment"
        testId="card"
        delay={10}
        closeDelay={10}
        trigger={
          <a href="#quote" className="w-quote-link">
            the quote
          </a>
        }
        {...options}
      >
        <button type="button">Edit</button>
      </PreviewCard>
      <button type="button">Elsewhere</button>
    </>
  )
}

const trigger = () => screen.getByRole('link', { name: 'the quote' })
const card = () => screen.queryByRole('dialog', { name: 'Comment' })

/** The pointer coming onto an element, as a mouse brings it. */
function enter(element: Element): void {
  fireEvent.pointerEnter(element, { pointerType: 'mouse' })
  fireEvent.mouseEnter(element)
  fireEvent.mouseMove(element)
}

/** The pointer going off an element. */
function leave(element: Element): void {
  fireEvent.pointerLeave(element, { pointerType: 'mouse' })
  fireEvent.mouseLeave(element)
}

afterEach(() => {
  cleanup()
})

describe('the kit PreviewCard', () => {
  it('opens when the pointer rests on its trigger, as a dialog named by its label on the layer of the scale; it closes when the pointer leaves', async () => {
    render(<Card />)
    expect(card()).toBeNull()
    enter(trigger())
    await flush()
    const shown = card()
    expect(shown).not.toBeNull()
    expect(shown?.getAttribute('data-testid')).toBe('card')
    expect(openLayers()).toContain(shown)
    expect(shown?.closest<HTMLElement>('[style*="z-index"]')?.style.zIndex).toBe(String(LAYERS.popover))
    expect(trigger().className).toBe('w-quote-link')
    leave(trigger())
    await flush()
    expect(card()).toBeNull()
  })

  it('opens when its trigger takes the focus, and closes when the focus goes elsewhere', async () => {
    render(<Card />)
    act(() => trigger().focus())
    fireEvent.focus(trigger())
    await flush()
    expect(card()).not.toBeNull()
    act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus())
    fireEvent.blur(trigger(), { relatedTarget: screen.getByRole('button', { name: 'Elsewhere' }) })
    await flush()
    expect(card()).toBeNull()
  })

  it('Esc closes it and is marked handled: the window does not get the press', async () => {
    const reached: Event[] = []
    const onWindowKey = (event: Event) => {
      if ((event as KeyboardEvent).key === 'Escape') reached.push(event)
    }
    window.addEventListener('keydown', onWindowKey)
    try {
      render(<Card />)
      act(() => trigger().focus())
      fireEvent.focus(trigger())
      await flush()
      expect(card()).not.toBeNull()
      const free = fireEvent.keyDown(trigger(), { key: 'Escape' })
      await flush()
      expect(free).toBe(false)
      expect(card()).toBeNull()
      expect(reached).toHaveLength(0)
    } finally {
      window.removeEventListener('keydown', onWindowKey)
    }
  })

  it('without a trigger it is placed against a box on the screen and opened by its place; Esc on the page closes it', async () => {
    const box = { getBoundingClientRect: () => new DOMRect(40, 60, 120, 16) }
    function Anchored() {
      const [open, setOpen] = useState(true)
      return (
        <PreviewCard open={open} onOpenChange={setOpen} label="Comment" testId="card" anchor={box}>
          <button type="button">Edit</button>
        </PreviewCard>
      )
    }
    render(<Anchored />)
    await flush()
    expect(card()).not.toBeNull()
    act(() => {
      document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    await flush()
    expect(card()).toBeNull()
  })

  it('Esc pressed in the card closes only the card: an ancestor with its own Esc and the window do not get it', async () => {
    const reached: Event[] = []
    const onWindowKey = (event: Event) => {
      if ((event as KeyboardEvent).key === 'Escape') reached.push(event)
    }
    const panelEscape = vi.fn()
    function Panel({ children }: { children: ReactNode }) {
      const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') panelEscape()
      }
      return (
        <div role="region" aria-label="Panel" onKeyDown={onKeyDown}>
          {children}
        </div>
      )
    }
    window.addEventListener('keydown', onWindowKey)
    try {
      render(
        <Panel>
          <Card />
        </Panel>,
      )
      enter(trigger())
      await flush()
      const free = fireEvent.keyDown(screen.getByRole('button', { name: 'Edit' }), { key: 'Escape' })
      await flush()
      expect(free).toBe(false)
      expect(card()).toBeNull()
      expect(panelEscape).not.toHaveBeenCalled()
      expect(reached).toHaveLength(0)
    } finally {
      window.removeEventListener('keydown', onWindowKey)
    }
  })

  it('an Esc a control in the card takes for itself leaves the card open', async () => {
    render(
      <Card
        popupProps={{
          onKeyDown: (event) => {
            if (event.key === 'Escape') event.preventDefault()
          },
        }}
      />,
    )
    enter(trigger())
    await flush()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Edit' }), { key: 'Escape' })
    await flush()
    expect(card()).not.toBeNull()
  })

  it('without a trigger it is placed at the box it is given: from its left edge, next to it', async () => {
    const box = { getBoundingClientRect: () => new DOMRect(40, 60, 120, 16) }
    render(
      <PreviewCard open onOpenChange={() => {}} label="Comment" testId="card" anchor={box} sideOffset={8}>
        <button type="button">Edit</button>
      </PreviewCard>,
    )
    await flush()
    // From the box's left edge, 8 px under its bottom (60 + 16 + 8) — or 8 px over its top (60 - 8):
    // jsdom's window has no size, so Base UI may flip the card for want of room under the box.
    expect((card()?.parentElement as HTMLElement).style.transform).toMatch(/^translate\(40px, (84|52)px\)$/)
  })

  it('leaves an Esc pressed in a field outside it to that field: one press, one action', async () => {
    const field = document.createElement('textarea')
    document.body.append(field)
    try {
      render(<Card />)
      enter(trigger())
      await flush()
      expect(card()).not.toBeNull()
      // The chat's message field interrupting a running turn: it asks first, then takes the press.
      expect(escapeBelongsToPopup(field)).toBe(false)
      field.addEventListener('keydown', (event) => event.preventDefault())
      act(() => {
        field.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      })
      await flush()
      expect(card()).not.toBeNull()
    } finally {
      field.remove()
    }
  })

  it('a blur of the window closes it', async () => {
    render(<Card />)
    enter(trigger())
    await flush()
    expect(card()).not.toBeNull()
    await act(async () => {
      window.dispatchEvent(new Event('blur'))
    })
    await flush()
    expect(card()).toBeNull()
  })
})

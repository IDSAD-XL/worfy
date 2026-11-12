// The shared part of every kit popup (theme/kit/layer.ts, worfy-ui-kit ticket 03, ADR-0106): it closes
// on a blur of the window and on a switch of the view, marks a popup of a Node on the Canvas, keeps
// toasts clear of it, and takes Esc in React's phase, on the popup and on its trigger, so an ancestor
// with its own Esc never acts on the same press. Base UI 1.9.0 does the same from internal onKeyDown
// handlers of its own (ADR-0106, item 7); "the shared part alone" below shows the kit does not need
// them. Esc pressed elsewhere Base UI takes only on the document, after React. The popup here is
// a bare Base UI Popover with the shared part, as a kit wrapper will build it; the wrappers come in
// later tickets.
import { Popover } from '@base-ui/react/popover'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useCallback, useState, type KeyboardEvent, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { insideNodePopup, layerStyle, useKitLayer } from '../../src/renderer/theme/kit/layer'
import { LAYERS } from '../../src/renderer/theme/layers'

/** A pointer press as a browser sends it: pointerdown, mousedown, pointerup, mouseup, click. */
function press(element: Element): void {
  fireEvent.pointerDown(element, { button: 0, pointerType: 'mouse' })
  fireEvent.mouseDown(element, { button: 0 })
  fireEvent.pointerUp(element, { button: 0, pointerType: 'mouse' })
  fireEvent.mouseUp(element, { button: 0 })
  fireEvent.click(element, { button: 0 })
}

/** Lets Base UI's effects, timers and the observers of the shared part run. */
const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))

interface ProbeProps {
  /** The popup is drawn for a Node on the Canvas. */
  inNode?: boolean
  /** Whether opening moves the focus into the popup (Base UI's default) or leaves it where it is. */
  takeFocus?: boolean
}

/** A Popover as a kit wrapper builds it: Base UI for the behaviour, the shared part on the popup. */
function Probe({ inNode = false, takeFocus = true }: ProbeProps) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const layer = useKitLayer({ open, close, inNode })
  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal={false}>
      <Popover.Trigger {...layer.trigger} data-testid="trigger">
        Open
      </Popover.Trigger>
      <Popover.Portal style={layerStyle('popover')} data-testid="portal">
        <Popover.Positioner>
          <Popover.Popup {...layer.popup} initialFocus={takeFocus} aria-label="Probe" data-testid="popup">
            <input aria-label="Inside" data-testid="inside" />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

async function open(): Promise<HTMLElement> {
  press(screen.getByTestId('trigger'))
  await flush()
  return screen.getByTestId('popup')
}

const popupOpen = (): boolean => screen.queryByTestId('popup') !== null

afterEach(() => {
  cleanup()
})

describe('the shared part of a kit popup', () => {
  it('a blur of the window closes an open popup', async () => {
    render(<Probe />)
    await open()
    await act(async () => {
      window.dispatchEvent(new Event('blur'))
    })
    await flush()
    expect(popupOpen()).toBe(false)
  })

  it('a switch of the view closes an open popup; hiding something else does not', async () => {
    render(
      <main>
        <div className="w-shell__view" data-view="canvas" data-testid="canvas-view">
          <Probe />
        </div>
        <div className="w-shell__view" data-view="session" hidden data-testid="session-view" />
        <section data-testid="side-panel" />
      </main>,
    )
    await open()
    await act(async () => {
      screen.getByTestId('side-panel').hidden = true
    })
    await flush()
    expect(popupOpen()).toBe(true)
    await act(async () => {
      screen.getByTestId('canvas-view').hidden = true
      screen.getByTestId('session-view').hidden = false
    })
    await flush()
    expect(popupOpen()).toBe(false)
  })

  it('a popup of a Node carries nodrag, nopan and nowheel and the in-node mark; a press inside it is a press inside a Node popup', async () => {
    render(<Probe inNode />)
    const popup = await open()
    expect(popup.classList.contains('nodrag')).toBe(true)
    expect(popup.classList.contains('nopan')).toBe(true)
    expect(popup.classList.contains('nowheel')).toBe(true)
    expect(insideNodePopup(screen.getByTestId('inside'))).toBe(true)
    expect(insideNodePopup(popup)).toBe(true)
    expect(insideNodePopup(document.body)).toBe(false)
    expect(insideNodePopup(window)).toBe(false)
    expect(insideNodePopup(null)).toBe(false)
  })

  it('a popup elsewhere carries neither the Node classes nor the in-node mark', async () => {
    render(<Probe />)
    const popup = await open()
    expect(popup.classList.contains('nodrag')).toBe(false)
    expect(insideNodePopup(screen.getByTestId('inside'))).toBe(false)
  })

  it('toasts keep clear of an open popup', async () => {
    render(<Probe />)
    const popup = await open()
    expect(popup.hasAttribute('data-toast-keep-out')).toBe(true)
  })

  it('the layer of the scale sits on a positioned element, the portal', async () => {
    expect(layerStyle('popover')).toEqual({ position: 'relative', zIndex: LAYERS.popover })
    expect(layerStyle('dialogMenu')).toEqual({ position: 'relative', zIndex: LAYERS.dialogMenu })
    render(<Probe />)
    await open()
    const portal = screen.getByTestId('portal')
    expect(portal.style.position).toBe('relative')
    expect(portal.style.zIndex).toBe(String(LAYERS.popover))
  })
})

describe('Esc in a kit popup: one press, one action', () => {
  /** An element with its own Esc in onKeyDown, as session/ProductSessionPanel.tsx's rail panel has. */
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

  const reachedWindow: KeyboardEvent[] = []
  const onWindowKey = (event: Event) => {
    if ((event as unknown as KeyboardEvent).key === 'Escape') reachedWindow.push(event as unknown as KeyboardEvent)
  }
  beforeEach(() => {
    reachedWindow.length = 0
    window.addEventListener('keydown', onWindowKey)
  })
  afterEach(() => {
    window.removeEventListener('keydown', onWindowKey)
  })

  it('Esc in a popup inside an element with its own Esc closes only the popup', async () => {
    const panelEscape = vi.fn()
    render(
      <Panel onEscape={panelEscape}>
        <Probe />
      </Panel>,
    )
    await open()
    const free = fireEvent.keyDown(screen.getByTestId('inside'), { key: 'Escape' })
    await flush()
    expect(free).toBe(false)
    expect(popupOpen()).toBe(false)
    expect(panelEscape).not.toHaveBeenCalled()
    expect(reachedWindow).toHaveLength(0)
    // The next Esc, from the panel, is the panel's.
    fireEvent.keyDown(screen.getByTestId('trigger'), { key: 'Escape' })
    expect(panelEscape).toHaveBeenCalledTimes(1)
  })

  it('Esc on the trigger of an open popup inside an element with its own Esc closes only the popup', async () => {
    const panelEscape = vi.fn()
    render(
      <Panel onEscape={panelEscape}>
        <Probe takeFocus={false} />
      </Panel>,
    )
    await open()
    const trigger = screen.getByTestId('trigger')
    trigger.focus()
    expect(popupOpen()).toBe(true)
    const free = fireEvent.keyDown(trigger, { key: 'Escape' })
    await flush()
    expect(free).toBe(false)
    expect(popupOpen()).toBe(false)
    expect(panelEscape).not.toHaveBeenCalled()
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(panelEscape).toHaveBeenCalledTimes(1)
  })

  describe('the shared part alone, without Base UI, takes Esc in React: the panel never sees it', () => {
    // Base UI 1.9.0 also closes on Esc from onKeyDown handlers of its own popup and trigger (an
    // internal of useDismiss, ADR-0106, item 7); the rule of the kit holds without them.
    function Bare({ open, close }: { open: boolean; close: () => void }) {
      const layer = useKitLayer({ open, close })
      return (
        <>
          <button type="button" {...layer.trigger} data-testid="bare-trigger">
            Open
          </button>
          <div {...layer.popup} tabIndex={-1} data-testid="bare" />
        </>
      )
    }

    it.each(['bare', 'bare-trigger'])('Esc on %s closes the popup and stops there', (where) => {
      const panelEscape = vi.fn()
      const close = vi.fn()
      render(
        <Panel onEscape={panelEscape}>
          <Bare open close={close} />
        </Panel>,
      )
      const free = fireEvent.keyDown(screen.getByTestId(where), { key: 'Escape' })
      expect(free).toBe(false)
      expect(close).toHaveBeenCalledTimes(1)
      expect(panelEscape).not.toHaveBeenCalled()
      expect(reachedWindow).toHaveLength(0)
      fireEvent.keyDown(screen.getByTestId(where), { key: 'Enter' })
      expect(close).toHaveBeenCalledTimes(1)
    })

    it.each(['bare', 'bare-trigger'])('Esc on %s while an input method composes is left alone: the popup stays and the panel gets it', (where) => {
      const panelEscape = vi.fn()
      const close = vi.fn()
      render(
        <Panel onEscape={panelEscape}>
          <Bare open close={close} />
        </Panel>,
      )
      const free = fireEvent.keyDown(screen.getByTestId(where), { key: 'Escape', isComposing: true })
      expect(free).toBe(true)
      expect(close).not.toHaveBeenCalled()
      expect(panelEscape).toHaveBeenCalledTimes(1)
    })

    it('Esc on the trigger that something under the panel already took (preventDefault) leaves the popup open', () => {
      const panelEscape = vi.fn()
      const close = vi.fn()
      render(
        <Panel onEscape={panelEscape}>
          {/* Takes Esc in the capture phase, before the trigger's own handler. */}
          <div onKeyDownCapture={(event) => event.key === 'Escape' && event.preventDefault()}>
            <Bare open close={close} />
          </div>
        </Panel>,
      )
      fireEvent.keyDown(screen.getByTestId('bare-trigger'), { key: 'Escape' })
      expect(close).not.toHaveBeenCalled()
      // Not the trigger's press: it goes on, and the one who took it decides.
      expect(panelEscape).toHaveBeenCalledTimes(1)
    })

    it('Esc on the trigger of a closed popup is the ancestor\'s', () => {
      const panelEscape = vi.fn()
      const close = vi.fn()
      render(
        <Panel onEscape={panelEscape}>
          <Bare open={false} close={close} />
        </Panel>,
      )
      fireEvent.keyDown(screen.getByTestId('bare-trigger'), { key: 'Escape' })
      expect(close).not.toHaveBeenCalled()
      expect(panelEscape).toHaveBeenCalledTimes(1)
    })
  })

  it('Esc something inside the popup already took (preventDefault) leaves the popup open', async () => {
    render(<Probe />)
    await open()
    const inside = screen.getByTestId('inside')
    inside.addEventListener('keydown', (event) => event.preventDefault())
    fireEvent.keyDown(inside, { key: 'Escape' })
    await flush()
    expect(popupOpen()).toBe(true)
  })

  it('Esc while an input method composes leaves the popup open', async () => {
    render(<Probe />)
    await open()
    fireEvent.keyDown(screen.getByTestId('inside'), { key: 'Escape', isComposing: true })
    await flush()
    expect(popupOpen()).toBe(true)
  })
})

describe('the chat field keeps the focus while a kit popup is open', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(globalThis as { worfy?: WorfyBridge }).worfy = {
      invoke: (channel: string) => {
        if (channel === 'agent.commands') return Promise.resolve({ ok: true, value: { commands: [] } })
        return Promise.resolve({ ok: false, error: `no ${channel}` })
      },
      on: () => 1,
      off: () => undefined,
    } as unknown as WorfyBridge
  })
  afterEach(() => {
    delete (globalThis as { worfy?: WorfyBridge }).worfy
  })

  async function mount() {
    const { MessageInput } = await import('../../src/renderer/session/MessageInput')
    const interrupt = vi.fn()
    render(
      <>
        <Probe takeFocus={false} />
        <MessageInput sessionId="s" busy history={[]} recipient="Orchestrator" onSend={() => Promise.resolve(null)} onInterrupt={interrupt} />
      </>,
    )
    const field = screen.getByRole('textbox', { name: 'Message Orchestrator' })
    return { interrupt, field }
  }

  it('Esc in the field closes the popup and does not interrupt the turn; the next Esc interrupts it', async () => {
    const { interrupt, field } = await mount()
    await open()
    field.focus()
    await flush()
    expect(document.activeElement).toBe(field)
    expect(popupOpen()).toBe(true)
    // React sees the press before Base UI's listener on the document marks it: the field asks the
    // open-layers helper instead of reading defaultPrevented.
    fireEvent.keyDown(field, { key: 'Escape' })
    await flush()
    expect(interrupt).not.toHaveBeenCalled()
    expect(popupOpen()).toBe(false)
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(interrupt).toHaveBeenCalledTimes(1)
  })
})

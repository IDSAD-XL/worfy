// The mouse correction of Terminal Nodes under the Canvas zoom (src/renderer/canvas/nodes/terminal-mouse.ts):
// which terminal an event is corrected for, with two terminals on the page at zoom 50%.
import { afterEach, describe, expect, it } from 'vitest'
import { unscaleMouse } from '../../src/renderer/canvas/nodes/terminal-mouse'

/** The unscaled size of every screen here, in CSS pixels. */
const SCREEN = { width: 400, height: 200 }

interface FakeTerminal {
  /** An element inside the terminal's screen, where the pointer is "over" the terminal. */
  cell: HTMLElement
  stop: () => void
}

const cleanups: (() => void)[] = []

/** A terminal whose screen sits at `left, top` on the page, drawn at `scale`, and corrected from now on. */
function terminalAt(left: number, top: number, scale: number): FakeTerminal {
  const element = document.createElement('div')
  const screen = document.createElement('div')
  const cell = document.createElement('span')
  screen.append(cell)
  element.append(screen)
  document.body.append(element)
  Object.defineProperty(screen, 'offsetWidth', { value: SCREEN.width })
  Object.defineProperty(screen, 'offsetHeight', { value: SCREEN.height })
  const width = SCREEN.width * scale
  const height = SCREEN.height * scale
  screen.getBoundingClientRect = () => ({ left, top, x: left, y: top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) })
  const stop = unscaleMouse(element, screen)
  cleanups.push(() => {
    stop()
    element.remove()
  })
  return { cell, stop }
}

/** The positions the listeners after the correction see, as xterm.js's listener on the document does. */
function seen(): { type: string; x: number; y: number }[] {
  const events: { type: string; x: number; y: number }[] = []
  const record = (event: MouseEvent) => events.push({ type: event.type, x: event.clientX, y: event.clientY })
  for (const type of ['mousedown', 'mousemove', 'mouseup', 'wheel'] as const) document.addEventListener(type, record)
  cleanups.push(() => {
    for (const type of ['mousedown', 'mousemove', 'mouseup', 'wheel'] as const) document.removeEventListener(type, record)
  })
  return events
}

function fire(target: EventTarget, type: 'mousedown' | 'mousemove' | 'mouseup' | 'wheel', x: number, y: number, buttons: number): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons }))
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

describe('unscaleMouse', () => {
  it('moves the position over a terminal drawn at 50% to unscaled pixels from its screen corner', () => {
    const a = terminalAt(10, 20, 0.5)
    const events = seen()
    fire(a.cell, 'mousedown', 10 + 100, 20 + 50, 1)
    expect(events).toEqual([{ type: 'mousedown', x: 10 + 200, y: 20 + 100 }])
  })

  it('leaves events alone over a terminal at 100%, and events over no terminal', () => {
    const a = terminalAt(10, 20, 1)
    const events = seen()
    fire(a.cell, 'mousedown', 60, 70, 1)
    fire(a.cell, 'mouseup', 60, 70, 0)
    terminalAt(500, 20, 0.5)
    fire(document.body, 'mousemove', 30, 40, 0)
    expect(events.map(({ x, y }) => [x, y])).toEqual([
      [60, 70],
      [60, 70],
      [30, 40],
    ])
  })

  it('corrects every move and the release of a drag for the terminal where the press began, also over another terminal registered earlier', () => {
    // B registers first, so a listener per terminal would see the event before A's does; B sits
    // 60 px lower than A, so correcting for B gives another row than correcting for A.
    const b = terminalAt(300, 60, 0.5)
    const a = terminalAt(0, 0, 0.5)
    const events = seen()
    fire(a.cell, 'mousedown', 20, 70, 1)
    fire(b.cell, 'mousemove', 320, 70, 1)
    fire(b.cell, 'mouseup', 330, 70, 0)
    expect(events).toEqual([
      { type: 'mousedown', x: 40, y: 140 },
      { type: 'mousemove', x: 640, y: 140 },
      { type: 'mouseup', x: 660, y: 140 },
    ])
    // The press is over: the wheel over B is B's again (a wheel event does not end a press itself).
    fire(b.cell, 'wheel', 320, 70, 0)
    expect(events.at(-1)).toEqual({ type: 'wheel', x: 300 + 40, y: 60 + 20 })
  })

  it('a move with no button down ends a press whose release the window did not see', () => {
    const b = terminalAt(300, 60, 0.5)
    const a = terminalAt(0, 0, 0.5)
    const events = seen()
    fire(a.cell, 'mousedown', 20, 70, 1)
    // Let go outside the window: no mouseup. The next move comes with no button down.
    fire(b.cell, 'mousemove', 320, 70, 0)
    expect(events.at(-1)).toEqual({ type: 'mousemove', x: 300 + 40, y: 60 + 20 })
  })

  it('a new press ends the earlier one: the drag belongs to the terminal of the last press', () => {
    const b = terminalAt(300, 60, 0.5)
    const a = terminalAt(0, 0, 0.5)
    const events = seen()
    fire(a.cell, 'mousedown', 20, 70, 1)
    // A's release was missed; the next press is over B.
    fire(b.cell, 'mousedown', 320, 70, 1)
    fire(a.cell, 'mousemove', 20, 70, 1)
    expect(events.at(-1)).toEqual({ type: 'mousemove', x: 300 + (20 - 300) * 2, y: 60 + 20 })
  })

  it('a press that began outside every terminal is no terminal\'s: a move over a terminal is corrected for it', () => {
    const a = terminalAt(0, 0, 0.5)
    const events = seen()
    fire(document.body, 'mousedown', 500, 500, 1)
    fire(a.cell, 'mousemove', 20, 70, 1)
    expect(events.at(-1)).toEqual({ type: 'mousemove', x: 40, y: 140 })
  })

  it('a terminal that stops while its press lasts no longer owns the drag, and its events are left alone', () => {
    const b = terminalAt(300, 60, 0.5)
    const a = terminalAt(0, 0, 0.5)
    const events = seen()
    fire(a.cell, 'mousedown', 20, 70, 1)
    a.stop()
    fire(b.cell, 'mousemove', 320, 70, 1)
    expect(events.at(-1)).toEqual({ type: 'mousemove', x: 300 + 40, y: 60 + 20 })
    b.stop()
    fire(b.cell, 'mousemove', 320, 70, 1)
    expect(events.at(-1)).toEqual({ type: 'mousemove', x: 320, y: 70 })
  })
})

// The mouse position xterm.js reads, corrected for the zoom of the Canvas (TerminalNode.tsx).
//
// The Canvas draws its Nodes inside a CSS transform: scale(zoom). xterm.js takes the mouse position
// against the scaled box of its screen but divides by the unscaled cell size, so at a zoom other
// than 100% a click or a drag lands on other cells than the ones under the pointer. Each terminal
// registers its screen here, and the mouse events meant for it get clientX/clientY moved so that
// the distance from the screen's top left corner is in unscaled CSS pixels.
//
// Which terminal an event is meant for: while a press that began over a terminal lasts, every
// event of it — the moves and the release, wherever the pointer goes — belongs to that terminal
// (it is dragging a selection); otherwise the terminal under the pointer. One listener serves all
// terminals, so the press is decided once, not by whichever terminal listens first.

/** A terminal whose mouse events are corrected: its whole element, and xterm.js's screen inside it. */
interface Surface {
  element: HTMLElement
  screen: HTMLElement
}

/** The mouse events whose position xterm.js reads: selection, mouse reporting, links, the wheel. */
const MOUSE_EVENTS = ['mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu', 'auxclick', 'wheel'] as const

const surfaces = new Set<Surface>()

/** The terminal where the press in progress began, if one began over a terminal. */
let pressOwner: Surface | undefined

function surfaceUnder(target: EventTarget | null): Surface | undefined {
  if (!(target instanceof Node)) return undefined
  for (const surface of surfaces) if (surface.element.contains(target)) return surface
  return undefined
}

function onMouse(event: MouseEvent): void {
  const under = surfaceUnder(event.target)
  if (event.type === 'mousedown') {
    // A new press ends any earlier one whose release never came (let go outside the window).
    pressOwner = under
  } else if (event.type === 'mousemove' && event.buttons === 0) {
    // A move with no button down: the press ended where the window did not see it.
    pressOwner = undefined
  }
  const surface = pressOwner ?? under
  if (event.type === 'mouseup') pressOwner = undefined
  if (surface === undefined || !surface.element.isConnected) return
  const { screen } = surface
  const box = screen.getBoundingClientRect()
  const scaleX = screen.offsetWidth > 0 ? box.width / screen.offsetWidth : 1
  const scaleY = screen.offsetHeight > 0 ? box.height / screen.offsetHeight : 1
  if (Math.abs(scaleX - 1) < 0.001 && Math.abs(scaleY - 1) < 0.001) return
  // clientX and clientY are getters on MouseEvent.prototype; an own property shadows them for
  // every listener after this one.
  Object.defineProperty(event, 'clientX', { value: box.left + (event.clientX - box.left) / scaleX, configurable: true })
  Object.defineProperty(event, 'clientY', { value: box.top + (event.clientY - box.top) / scaleY, configurable: true })
}

/**
 * Corrects the mouse events of one terminal from now on, and answers the function that stops it.
 * Listens on window in the capture phase, ahead of every listener of xterm.js (on its element, and
 * on the document while a selection is dragged).
 */
export function unscaleMouse(element: HTMLElement, screen: HTMLElement): () => void {
  const surface: Surface = { element, screen }
  if (surfaces.size === 0) for (const type of MOUSE_EVENTS) window.addEventListener(type, onMouse, { capture: true, passive: true })
  surfaces.add(surface)
  return () => {
    if (!surfaces.delete(surface)) return
    if (pressOwner === surface) pressOwner = undefined
    if (surfaces.size === 0) for (const type of MOUSE_EVENTS) window.removeEventListener(type, onMouse, { capture: true })
  }
}

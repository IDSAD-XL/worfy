// Who gets a wheel over a Node: the Canvas or the Node's own content (worfy-week ticket 16).
//
// React Flow pans the Canvas with the wheel and zooms with a pinch (a wheel with ctrlKey on macOS)
// and with ⌘ + wheel, but leaves a wheel alone wherever its target is inside a `.nowheel` element.
// Several Nodes mark their content `.nowheel` so that it scrolls (HANDOFF, Note, Session) or so that
// xterm.js gets it (Terminal). Left at that, the content takes every wheel that crosses it, even
// with nothing to scroll (the Orchestrator's status block), and the Canvas cannot be moved over it.
//
// The rule: a Node takes the wheel for its content only once it is active — clicked, and still
// selected (Canvas.tsx). Until then the wheel moves the Canvas. A pinch and ⌘ + wheel always zoom
// the Canvas. An active Node whose `.nowheel` content has nothing to scroll hands the wheel to the
// Canvas too; an active Terminal keeps it always, since xterm.js turns it into keys for a program.
//
// `.nowheel` thus means "in an active Node, this area scrolls by itself". Overlays with `.nowheel`
// are not inside a Node, and the router leaves their wheel alone.
//
// The module names no DOM type: it reads the few members it needs, so the unit tests drive it with
// plain objects (test/unit/wheel-router.test.ts), as card-bridge.ts does.

/** Where a wheel goes: to the Canvas, to the content under the pointer, or on as it is. */
export type WheelRoute = 'canvas' | 'content' | 'pass'

/** The part of a DOM element the decision reads. */
export interface WheelElement {
  readonly classList: { contains(name: string): boolean }
  readonly parentElement: WheelElement | null
  readonly scrollHeight: number
  readonly clientHeight: number
  readonly scrollWidth: number
  readonly clientWidth: number
  getAttribute(name: string): string | null
}

/** The part of a wheel event the decision reads. */
export interface WheelInput {
  target: WheelElement | null
  ctrlKey: boolean
  metaKey: boolean
}

const NODE_CLASS = 'react-flow__node'
const NO_WHEEL_CLASS = 'nowheel'
const TERMINAL_CLASS = 'w-terminal'

const overflows = (element: WheelElement): boolean => element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth

/**
 * Decides where a wheel goes. `isActive` answers whether the Node element (`.react-flow__node`) the
 * wheel is over is the active Node.
 *
 * - not over a Node, or nothing between the target and the Node is `.nowheel` → pass (React Flow
 *   moves the Canvas, as before);
 * - a pinch (ctrlKey) or ⌘ + wheel (metaKey) → Canvas;
 * - the Node is not active → Canvas;
 * - an active Terminal → content;
 * - an active Node whose nearest `.nowheel` overflows → content, even at the end of its scroll;
 * - an active Node with nothing to scroll → Canvas.
 */
export function routeWheel(input: WheelInput, isActive: (node: WheelElement) => boolean): WheelRoute {
  let noWheel: WheelElement | undefined
  let terminal = false
  let node: WheelElement | undefined
  for (let element = input.target; element !== null; element = element.parentElement) {
    if (element.classList.contains(NODE_CLASS)) {
      node = element
      break
    }
    if (noWheel === undefined && element.classList.contains(NO_WHEEL_CLASS)) noWheel = element
    if (element.classList.contains(TERMINAL_CLASS)) terminal = true
  }
  if (node === undefined || noWheel === undefined) return 'pass'
  if (input.ctrlKey || input.metaKey) return 'canvas'
  if (!isActive(node)) return 'canvas'
  if (terminal) return 'content'
  return overflows(noWheel) ? 'content' : 'canvas'
}

/** The members of a wheel event the router reads and copies. */
interface WheelEventLike {
  readonly target: unknown
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly deltaX: number
  readonly deltaY: number
  readonly deltaZ: number
  readonly deltaMode: number
  readonly screenX: number
  readonly screenY: number
  readonly clientX: number
  readonly clientY: number
  preventDefault(): void
  stopPropagation(): void
}

/** The page's window, for its event classes. */
interface WheelWindow {
  MouseEvent: { prototype: object }
  WheelEvent: new (type: 'wheel', init: Record<string, number | boolean>) => unknown
}

/** The `.w-canvas` element the router listens on. */
export interface WheelRoot {
  addEventListener(type: 'wheel', listener: (event: WheelEventLike) => void, options: { capture: boolean; passive: boolean }): void
  removeEventListener(type: 'wheel', listener: (event: WheelEventLike) => void, options: { capture: boolean }): void
  querySelector(selector: string): { dispatchEvent(event: never): boolean } | null
  readonly ownerDocument: { readonly defaultView: unknown }
}

const isElement = (target: unknown): target is WheelElement =>
  typeof target === 'object' && target !== null && 'classList' in target && 'parentElement' in target && 'scrollHeight' in target

/** clientX / clientY as the browser set them: terminal-mouse.ts shadows them on events over a Terminal. */
function pointerOf(event: WheelEventLike, view: WheelWindow): { clientX: number; clientY: number } {
  const read = (name: 'clientX' | 'clientY'): number => {
    const getter = Object.getOwnPropertyDescriptor(view.MouseEvent.prototype, name)?.get
    return getter === undefined ? event[name] : (getter.call(event) as number)
  }
  return { clientX: read('clientX'), clientY: read('clientY') }
}

/**
 * Routes every wheel inside `root` (the `.w-canvas` element): listens in the capture phase, ahead
 * of xterm.js and of native scrolling. A wheel for the Canvas is stopped and sent again, with the
 * same deltas, modifiers and pointer, to React Flow's `.react-flow__renderer`, where no `.nowheel`
 * is on its way: React Flow then pans or zooms as for any wheel over the plane, at its own speed,
 * around the pointer, and saves the viewport when the move ends. Answers the function that stops
 * the routing.
 */
export function routeWheels(root: WheelRoot, isActive: (node: WheelElement) => boolean): () => void {
  const onWheel = (event: WheelEventLike): void => {
    const target = isElement(event.target) ? event.target : null
    if (routeWheel({ target, ctrlKey: event.ctrlKey, metaKey: event.metaKey }, isActive) !== 'canvas') return
    const renderer = root.querySelector('.react-flow__renderer')
    const view = root.ownerDocument.defaultView as WheelWindow | null
    if (renderer === null || view === null) return
    event.preventDefault()
    event.stopPropagation()
    const { clientX, clientY } = pointerOf(event, view)
    const copy = new view.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaZ: event.deltaZ,
      deltaMode: event.deltaMode,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    })
    renderer.dispatchEvent(copy as never)
  }
  root.addEventListener('wheel', onWheel, { capture: true, passive: false })
  return () => root.removeEventListener('wheel', onWheel, { capture: true })
}

// A stand-in for the browser's layout of a Session Node's header, which jsdom does not lay out
// (worfy-polish ticket 153, src/renderer/canvas/nodes/SessionNode.tsx): the header is `width` px wide;
// its kind icon, status chip, padding and gaps take FIXED px, every button in it BUTTON px (the «⋯»
// trigger MORE px), and its title at least the min-width the Node gives it. The ResizeObserver reports
// the header's width; its scrollWidth is what its content needs, at least its own width.
import { act } from '@testing-library/react'

export const FIXED = 140
export const BUTTON = 50
export const MORE = 20

const HEADER = 'session-node-header'

type Callback = (entries: { borderBoxSize: { inlineSize: number; blockSize: number }[] }[]) => void

const isHeader = (element: Element): element is HTMLElement => element instanceof HTMLElement && element.dataset.testid === HEADER

/** The width the header's buttons take: BUTTON each, the «⋯» trigger MORE. */
const buttonsWidth = (header: HTMLElement): number =>
  [...header.querySelectorAll('button')].reduce((sum, button) => sum + (button.dataset.testid === 'session-node-more' ? MORE : BUTTON), 0)

const titleOf = (header: HTMLElement): HTMLElement | null => header.querySelector<HTMLElement>('[data-testid="session-node-title"]')

export interface HeaderLayout {
  /** The header becomes `next` px wide, and the ResizeObserver says so. */
  resize(next: number): void
  /** The width the title gets in the header as drawn now. */
  titleWidth(): number
  restore(): void
}

/** Lays out every Session Node header `width` px wide until `restore`. */
export function installHeaderLayout(initial: number): HeaderLayout {
  let width = initial
  const observed = new Map<Element, Callback>()
  const globals = globalThis as { ResizeObserver?: unknown }
  const hadObserver = 'ResizeObserver' in globals
  const previous = globals.ResizeObserver
  globals.ResizeObserver = class {
    private readonly callback: Callback
    private readonly elements = new Set<Element>()
    constructor(callback: Callback) {
      this.callback = callback
    }
    observe(element: Element): void {
      this.elements.add(element)
      if (!isHeader(element)) return
      observed.set(element, this.callback)
      this.callback([{ borderBoxSize: [{ inlineSize: width, blockSize: 28 }] }])
    }
    unobserve(element: Element): void {
      this.elements.delete(element)
      observed.delete(element)
    }
    disconnect(): void {
      for (const element of this.elements) observed.delete(element)
      this.elements.clear()
    }
  }
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return isHeader(this) ? width : 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (!isHeader(this)) return 0
      const title = Number.parseFloat(titleOf(this)?.style.minWidth ?? '') || 0
      return Math.max(width, FIXED + title + buttonsWidth(this))
    },
  })
  return {
    resize(next) {
      width = next
      act(() => {
        for (const [, callback] of observed) callback([{ borderBoxSize: [{ inlineSize: width, blockSize: 28 }] }])
      })
    },
    titleWidth() {
      const header = document.querySelector<HTMLElement>(`[data-testid="${HEADER}"]`)
      return header === null ? 0 : width - FIXED - buttonsWidth(header)
    },
    restore() {
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
      delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth
      if (hadObserver) globals.ResizeObserver = previous
      else delete globals.ResizeObserver
    },
  }
}

/** The items of a menu, whatever their role (a plain item, or Keep's checkbox item), in order. */
export const menuItems = (menu: HTMLElement): HTMLElement[] => [...menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')]

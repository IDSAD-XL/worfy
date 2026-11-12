/**
 * Which layers are open over the page (worfy-ui-kit ticket 02). A layer is a dialog, a menu or the
 * list of a Select: it opens over what lies under it and takes a key press first, so Esc, the arrow
 * keys and the toasts' placement ask this helper before they act. It is the one place that knows the
 * roles; focus mode, the Canvas's Esc, the work-track panel, Run history, the toasts and the PR inbox
 * used to look for them each on their own. A Base UI popup that is still in the DOM but closing is no
 * longer a layer (ticket 03).
 */

/** The ARIA roles of a layer. */
export const LAYER_ROLES = ['dialog', 'menu', 'listbox'] as const

/** A CSS selector of every layer, open or not. */
export const LAYER_SELECTOR = LAYER_ROLES.map((role) => `[role="${role}"]`).join(', ')

/**
 * The mark of a popup of the kit (theme/kit/layer.ts, ADR-0106). Base UI takes Esc for such a popup
 * in its listener on the document, after every React handler of the page has run.
 */
export const KIT_POPUP_ATTRIBUTE = 'data-kit-popup'

/**
 * A Base UI popup that is closing: Base UI keeps it in the DOM while it animates out (`data-ending-style`)
 * and, kept mounted, after that (`data-closed`). It is no longer a layer.
 */
const CLOSING_SELECTOR = '[data-closed], [data-ending-style]'

/** Whether `element` is not inside a hidden subtree: the views of the shell stay mounted and hidden. */
function shown(element: Element): boolean {
  return element.closest('[hidden]') === null
}

/** Whether `element` is shown and not a popup on its way out. */
function open(element: Element): boolean {
  return shown(element) && !element.matches(CLOSING_SELECTOR)
}

/** Whether `element` is an open layer: a layer in the page, neither hidden, inside a hidden view nor closing. */
export function isOpenLayer(element: Element): boolean {
  return element.isConnected && element.matches(LAYER_SELECTOR) && open(element)
}

/** The open layers inside `root` — the whole page by default — in document order. */
export function openLayers(root: ParentNode = document): Element[] {
  return [...root.querySelectorAll(LAYER_SELECTOR)].filter(open)
}

/**
 * Whether Esc pressed in `field` belongs to an open popup of the kit, one `field` is not inside. A
 * field that keeps the focus while such a popup is open (the chat's message field) asks this before
 * its own Esc action: Base UI closes the popup on that same press, but only later, on the document,
 * so `defaultPrevented` is still false when React hands the press to the field (ADR-0106).
 */
export function escapeBelongsToPopup(field: Element): boolean {
  return [...document.querySelectorAll(`[${KIT_POPUP_ATTRIBUTE}]`)].some((popup) => open(popup) && !popup.contains(field))
}

/** The layer `target` (of a key press, say) lies in — itself or the nearest one around it — or null. */
export function layerOf(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest(LAYER_SELECTOR) : null
}

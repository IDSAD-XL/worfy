/**
 * Which layers are open over the page (worfy-ui-kit ticket 02). A layer is a dialog, a menu or the
 * list of a Select: it opens over what lies under it and takes a key press first, so Esc, the arrow
 * keys and the toasts' placement ask this helper before they act. It is the one place that knows the
 * roles; focus mode, the Canvas's Esc, the work-track panel, Run history, the toasts and the PR inbox
 * used to look for them each on their own.
 */

/** The ARIA roles of a layer. */
export const LAYER_ROLES = ['dialog', 'menu', 'listbox'] as const

/** A CSS selector of every layer, open or not. */
export const LAYER_SELECTOR = LAYER_ROLES.map((role) => `[role="${role}"]`).join(', ')

/** Whether `element` is not inside a hidden subtree: the views of the shell stay mounted and hidden. */
function shown(element: Element): boolean {
  return element.closest('[hidden]') === null
}

/** Whether `element` is an open layer: a layer in the page, neither hidden nor inside a hidden view. */
export function isOpenLayer(element: Element): boolean {
  return element.isConnected && element.matches(LAYER_SELECTOR) && shown(element)
}

/** The open layers inside `root` — the whole page by default — in document order. */
export function openLayers(root: ParentNode = document): Element[] {
  return [...root.querySelectorAll(LAYER_SELECTOR)].filter(shown)
}

/** The layer `target` (of a key press, say) lies in — itself or the nearest one around it — or null. */
export function layerOf(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest(LAYER_SELECTOR) : null
}

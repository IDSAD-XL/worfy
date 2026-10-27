// How focus mode (FocusMode.tsx) covers the rest of the main area, and what under its layer may
// still be drawn there (worfy-browser ticket 17).
//
// Normally what the layer covers is inert under an opaque layer. While a tile is see-through
// (focus-tile.ts), content under the layer must show through it and take input — a Browser's page,
// the <webview> of the Browser layer, which loads its page again if moved in the DOM. Then:
// - what the layer covers carries COVERED_ATTRIBUTE, and focus.css hides it all (visibility), but
//   the elements marked UNDER_FOCUS_ATTRIBUTE;
// - an element marked `shown` is drawn and takes input: it lies under a see-through tile;
// - an element marked `kept` stays rendered — a <webview> under `visibility: hidden` is told it is
//   hidden, and its screencast frames and captures stop — but is invisible (opacity) and inert;
// - everything else is inert (keepShownOnly), as without a see-through tile.
// Inert keeps the mouse, Tab and a screen reader out, not the script of a frame: a Card under the
// layer that focuses its own field takes the keyboard focus all the same (Chromium). Whatever the
// cover, the focus that lands under it goes back to the layer (keepFocusOutOfCover).

/** What focus mode puts on what its layer covers while a tile is see-through. */
export const COVERED_ATTRIBUTE = 'data-focus-covered'

/** On the element focus mode's layer is drawn in, while a tile is see-through: it takes the layer's background. */
export const SEE_THROUGH_SLOT = 'data-focus-see-through'

/** On an element under focus mode's layer that stays rendered: `shown` (in a see-through tile) or `kept`. */
export const UNDER_FOCUS_ATTRIBUTE = 'data-under-focus'

const SHOWN = `[${UNDER_FOCUS_ATTRIBUTE}="shown"]`

/** Whether `element` is under focus mode's cover, as the shell and focus mode ask it: neither takes the focus there. */
export function underFocusCover(element: Element): boolean {
  return element.closest(`[inert], [${COVERED_ATTRIBUTE}]`) !== null
}

/**
 * Makes everything in `root` inert but the elements marked `shown` and the chain of their ancestors
 * up to `root`: each element of that chain stays, and each of its children off the chain is inert.
 * Without a `shown` element, `root` itself is inert. Kept so as the DOM under `root` changes; an
 * element inert before is left as it is. Returns the function that takes it all back.
 */
export function keepShownOnly(root: Element): () => void {
  const ours = new Set<Element>()
  const apply = () => {
    const shown = new Set(root.querySelectorAll(SHOWN))
    const want = new Set<Element>()
    if (shown.size === 0) want.add(root)
    else {
      const chain = new Set<Element>([root])
      for (const element of shown) for (let at: Element | null = element; at !== null && at !== root; at = at.parentElement) chain.add(at)
      for (const element of chain) {
        if (shown.has(element)) continue
        for (const child of element.children) if (!chain.has(child)) want.add(child)
      }
    }
    for (const element of ours) {
      if (want.has(element)) continue
      element.removeAttribute('inert')
      ours.delete(element)
    }
    for (const element of want) {
      if (ours.has(element) || element.hasAttribute('inert')) continue
      element.setAttribute('inert', '')
      ours.add(element)
    }
  }
  apply()
  // Nodes added inside a part already inert (a Session's text streaming in) change nothing here,
  // unless they bring an element to show; a mark that changes always does.
  const shownIn = (nodes: NodeList) =>
    [...nodes].some((node) => node instanceof Element && (node.matches(SHOWN) || node.querySelector(SHOWN) !== null))
  const insideOurs = (target: Node) => [...ours].some((element) => element !== target && element.contains(target))
  const observer = new MutationObserver((records) => {
    if (records.every((record) => record.type === 'childList' && insideOurs(record.target) && !shownIn(record.addedNodes))) return
    apply()
  })
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: [UNDER_FOCUS_ATTRIBUTE] })
  return () => {
    observer.disconnect()
    for (const element of ours) element.removeAttribute('inert')
    ours.clear()
  }
}

/**
 * While focus mode's layer is open: the keyboard focus that lands under its cover — a Card's script
 * focusing its own field, inert or not — goes back to `layer`; in an element marked `shown` it stays.
 * The page learns of a focus that moves into a frame by the window's blur, after it has moved.
 */
export function keepFocusOutOfCover(layer: HTMLElement): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const check = () => {
    const active = document.activeElement
    if (active === null || layer.contains(active) || !underFocusCover(active) || active.closest(SHOWN) !== null) return
    layer.focus({ preventScroll: true })
  }
  const later = () => {
    clearTimeout(timer)
    timer = setTimeout(check, 0)
  }
  document.addEventListener('focusin', check, true)
  window.addEventListener('blur', later)
  return () => {
    clearTimeout(timer)
    document.removeEventListener('focusin', check, true)
    window.removeEventListener('blur', later)
  }
}

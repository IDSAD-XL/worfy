// Which view of a shell sets the size of its pty, and answers a colour query (TerminalNode.tsx).
//
// One shell can have two views at once: focus mode draws the Node in a tile while the Canvas keeps
// its own copy mounted under the layer (src/renderer/focus/FocusMode.tsx). The pty has one size:
// the view mounted last sets it, and when that view goes, the view mounted before it takes the
// size again. So leaving focus mode gives the shell back the size of the Canvas Node, and while
// focus mode is open a change of the Canvas Node's box does not take the size from the tile. The
// same view is the one that answers a colour query of the program: main tells views apart by window
// only, so two answers from one window would both reach the shell (worfy-windows ticket 68).

/** A mounted view of a shell, as the other views of the same shell see it. */
export interface ShellView {
  /** Fits the view to its Node and sends its size to the pty. */
  takeSize(): void
}

/** The mounted views of each shell, by key, in the order they were mounted. */
const views = new Map<string, ShellView[]>()

/**
 * Adds a mounted view of the shell `key`, and answers the function that removes it. Removing the
 * view that was mounted last makes the one before it take the size.
 */
export function addView(key: string, view: ShellView): () => void {
  views.set(key, [...(views.get(key) ?? []), view])
  return () => {
    const list = views.get(key) ?? []
    const wasLast = list.at(-1) === view
    const rest = list.filter((other) => other !== view)
    if (rest.length === 0) views.delete(key)
    else views.set(key, rest)
    if (wasLast) rest.at(-1)?.takeSize()
  }
}

/** Whether `view` sets the size of the pty of `key`: it is the view of that shell mounted last. */
export const isLastView = (key: string, view: ShellView): boolean => views.get(key)?.at(-1) === view

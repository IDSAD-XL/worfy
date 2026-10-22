// The window that draws the Live page of a Browser (ADR-0078 item 16, worfy-browser ticket 07): a
// Project may be open in several windows of this Machine, and its Layout is shared, but a Browser
// has one page — in the window where the user worked with it last. The other windows, and every
// Linked machine, show the frames of that page and send it their input (src/main/browser/screencast.ts).
//
// Plain functions of what happened, window by window:
// - `show` — a window shows the Project's Canvas. The first one is the owner; the others queue up.
// - `work` — the user worked with the Browser in a window: a click, a key or a scroll in its frames
//   (src/main/browser/live.ts sends it once that input has rested) or on its page. That window owns it.
// - `leave` — the window closed, or shows another Project: the window worked in most recently among
//   those left owns it, else the one that has shown the Project longest; none when no window is left.
// A Linked machine is never an owner: it has no CDP session and no cookies of the Project (ADR-0078,
// its consequences), so only windows of this Machine take part here.

/** A window of this Machine: the id of its web contents. */
export type WindowId = number

export type OwnerEvent = { kind: 'show'; window: WindowId } | { kind: 'work'; window: WindowId } | { kind: 'leave'; window: WindowId }

export interface Owners {
  /** The window that draws the page; null while no window shows the Project. */
  readonly owner: WindowId | null
  /** Every window that shows the Project: the one worked in most recently first, then the rest in the order they came. */
  readonly windows: readonly WindowId[]
}

export const NO_OWNER: Owners = { owner: null, windows: [] }

/** What `event` makes of `state`. */
export function nextOwners(state: Owners, event: OwnerEvent): Owners {
  const { window } = event
  const others = state.windows.filter((each) => each !== window)
  if (event.kind === 'show') {
    if (state.windows.includes(window)) return state
    return { owner: state.owner ?? window, windows: [...state.windows, window] }
  }
  if (event.kind === 'work') return { owner: window, windows: [window, ...others] }
  if (!state.windows.includes(window)) return state
  return { owner: state.owner === window ? (others[0] ?? null) : state.owner, windows: others }
}

/** The owner after `events`, from no window at all. */
export function ownerOf(events: readonly OwnerEvent[]): WindowId | null {
  return events.reduce(nextOwners, NO_OWNER).owner
}

/**
 * `state` brought up to the windows that show the Project now (`showing`, in the order they came):
 * a window gone from it leaves, a new one shows.
 */
export function ownersAmong(state: Owners, showing: readonly WindowId[]): Owners {
  let next = state
  for (const window of state.windows) if (!showing.includes(window)) next = nextOwners(next, { kind: 'leave', window })
  for (const window of showing) next = nextOwners(next, { kind: 'show', window })
  return next
}

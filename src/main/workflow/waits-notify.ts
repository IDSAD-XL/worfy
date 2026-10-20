// The notification of a Ticket that comes to wait for the owner (worfy-pipeline tickets 06 and 09;
// spec, owner's decisions 8 and of 2026-10-20, Q9-Q11). It follows the workflow model of every
// Project in worfy's list (the workflow hub, src/main/workflow/watch.ts), which is kept by watching
// the Ticket files: no gh, git or `bin/profile` runs while nothing changes. The Stage hub
// (src/main/workflow/stages.ts) asks those every minute, so the notes no longer follow it.
// A Ticket whose `waits` became `owner` gives one notification through NoteDisplay
// (src/main/notify.ts): the title `<epic> NN` and the Russian for "waits for you", the text its `Blocked reason:` or
// `<epic> NN — <title>`. One wait has one key (waitKey): the same wait seen again notifies nobody,
// a new `ticket block … --waits owner` writes a new key and notifies again. Only a transition worfy
// saw itself counts: the first model of a Project is its start, and what already waited then gives
// none. Other transitions (CI red, a failed review) are left to the board.
import type { Ticket, WorkflowDelta, WorkflowModel } from '../../shared/workflow/types'
import { MAX_INTERVAL_MS } from '../github/prs'
import type { TicketNote } from '../notify'
import type { WorkflowHub, WorkflowSubscriber } from './watch'

/** What of the workflow hub (src/main/ipc/workflow.ts, workflowHub) the notes follow. */
export type WaitsHub = Pick<WorkflowHub, 'open' | 'close'>

/** What of a Ticket a wait is read from. */
export type WaitingTicket = Pick<Ticket, 'epic' | 'num' | 'title' | 'state' | 'waits' | 'statusAt' | 'blockedReason'>

/** How often the list of Projects is read again for Projects that came or went. */
export const WAITS_TICK_MS = 60_000

const SUBSCRIBER_ID = 'waits-notify'

/** A Ticket's name in the notification: `<epic> NN`. */
const refOf = (ticket: { epic: string; num: number }): string => `${ticket.epic} ${String(ticket.num).padStart(2, '0')}`

/** A Status time with a time of day (`2026-10-17T09:41Z`), not a migrated Ticket's date alone. */
const TIMED = /T\d{2}:\d{2}/

/**
 * The key of one wait (Q11). A Status time with a time of day tells the waits apart: (Epic, NN,
 * time). A date alone, or no time, would give two waits of one day one key, so then the key is
 * (Epic, NN, the Status word, the Blocked reason): one notification per change of either.
 */
export const waitKey = (ticket: WaitingTicket): string => {
  const at = ticket.statusAt ?? null
  if (at !== null && TIMED.test(at)) return `${ticket.epic}\0${ticket.num}\0${at}`
  return `${ticket.epic}\0${ticket.num}\0\0${ticket.state}\0${ticket.blockedReason ?? ''}`
}

/** The text of a wait's notification (Q10): its Blocked reason, else `<epic> NN — <title>`. */
export const waitBody = (ticket: WaitingTicket): string => ticket.blockedReason ?? `${refOf(ticket)} — ${ticket.title}`

/** The notes of the waits for the owner, from the workflow model of each Project and its changes. */
export class WaitsNotices {
  /** Every wait seen, by Project root; a Project without an entry has had no start yet. */
  private readonly seen = new Map<string, Set<string>>()

  constructor(private readonly display: { show(note: TicketNote): void }) {}

  /**
   * Reads a model, or a change (only the Tickets that changed), of the Project followed as `root` (the spelling of the Project list,
   * which the window finds the Project by). The first read with Tickets or without an error is the
   * start; after it, only the Tickets in the read are looked at, so a change carries every Ticket
   * whose wait may have begun.
   */
  read(root: string, read: WorkflowModel | WorkflowDelta): void {
    // The model failed and names no Ticket: neither a start nor a change. The change that ends the
    // failure carries every Ticket (it is diffed against the empty model), so it can be the start.
    if (read.tickets.length === 0 && read.error !== null) return
    const seen = this.seen.get(root)
    const waiting = read.tickets.filter((ticket) => ticket.waits === 'owner')
    if (seen === undefined) {
      this.seen.set(root, new Set(waiting.map(waitKey)))
      return
    }
    for (const ticket of waiting) {
      const key = waitKey(ticket)
      if (seen.has(key)) continue
      seen.add(key)
      this.display.show({
        title: `${refOf(ticket)} is waiting for you`,
        body: waitBody(ticket),
        sessionId: null,
        projectRoot: root,
        ticket: { epic: ticket.epic, num: ticket.num },
      })
    }
  }

  /** A Project left the list: when it comes back, its first model is a start again. */
  forget(root: string): void {
    this.seen.delete(root)
  }
}

/**
 * Follows the workflow model of every Project of `projects()` (read again each `intervalMs` for
 * Projects that came or went) and shows the notes of the waits for the owner on `display` (a
 * NoteDisplay, so the focus rule and the 10 s of a Session's note hold for them too). A Project
 * whose model could not be read (Q9: the first read failed, the hub's open rejects) gives no notes
 * and is tried again after a pause that doubles from `intervalMs` up to MAX_INTERVAL_MS, as the PR
 * tracker's does. Answers the function that stops it; the app calls it on quit
 * (installNotifications's stop, on `will-quit`).
 */
export function installWaitsNotifications(
  hub: WaitsHub,
  projects: () => readonly { readonly path: string }[],
  display: { show(note: TicketNote): void },
  intervalMs = WAITS_TICK_MS,
  log: (message: string, error: unknown) => void = (message, error) => console.warn(message, error),
): () => void {
  const notices = new WaitsNotices(display)
  /**
   * The Projects followed, by root. Until the hub answers the open, a Project's changes wait in
   * `early`: they are read after the model, as changes of it. One the model already holds names
   * waits seen at the start, and gives nothing.
   */
  const followed = new Map<string, { early: WorkflowDelta[] | null }>()
  /** The Projects whose model could not be read: the pause in ticks, and the ticks still to wait. */
  const retries = new Map<string, { pause: number; left: number }>()
  const maxPause = Math.max(1, Math.ceil(MAX_INTERVAL_MS / intervalMs))
  let stopped = false

  const follow = (root: string): void => {
    const state: { early: WorkflowDelta[] | null } = { early: [] }
    followed.set(root, state)
    // The Project left the list (and maybe came back) meanwhile, or the notes stopped: no one's.
    const current = (): boolean => !stopped && followed.get(root) === state
    const subscriber: WorkflowSubscriber = {
      id: SUBSCRIBER_ID,
      send: (delta) => {
        if (!current()) return
        if (state.early !== null) state.early.push(delta)
        else notices.read(root, delta)
      },
    }
    hub.open(root, subscriber).then(
      (model) => {
        if (!current()) return
        const early = state.early ?? []
        state.early = null
        notices.read(root, model)
        for (const delta of early) notices.read(root, delta)
      },
      (error: unknown) => {
        if (!current()) return
        const pause = Math.min(maxPause, (retries.get(root)?.pause ?? 0.5) * 2)
        retries.set(root, { pause, left: pause })
        log(`[waits-notify] ${root}: the workflow model could not be read; tried again in ${Math.round((pause * intervalMs) / 1000)} s`, error)
        followed.delete(root)
        void hub.close(root, SUBSCRIBER_ID).catch(() => undefined)
      },
    )
  }

  const unfollow = (root: string): void => {
    followed.delete(root)
    notices.forget(root)
    void hub.close(root, SUBSCRIBER_ID).catch(() => undefined)
  }

  const tick = (): void => {
    if (stopped) return
    const roots = new Set(projects().map((project) => project.path))
    for (const root of [...retries.keys()]) if (!roots.has(root)) retries.delete(root)
    for (const root of roots) {
      if (followed.has(root)) continue
      const retry = retries.get(root)
      if (retry !== undefined && --retry.left > 0) continue
      follow(root)
    }
    for (const root of [...followed.keys()]) if (!roots.has(root)) unfollow(root)
  }

  tick()
  const timer = setInterval(tick, intervalMs)
  timer.unref?.()
  return () => {
    stopped = true
    clearInterval(timer)
    for (const root of [...followed.keys()]) unfollow(root)
  }
}

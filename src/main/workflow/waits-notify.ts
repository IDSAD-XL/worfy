// The notification of a Ticket that comes to wait for the owner (worfy-pipeline ticket 06; spec,
// owner's decision 8). It follows the Stage snapshots of every Project in worfy's list
// (src/main/workflow/stages.ts, the same computation the Pipeline board reads): a Ticket whose
// `waits` became `owner` gives one notification through NoteDisplay (src/main/notify.ts) — the
// title `<epic> NN ждёт тебя`, the text its `Blocked reason:` or the name of its Stage. One wait is
// the pair (Ticket, the time of its Status): the same wait seen again notifies nobody, a new
// `ticket block … --waits owner` writes a new time and notifies again. Only a transition worfy saw
// itself counts: the first snapshot of a Project is its start, and what already waited then gives
// none. Other transitions (CI red, a failed review) are left to the board.
import type { PipelineSnapshot } from '../../shared/ipc/pipeline'
import type { TicketNote } from '../notify'
import type { StageHub, StageSubscriber } from './stages'

/** What of the Stage hub (src/main/ipc/pipeline.ts, stageHub) the notes follow. */
export type WaitsHub = Pick<StageHub, 'open' | 'close'>

/** How often the list of Projects is read again for Projects that came or went. */
export const WAITS_TICK_MS = 60_000

const SUBSCRIBER_ID = 'waits-notify'

/** A Ticket's name in the notification: `<epic> NN`. */
const refOf = (ticket: { epic: string; num: number }): string => `${ticket.epic} ${String(ticket.num).padStart(2, '0')}`

/** The key of one wait: the Ticket and the time of its Status. */
const waitKey = (ticket: { epic: string; num: number; statusAt: string | null }): string => `${ticket.epic}\0${ticket.num}\0${ticket.statusAt ?? ''}`

/** The notes of the waits for the owner, from the Stage snapshots of each Project. */
export class WaitsNotices {
  /** Every wait seen, by Project root; a Project without an entry has had no start yet. */
  private readonly seen = new Map<string, Set<string>>()

  constructor(private readonly display: { show(note: TicketNote): void }) {}

  read(snapshot: PipelineSnapshot): void {
    // The workflow model failed and the snapshot names no Ticket: neither a start nor a change.
    if (snapshot.tickets.length === 0 && snapshot.error !== null) return
    const seen = this.seen.get(snapshot.root)
    const waiting = snapshot.tickets.filter((ticket) => ticket.waits === 'owner')
    if (seen === undefined) {
      this.seen.set(snapshot.root, new Set(waiting.map(waitKey)))
      return
    }
    for (const ticket of waiting) {
      const key = waitKey(ticket)
      if (seen.has(key)) continue
      seen.add(key)
      const note: TicketNote = {
        title: `${refOf(ticket)} ждёт тебя`,
        body: ticket.blocked?.reason ?? snapshot.pipeline[ticket.index]?.title ?? ticket.stage,
        sessionId: null,
        projectRoot: snapshot.root,
        ticket: { epic: ticket.epic, num: ticket.num },
      }
      this.display.show(note)
    }
  }

  /** A Project left the list: when it comes back, its first snapshot is a start again. */
  forget(root: string): void {
    this.seen.delete(root)
  }
}

/**
 * Follows the Stages of every Project of `projects()` (read again each `intervalMs` for Projects
 * that came or went) and shows the notes of the waits for the owner on `display` (a NoteDisplay,
 * so the focus rule and the 10 s of a Session's note hold for them too). Answers the
 * function that stops it; the app calls it on quit.
 */
export function installWaitsNotifications(
  hub: WaitsHub,
  projects: () => readonly { readonly path: string }[],
  display: { show(note: TicketNote): void },
  intervalMs = WAITS_TICK_MS,
  log: (message: string, error: unknown) => void = (message, error) => console.warn(message, error),
): () => void {
  const notices = new WaitsNotices(display)
  /** The Projects followed, by root; each subscriber knows whether its Project had a snapshot yet. */
  const followed = new Map<string, { got: boolean }>()
  let stopped = false

  const follow = (root: string): void => {
    const state = { got: false }
    followed.set(root, state)
    const read = (snapshot: PipelineSnapshot): void => {
      if (stopped || followed.get(root) !== state) return
      state.got = true
      notices.read(snapshot)
    }
    const subscriber: StageSubscriber = { id: SUBSCRIBER_ID, send: read }
    hub.open(root, subscriber).then(
      // A snapshot sent while main computed this answer is newer: the answer then changes nothing.
      (snapshot) => {
        if (!state.got) read(snapshot)
      },
      (error: unknown) => {
        log(`[waits-notify] ${root}: the Stages could not be read; tried again in a minute`, error)
        if (followed.get(root) !== state) return
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
    for (const root of roots) if (!followed.has(root)) follow(root)
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

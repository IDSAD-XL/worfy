// Notifications of macOS and Windows (ticket 21; worfy-windows ticket 11). On Windows they show
// only for the AppUserModelId src/main/index.ts sets before the first window (app-id.ts): the
// installed app's Start menu shortcut carries it, and a dev run needs electron.exe pinned to the
// Start menu. A notification goes out when a Session finished its turn or waits for a permission
// answer, and no worfy window has focus:
//
// - a Session worfy runs: its `result` (not one the user interrupted) and each `permission_request`,
//   seen through SessionRegistry.observe;
// - a Session from the registry under ~/.claude (a terminal, Claude desktop): its status going
//   from `busy` to `idle`, seen through the registry watchers the windows already run
//   (src/main/ipc/claude-home.ts, liveSessionListeners). The first sight of a Session is not a
//   transition.
//
// One Session sends at most one notification in NOTIFY_INTERVAL_MS. A click on a notification
// raises the window, leaves the note for its renderer to take (notify-pending.ts) and signals the
// renderer to take it now (`notify.open`). On macOS worfy lives on after its last window closed,
// and so do its Sessions: then the click opens a new window, whose renderer takes the note once
// its overlay mounts.
//
// Linked machines (worfy-link ticket 13): the Machine of a Project decides what to notify about, as
// above, and hands each note to two places — its own display, and the connected Linked machines it
// shares its Projects with (src/main/link/notes.ts). Its own focus does not hold the note back from
// them. Every Machine shows a note by its own rules (NoteDisplay): the focus of its own worfy
// window, and its own 10 s per Session, counted by Machine and Session. Nothing of that passes
// between Machines, and neither does the OS's Focus mode ("do not disturb"): each Machine shows the
// banner of its own OS, so its own Focus applies to it. worfy has no switch of its own for it. A
// click opens the Session on the Machine where it was made: that Machine's window rises and its
// renderer opens the Session of the other Machine (src/renderer/canvas/overlays/NotificationTarget.tsx);
// the Machine of the Project does nothing.
//
// The gate queue (worfy-windows ticket 17, ADR-0069): a PR with the cross-machine gate's label that
// has waited over an hour by rule 1 (src/main/github/gate-queue.ts) gets one notification per PR and
// last commit, on either machine (GateQueueNotices). Its title is the Project's name. Such a note
// names no Session: a click raises worfy's window and opens nothing (WindowNote). The focus rule is
// the same: while a worfy window has focus the note waits for the next read of the queue.
//
// A Ticket that comes to wait for the owner (worfy-pipeline tickets 06 and 09,
// src/main/workflow/waits-notify.ts; read from the workflow model, so it runs no gh, git or
// `bin/profile` of its own) gets one note of no Session, a TicketNote: shown by NoteDisplay's rules, counted by Project
// and Ticket. A click opens the Pipeline board of its Project. Whom it reaches (worfy-pipeline
// ticket 10, Q14 and Q15; TicketNotes): `Waits: owner` — this Machine and every Linked machine that
// may see its Projects and accepts the message (src/main/link/notes.ts); `Waits: <Machine name>` —
// only that Machine; `team` and `agent` — no one. The Machine of the Project decides; a Linked
// machine drops a note of a Project it has in its own list (the same repository, by the match key of
// src/main/autopilot/origin.ts): it notified of it itself. It shows the others with the sender's name,
// and a click opens the Pipeline board of that Project on that Machine.
//
// "Link a machine" paused (worfy-link ticket 28): when too many pairing attempts failed within an
// hour (src/main/link/pairing.ts), the link service pauses linking and this Machine shows one
// WindowNote: how many failed, from which addresses, until when, and that a restart of worfy lifts
// the pause (the count lives in main's memory; ADR-0070, Amendments). It shows whatever window has
// focus — a pause is a warning about the network, not a Session's news — and never names a code
// (ADR-0052, point 10). Linked machines are not told. src/main/index.ts follows the app's link
// (followAppLinkPauses).
//
// Notifier holds the rules and takes its Electron parts as NotifyDeps, so tests pass their own
// (test/unit/notify.test.ts, test/unit/link-notify.test.ts). macOS takes the name and the icon of
// a notification from the bundle of the process, so a Notification sets no icon of its own: `icon`
// would add a second picture, not replace the app's. The packaged .app shows "worfy"; `pnpm dev`
// on macOS runs a bundle named worfy with worfy's icon (scripts/dev-bundle.ts), and e2e runs show
// no system notification at all (quiet windows).
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { app, BrowserWindow, Notification } from 'electron'
import type { AgentEvent } from '../shared/agent/events'
import { readProjectMatchKey } from './autopilot/origin'
import type { LiveSession } from '../shared/ipc/claude-home'
import type { GateQueueRead } from './github/gate-queue'
import { notifyOpen } from '../shared/ipc/notify'
import type { SessionRegistry } from './agent/session'
import { emit } from './ipc/index'
import { workflowHub } from './ipc/workflow'
import { pendingOpens, type PendingOpens } from './notify-pending'
import { projectStore } from './projects/store'
import { quietWindows, type QuietWindows } from './quiet-windows'
import { createMainWindow } from './window'
import { installWaitsNotifications, type WaitsHub } from './workflow/waits-notify'

export const NOTIFY_INTERVAL_MS = 10_000

const BODY_LIMIT = 160

/** A notification as the Machine of its Session decides on it, and as it goes to Linked machines. */
export interface SharedNote {
  title: string
  body: string
  sessionId: string
  /** The Project root of a Session from the registry; null for a Session worfy runs. */
  projectRoot: string | null
}

/** One notification: what it says and which Session a click opens. */
export interface Note extends SharedNote {
  /** The Linked machine whose Session this is (worfy-link ticket 13); absent for a Session of this Machine. */
  machineId?: string
}

/**
 * A notification of no Session, of a Ticket that came to wait for the owner (worfy-pipeline ticket
 * 06, src/main/workflow/waits-notify.ts): a click opens the Pipeline board of its Project. Shown by
 * the rules of a Session's note, counted by Machine, Project and Ticket.
 */
export interface TicketNote {
  title: string
  body: string
  sessionId: null
  /** The root of a Project of this Machine; null for a Linked machine's Ticket. */
  projectRoot: string | null
  ticket: { epic: string; num: number }
  /** A Linked machine's Ticket (worfy-pipeline ticket 10): that Machine, and the id of its Project there. */
  machineId?: string
  projectId?: string
}

/** A Ticket of this Machine that came to wait (waits-notify.ts): who it waits for, and the key of the wait. */
export interface WaitNote extends TicketNote {
  projectRoot: string
  /** The `Waits:` line: owner, or a Machine name. */
  waits: string
  /** The key of the wait (waitKey). */
  wait: string
}

/** A Ticket's note as it goes to Linked machines (src/main/link/notes.ts, `ticket-note`): no local path. */
export interface SharedTicketNote {
  title: string
  body: string
  /** The sender's Project: its id, its name, and its match key (src/main/autopilot/origin.ts, projectMatchKey). */
  project: { id: string; name: string; match: string }
  epic: string
  num: number
  wait: string
}

/** Where the notes of this Machine's Tickets go besides its own display (src/main/link/notes.ts). */
export interface TicketLink {
  /** Sends a Ticket's note to the Linked machines `to` names, every one for 'all', of those that may get it. */
  sendTicket(note: SharedTicketNote, to: 'all' | readonly string[]): void
  /** Calls `handler` with each Ticket's note a Linked machine sends; answers the function that stops it. */
  receiveTicket(handler: (machineId: string, note: SharedTicketNote) => void): () => void
  /** This Machine's name (null before the link started) and the Linked machines', as Settings → Machines shows them. */
  machines(): { self: string | null; linked: readonly { id: string; name: string }[] }
}

/** What NoteDisplay shows: a Session's note, or a Ticket's. */
export type DisplayNote = Note | TicketNote

/** A notification of no Session (the gate queue): a click raises worfy's window and opens nothing. */
export interface WindowNote {
  title: string
  body: string
  sessionId: null
}

/** The Electron parts of the gate queue's notifications (GateQueueNotices); tests pass their own. */
export interface WindowNoteDeps {
  focused(): boolean
  show(note: WindowNote, onClick: () => void): void
  /** Raises worfy's window, or opens one; no Session opens. */
  open(note: WindowNote): void
}

/** Where the notes of this Machine's Sessions go besides its own display (src/main/link/notes.ts). */
export interface NoteLink {
  /** Hands a note this Machine decided on to the Linked machines that may see it. */
  send(note: SharedNote): void
  /** Calls `handler` with each note a Linked machine sends; answers the function that stops it. */
  receive(handler: (machineId: string, note: SharedNote) => void): () => void
}

/** The Electron parts of notifications, for notes of kind `N`; tests pass their own. */
export interface NotifyDeps<N extends DisplayNote = Note> {
  /** Whether a worfy window has focus now. */
  focused(): boolean
  /** Shows a system notification; `onClick` runs when the user clicks it. */
  show(note: N, onClick: () => void): void
  /** Raises the window and opens the Session of the note, or the Pipeline board of a Ticket's. */
  open(note: N): void
  now(): number
}

const clip = (text: string): string => {
  const line = text.trim().replace(/\s+/g, ' ')
  return line.length > BODY_LIMIT ? `${line.slice(0, BODY_LIMIT - 1)}…` : line
}

/** A request's input in one line: the command of Bash, the input as JSON otherwise. */
function inputLine(toolName: string, input: unknown): string {
  if (toolName === 'Bash' && typeof input === 'object' && input !== null) {
    const command = (input as Record<string, unknown>).command
    if (typeof command === 'string') return command
  }
  return JSON.stringify(input) ?? ''
}

/** The key of a Session in NoteDisplay: its Machine (empty for this one) and its id. */
const keyOf = (machineId: string | undefined, sessionId: string): string => `${machineId ?? ''}\0${sessionId}`

/** The key of a note in NoteDisplay: its Session's, or for a Ticket's note one no Session id can take. */
const noteKey = (note: DisplayNote): string =>
  note.sessionId === null
    ? `\0ticket\0${note.machineId ?? ''}\0${note.projectRoot ?? note.projectId ?? ''}\0${note.ticket.epic}\0${note.ticket.num}`
    : keyOf(note.machineId, note.sessionId)

/**
 * This Machine's rules for showing a note, whichever Machine decided on it: nothing while a worfy
 * window of this Machine has focus, and at most one notification per Session in
 * NOTIFY_INTERVAL_MS, counted by Machine and Session (a Ticket's note by Project and Ticket). A
 * note held back by focus is not counted.
 */
export class NoteDisplay<N extends DisplayNote = Note> {
  /** When each Session last showed a notification here, by keyOf. */
  private readonly last = new Map<string, number>()

  constructor(private readonly deps: NotifyDeps<N>) {}

  show(note: N): void {
    if (this.deps.focused()) return
    const now = this.deps.now()
    const key = noteKey(note)
    const last = this.last.get(key)
    if (last !== undefined && now - last < NOTIFY_INTERVAL_MS) return
    this.last.set(key, now)
    // A Linked machine's Sessions come and go without telling this one: forget what no longer counts.
    for (const [each, at] of this.last) if (now - at >= NOTIFY_INTERVAL_MS && each !== key) this.last.delete(each)
    this.deps.show(note, () => this.deps.open(note))
  }

  /** A Session of this Machine took its SDK id: its count goes with it. */
  rename(from: string, to: string): void {
    const last = this.last.get(keyOf(undefined, from))
    if (last !== undefined) this.last.set(keyOf(undefined, to), last)
    this.last.delete(keyOf(undefined, from))
  }

  /** A Session of this Machine closed. */
  forget(sessionId: string): void {
    this.last.delete(keyOf(undefined, sessionId))
  }
}

export class Notifier {
  /** Where this Machine shows notes. */
  private readonly display: NoteDisplay
  /** The cwd of each Session worfy runs, from its system/init: the notification's title. */
  private readonly cwds = new Map<string, string>()
  /** The last status of each Session from the registry, by `<projectRoot>\0<sessionId>`. */
  private readonly external = new Map<string, LiveSession['status']>()

  constructor(
    deps: NotifyDeps,
    /** The Linked machines that get this Machine's notes too; none when absent. */
    private readonly link?: Pick<NoteLink, 'send'>,
  ) {
    this.display = new NoteDisplay(deps)
  }

  /** A note a Linked machine decided on (src/main/link/notes.ts): shown here by this Machine's rules, sent nowhere. */
  received(machineId: string, note: SharedNote): void {
    this.display.show({ title: note.title, body: note.body, sessionId: note.sessionId, projectRoot: note.projectRoot, machineId })
  }

  /** One event of a Session worfy runs. */
  sessionEvent(sessionId: string, event: AgentEvent): void {
    switch (event.type) {
      case 'renamed':
        this.rename(event.from, sessionId)
        return
      case 'init':
        this.cwds.set(sessionId, event.cwd)
        return
      case 'result': {
        if (event.interrupted) return
        const said = event.isError ? event.error : event.text
        this.notify({ title: this.titleOf(sessionId), body: said !== null && said.trim() !== '' ? clip(said) : 'Finished its turn', sessionId, projectRoot: null })
        return
      }
      case 'permission_request':
        this.notify({
          title: this.titleOf(sessionId),
          body: clip(`Needs permission: ${event.toolName} ${inputLine(event.toolName, event.input)}`),
          sessionId,
          projectRoot: null,
        })
        return
      case 'state':
        if (event.state === 'closed') {
          this.cwds.delete(sessionId)
          this.display.forget(sessionId)
        }
        return
      default:
        return
    }
  }

  /** The live Sessions of a Project as the registry under ~/.claude lists them now. */
  externalSessions(projectRoot: string, live: readonly LiveSession[]): void {
    const seen = new Set<string>()
    for (const session of live) {
      const key = `${projectRoot}\0${session.sessionId}`
      seen.add(key)
      const before = this.external.get(key)
      this.external.set(key, session.status)
      if (before === 'busy' && session.status === 'idle') {
        this.notify({ title: session.name ?? basename(session.cwd), body: 'Finished its turn', sessionId: session.sessionId, projectRoot })
      }
    }
    for (const key of [...this.external.keys()]) {
      if (key.startsWith(`${projectRoot}\0`) && !seen.has(key)) this.external.delete(key)
    }
  }

  private titleOf(sessionId: string): string {
    const cwd = this.cwds.get(sessionId)
    return cwd === undefined ? 'Session' : basename(cwd)
  }

  private rename(from: string, to: string): void {
    this.display.rename(from, to)
    const cwd = this.cwds.get(from)
    if (cwd !== undefined && !this.cwds.has(to)) this.cwds.set(to, cwd)
    this.cwds.delete(from)
  }

  /** A note this Machine decided on: shown here by its own rules, and sent to the Linked machines whatever they are. */
  private notify(note: SharedNote): void {
    this.display.show(note)
    this.link?.send(note)
  }
}

/** Whom a Ticket's note reaches (Q15): this Machine or not, and which Linked machines ('all': each that may get it). */
export interface TicketRecipients {
  here: boolean
  linked: 'all' | string[]
}

/**
 * Whom the note of a Ticket with `Waits: <waits>` reaches (worfy-pipeline ticket 10, Q15): `owner` —
 * this Machine and every Linked machine; the name of this Machine — only here; the name of a Linked
 * machine — only that Machine; `team`, `agent` or a name no Machine has — no one. A name is compared
 * whole, as Settings → Machines shows it.
 */
export function ticketRecipients(waits: string, machines: ReturnType<TicketLink['machines']>): TicketRecipients {
  if (waits === 'owner') return { here: true, linked: 'all' }
  if (waits === 'team' || waits === 'agent') return { here: false, linked: [] }
  if (machines.self !== null && waits === machines.self) return { here: true, linked: [] }
  return { here: false, linked: machines.linked.filter((machine) => machine.name === waits).map((machine) => machine.id) }
}

/** A Project of worfy's list, as the notes of its Tickets name it. */
export interface ListedProject {
  readonly path: string
  readonly id?: string
  readonly name?: string
}

/** How many received waits a Machine remembers to show each once; the oldest go first. */
export const RECEIVED_LIMIT = 10_000

/** How long a Project's match key read with git is used before it is read again. */
export const MATCH_KEY_TTL_MS = 60_000

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

/**
 * The notes of the Tickets that wait (worfy-pipeline ticket 10): this Machine's go to its display
 * and to the Linked machines by ticketRecipients; a Linked machine's are shown here unless this
 * Machine has the same Project in its list (Q14) or showed that wait already.
 */
export class TicketNotes {
  /** The waits received and shown or dropped: sha256 of match key, Epic, NN and the key of the wait. */
  private readonly received = new Set<string>()
  /** The match key of each Project read with git, by root and id, with when it was read. */
  private readonly keys = new Map<string, { at: number; key: Promise<string> }>()

  constructor(
    private readonly display: { show(note: TicketNote): void },
    private readonly link: Partial<TicketLink> | undefined,
    private readonly projects: () => readonly ListedProject[],
    /** The match key of a Project (src/main/autopilot/origin.ts); read with git by default. */
    private readonly matchKey: (root: string, id: string) => Promise<string> = readProjectMatchKey,
    private readonly warn: (message: string, error: unknown) => void = (message, error) => console.warn(message, error),
    private readonly now: () => number = Date.now,
  ) {}

  private machines(): ReturnType<TicketLink['machines']> {
    return this.link?.machines?.() ?? { self: null, linked: [] }
  }

  /** A Project's match key: read with git at most once per MATCH_KEY_TTL_MS, so a changed origin is seen within it. */
  private keyOf(root: string, id: string): Promise<string> {
    const at = this.now()
    const cacheKey = `${root}\0${id}`
    const cached = this.keys.get(cacheKey)
    if (cached !== undefined && at - cached.at < MATCH_KEY_TTL_MS) return cached.key
    const key = this.matchKey(root, id)
    this.keys.set(cacheKey, { at, key })
    // A failed read (git timed out or failed, readProjectMatchKey rejects) is not kept: the next note reads again.
    key.catch(() => {
      if (this.keys.get(cacheKey)?.key === key) this.keys.delete(cacheKey)
    })
    return key
  }

  /**
   * A Ticket of this Machine came to wait: shown here and sent to the Linked machines by its
   * `Waits:`. Answers false when it cannot tell yet whom the wait is for — a Machine name while this
   * Machine has none (its link never started) and no Linked machine has it — so the wait is not
   * counted as seen and a later read of the Ticket decides again.
   */
  show(note: WaitNote): boolean {
    const machines = this.machines()
    const to = ticketRecipients(note.waits, machines)
    if (machines.self === null && note.waits !== 'owner' && note.waits !== 'team' && note.waits !== 'agent' && to.linked.length === 0) return false
    if (to.here) this.display.show(note)
    const link = this.link
    if (link?.sendTicket === undefined || (to.linked !== 'all' && to.linked.length === 0)) return true
    const project = this.projects().find((each) => each.path === note.projectRoot)
    if (project?.id === undefined) return true
    const { id, name } = project
    // Without its match key the note does not go to the Linked machines: a guessed key could make a
    // Machine with the same repository show it twice, or one with another drop it. Missing it is the
    // loss of a Machine that is not connected (ADR-0079); the Ticket's next wait reads the key again.
    this.keyOf(project.path, id).then(
      (match) =>
        // The texts are clipped as a Session's note is, and the wait goes as a hash: a long Blocked
        // reason (part of the key of a wait without a Status time) would put the note outside the schema.
        link.sendTicket?.(
          { title: clip(note.title), body: clip(note.body), project: { id, name: name ?? id, match }, epic: note.ticket.epic, num: note.ticket.num, wait: sha256(note.wait) },
          to.linked,
        ),
      (error: unknown) => this.warn(`[waits-notify] ${note.ticket.epic} ${note.ticket.num}: the note did not go to the Linked machines`, error),
    )
    return true
  }

  /**
   * A note of Linked machine `machineId`: shown here with that Machine's name, unless a Project of
   * this Machine's list has its match key, or the same wait came already (from it or another Machine).
   */
  async receive(machineId: string, note: SharedTicketNote): Promise<void> {
    const key = sha256(JSON.stringify([note.project.match, note.epic, note.num, note.wait]))
    // Marked before the wait for git below: the same note twice in a row is shown once.
    if (this.received.has(key)) return
    this.received.add(key)
    if (this.received.size > RECEIVED_LIMIT) this.received.delete(this.received.values().next().value as string)
    // A Project whose key could not be read matches nothing: a note is rather shown twice than lost.
    const own = await Promise.all(
      this.projects().map((project) => (project.id === undefined ? Promise.resolve(null) : this.keyOf(project.path, project.id).catch(() => null))),
    )
    if (own.includes(note.project.match)) return
    const name = this.machines().linked.find((machine) => machine.id === machineId)?.name ?? machineId
    this.display.show({
      title: `${note.title} (${name})`,
      body: note.body,
      sessionId: null,
      projectRoot: null,
      ticket: { epic: note.epic, num: note.num },
      machineId,
      projectId: note.project.id,
    })
  }
}

export const GATE_QUEUE_NOTICE_MS = 60 * 60_000
/**
 * How often the watcher asks the reader. The reader answers its last read until its own interval
 * (GATE_QUEUE_INTERVAL_MS) is over, so a tick as long as that interval would make the real period
 * up to twice it; a tick of one minute keeps it within a minute of the reader's.
 */
export const GATE_QUEUE_TICK_MS = 60_000
const PR_TITLE_LIMIT = 80

/** The text of the notification of a PR that waits in the gate queue, by this Machine's role. */
export function gateQueueNoteBody(pr: { number: number; title: string }, role: 'serve' | 'request'): string {
  const title = clip(pr.title)
  const short = title.length > PR_TITLE_LIMIT ? `${title.slice(0, PR_TITLE_LIMIT - 1)}…` : title
  const next = role === 'serve' ? 'Run Process gate queue' : 'No machine has taken it yet'
  return `PR #${pr.number} ${short} has waited for the gate queue for over an hour. ${next}`
}

/**
 * The gate queue's notifications: one per PR and last commit once it has waited over an hour by
 * rule 1, from the reads of the queue. While a worfy window has focus nothing is shown, and the PR
 * waits for the next read; a read that failed changes nothing.
 */
export class GateQueueNotices {
  /** What was shown, by `<root>\0<PR>\0<last commit>`. */
  private readonly shown = new Set<string>()

  constructor(private readonly deps: WindowNoteDeps) {}

  read(project: { root: string; name: string }, queue: GateQueueRead): void {
    if (queue.role === null || queue.gh.state !== 'ok') return
    const prefix = `${project.root}\0`
    const waiting = new Set<string>()
    for (const pr of queue.waiting) {
      const key = `${prefix}${pr.number}\0${pr.lastCommit ?? pr.since}`
      waiting.add(key)
      if (pr.waitedMs <= GATE_QUEUE_NOTICE_MS || this.shown.has(key) || this.deps.focused()) continue
      this.shown.add(key)
      const note: WindowNote = { title: project.name, body: gateQueueNoteBody(pr, queue.role), sessionId: null }
      this.deps.show(note, () => this.deps.open(note))
    }
    // A PR that no longer waits (a report, a merge, a new commit) is forgotten.
    for (const key of [...this.shown]) if (key.startsWith(prefix) && !waiting.has(key)) this.shown.delete(key)
  }
}

/**
 * Reads the gate queue of every Project in worfy's list each `intervalMs` (the reader itself runs
 * gh at most once per its interval) and notifies of the PRs that wait over an hour. Answers the
 * function that stops it; the app calls it on quit.
 */
export function installGateQueueNotifications(
  reader: { read(root: string): Promise<GateQueueRead> },
  projects: () => readonly { path: string; name: string }[],
  deps: WindowNoteDeps = electronWindowNoteDeps,
  intervalMs = GATE_QUEUE_TICK_MS,
): () => void {
  const notices = new GateQueueNotices(deps)
  let running = false
  const tick = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      for (const project of projects()) {
        try {
          notices.read({ root: project.path, name: project.name }, await reader.read(project.path))
        } catch (error) {
          console.warn(`[gate-queue] ${project.path}: the queue could not be read`, error)
        }
      }
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick(), intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}

/** What the link service tells of a pause (src/main/link/service.ts, 'pairing-paused'). */
export interface PairingPauseNews {
  failures: number
  addresses: readonly string[]
  until: number
}

const localTime = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** The text of the notification of a pause; there is no code to name in it. */
export function pairingPauseNoteBody(pause: PairingPauseNews, formatTime: (at: number) => string = localTime): string {
  const from = pause.addresses.length > 0 ? `, from ${pause.addresses.join(', ')}` : ''
  return `${pause.failures} failed attempts to link to this Machine within an hour${from}. "Link a machine" is paused until ${formatTime(pause.until)}. Restart worfy to link sooner.`
}

/** What installPairingPauseNotes listens to: a link service. */
export interface PairingPauseSource {
  on(event: 'pairing-paused', listener: (pause: PairingPauseNews) => void): unknown
  off(event: 'pairing-paused', listener: (pause: PairingPauseNews) => void): unknown
}

/** Shows one notification for each pause `service` announces; answers the function that stops it. */
export function installPairingPauseNotes(
  service: PairingPauseSource,
  deps: WindowNoteDeps = electronWindowNoteDeps,
  formatTime: (at: number) => string = localTime,
): () => void {
  const onPause = (pause: PairingPauseNews): void => {
    const note: WindowNote = { title: 'Link a machine is paused', body: pairingPauseNoteBody(pause, formatTime), sessionId: null }
    deps.show(note, () => deps.open(note))
  }
  service.on('pairing-paused', onPause)
  return () => void service.off('pairing-paused', onPause)
}

/**
 * Follows the app's link (src/main/link/service.ts, onAppLinkStart and appLinkService): the link
 * service running now, and each one that starts later, gets its pause notes, once. Answers the
 * function that stops it.
 */
export function followAppLinkPauses(
  onStart: (listener: () => void) => () => void,
  current: () => PairingPauseSource | undefined,
  install: (service: PairingPauseSource) => () => void = (service) => installPairingPauseNotes(service),
): () => void {
  let followed: PairingPauseSource | undefined
  let stopNotes: (() => void) | undefined
  const follow = (): void => {
    const service = current()
    if (service === followed) return
    stopNotes?.()
    followed = service
    stopNotes = service === undefined ? undefined : install(service)
  }
  const stopFollowing = onStart(follow)
  follow()
  return () => {
    stopFollowing()
    stopNotes?.()
  }
}

/** Notifications shown and not yet closed: a notification nobody holds may lose its click handler. */
const shown = new Set<Notification>()

/** Webcontents whose notes are dropped when they go away. */
const watched = new Set<number>()

/** Keeps the note for a window whose renderer is not there yet; forgotten with the window. */
function holdFor(window: BrowserWindow, note: DisplayNote, pending: PendingOpens): void {
  const contents = window.webContents
  const id = contents.id
  pending.hold(
    id,
    note.sessionId === null
      ? {
          view: 'pipeline',
          ...(note.projectRoot === null ? {} : { projectRoot: note.projectRoot }),
          ...(note.projectId === undefined ? {} : { projectId: note.projectId }),
          ...(note.machineId === undefined ? {} : { machineId: note.machineId }),
          epic: note.ticket.epic,
          num: note.ticket.num,
        }
      : { sessionId: note.sessionId, projectRoot: note.projectRoot, ...(note.machineId === undefined ? {} : { machineId: note.machineId }) },
  )
  if (watched.has(id)) return
  watched.add(id)
  contents.once('destroyed', () => {
    watched.delete(id)
    pending.drop(id)
  })
}

/**
 * Raises worfy and opens the Session of a clicked notification: in the open window, or in a new
 * one when none is open (macOS keeps the app running without windows). A note of a Linked
 * machine's Session keeps its Machine: the window's renderer opens it on that Machine. A Ticket's
 * note opens the Pipeline board of its Project the same way. A WindowNote only raises (or opens)
 * the window.
 */
export function openNote(
  note: DisplayNote | WindowNote,
  pending: PendingOpens = pendingOpens,
  createWindow: () => BrowserWindow = createMainWindow,
  quiet: QuietWindows = quietWindows(),
): void {
  const existing = BrowserWindow.getAllWindows().find((each) => !each.isDestroyed())
  // A new window shows itself once its page is ready (window.ts).
  const window = existing ?? createWindow()
  if (existing !== undefined) {
    if (window.isMinimized()) window.restore()
    // Quiet windows (e2e tests only): on screen, but worfy takes neither the front nor the keyboard.
    if (quiet.takesFocus) {
      window.show()
      window.focus()
    } else {
      window.showInactive()
    }
  }
  if (quiet.takesFocus) app.focus({ steal: true })
  // The note always waits in PendingOpens, and `notify.open` only tells a mounted overlay to take
  // it now. An overlay that is not mounted yet (a page still loading, or loaded but before the
  // Canvas) misses the signal and takes the note when it mounts. So the outcome does not depend on
  // webContents.isLoading(), which is also true while a Card iframe loads.
  if (note.sessionId === null && !('ticket' in note)) return
  holdFor(window, note, pending)
  if (existing !== undefined) emit(window.webContents, notifyOpen, {})
}

/** Shows a system notification of `note`; `onClick` runs when the user clicks it. */
function showSystem(note: { title: string; body: string }, onClick: () => void): void {
  // Quiet windows (e2e tests only) never have the focus: without this, every finished turn of a
  // test would put a banner on the screen.
  if (!quietWindows().systemNotifications) return
  if (!Notification.isSupported()) return
  const notification = new Notification({ title: note.title, body: note.body })
  shown.add(notification)
  notification.on('click', () => {
    shown.delete(notification)
    onClick()
  })
  notification.on('close', () => shown.delete(notification))
  notification.show()
}

/** Electron's notifications and windows. */
export const electronNotifyDeps: NotifyDeps<DisplayNote> = {
  focused: () => BrowserWindow.getFocusedWindow() !== null,
  show: showSystem,
  open: (note) => openNote(note),
  now: () => Date.now(),
}

/** The same for the gate queue's notifications. */
export const electronWindowNoteDeps: WindowNoteDeps = {
  focused: () => BrowserWindow.getFocusedWindow() !== null,
  show: showSystem,
  open: (note) => openNote(note),
}

/** Where the notes of the Tickets that wait for the owner come from: a workflow hub and a Project list. */
export interface WaitsSources {
  hub: WaitsHub
  projects: () => readonly ListedProject[]
  /** The match key of a Project (src/main/autopilot/origin.ts); read with git by default. */
  matchKey?: (root: string, id: string) => Promise<string>
}

/**
 * The app's sources of those notes (src/main/index.ts passes them to installNotifications): the
 * workflow hub, which watches the Ticket files, and worfy's Project list. Never the Stage hub
 * (src/main/ipc/pipeline.ts): it runs `bin/profile`, git and gh every minute for each Project it
 * follows (worfy-pipeline ticket 09).
 */
export function appWaitsSources(): WaitsSources {
  return { hub: workflowHub, projects: () => projectStore().list() }
}

/**
 * Starts notifications for the app: every Session of `registry`, and the registry watchers the
 * windows run; with `link`, the notes go to the Linked machines too and theirs are shown here;
 * with `waits`, the Tickets of the listed Projects that come to wait for the owner or a Machine
 * (src/main/workflow/waits-notify.ts), and with both, the Tickets' notes of the Linked machines
 * too (TicketNotes). Answers the function that stops them.
 */
export function installNotifications(
  registry: Pick<SessionRegistry, 'observe'>,
  liveSessions: Set<(projectRoot: string, live: readonly LiveSession[]) => void>,
  deps: NotifyDeps = electronNotifyDeps,
  link?: NoteLink & Partial<TicketLink>,
  /** The workflow hub and the Project list; `deps` shows and opens the Tickets' notes, Electron's by default. */
  waits?: WaitsSources & { deps?: NotifyDeps<TicketNote> },
): () => void {
  let stopWaits: (() => void) | undefined
  let stopTickets: (() => void) | undefined
  if (waits !== undefined) {
    const tickets = new TicketNotes(new NoteDisplay<TicketNote>(waits.deps ?? electronNotifyDeps), link, waits.projects, waits.matchKey)
    stopWaits = installWaitsNotifications(waits.hub, waits.projects, tickets)
    stopTickets = link?.receiveTicket?.((machineId, note) => void tickets.receive(machineId, note))
  }
  const notifier = new Notifier(deps, link)
  const stop = registry.observe((sessionId, event) => notifier.sessionEvent(sessionId, event))
  const onLive = (projectRoot: string, live: readonly LiveSession[]) => notifier.externalSessions(projectRoot, live)
  liveSessions.add(onLive)
  const stopReceiving = link?.receive((machineId, note) => notifier.received(machineId, note))
  return () => {
    stop()
    liveSessions.delete(onLive)
    stopReceiving?.()
    stopTickets?.()
    stopWaits?.()
  }
}

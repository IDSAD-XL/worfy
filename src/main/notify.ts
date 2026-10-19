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
// `bin/profile` of its own) gets one note of no Session, a TicketNote: shown here by NoteDisplay's rules, counted by Project
// and Ticket, and not sent to the Linked machines. A click opens the Pipeline board of its Project.
//
// Notifier holds the rules and takes its Electron parts as NotifyDeps, so tests pass their own
// (test/unit/notify.test.ts, test/unit/link-notify.test.ts). macOS takes the name and the icon of
// a notification from the bundle of the process, so a Notification sets no icon of its own: `icon`
// would add a second picture, not replace the app's. The packaged .app shows "worfy"; `pnpm dev`
// on macOS runs a bundle named worfy with worfy's icon (scripts/dev-bundle.ts), and e2e runs show
// no system notification at all (quiet windows).
import { basename } from 'node:path'
import { app, BrowserWindow, Notification } from 'electron'
import type { AgentEvent } from '../shared/agent/events'
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
 * A notification of no Session, of a Ticket of this Machine that came to wait for the owner
 * (worfy-pipeline ticket 06, src/main/workflow/waits-notify.ts): a click opens the Pipeline board
 * of its Project. Shown by the rules of a Session's note, counted by Project and Ticket.
 */
export interface TicketNote {
  title: string
  body: string
  sessionId: null
  projectRoot: string
  ticket: { epic: string; num: number }
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
  note.sessionId === null ? `\0ticket\0${note.projectRoot}\0${note.ticket.epic}\0${note.ticket.num}` : keyOf(note.machineId, note.sessionId)

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
      ? { view: 'pipeline', projectRoot: note.projectRoot, epic: note.ticket.epic, num: note.ticket.num }
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
  projects: () => readonly { readonly path: string }[]
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
 * with `waits`, the Tickets of the listed Projects that come to wait for the owner
 * (src/main/workflow/waits-notify.ts). Answers the function that stops them.
 */
export function installNotifications(
  registry: Pick<SessionRegistry, 'observe'>,
  liveSessions: Set<(projectRoot: string, live: readonly LiveSession[]) => void>,
  deps: NotifyDeps = electronNotifyDeps,
  link?: NoteLink,
  /** The workflow hub and the Project list; `deps` shows and opens the Tickets' notes, Electron's by default. */
  waits?: WaitsSources & { deps?: NotifyDeps<TicketNote> },
): () => void {
  const stopWaits = waits === undefined ? undefined : installWaitsNotifications(waits.hub, waits.projects, new NoteDisplay<TicketNote>(waits.deps ?? electronNotifyDeps))
  const notifier = new Notifier(deps, link)
  const stop = registry.observe((sessionId, event) => notifier.sessionEvent(sessionId, event))
  const onLive = (projectRoot: string, live: readonly LiveSession[]) => notifier.externalSessions(projectRoot, live)
  liveSessions.add(onLive)
  const stopReceiving = link?.receive((machineId, note) => notifier.received(machineId, note))
  return () => {
    stop()
    liveSessions.delete(onLive)
    stopReceiving?.()
    stopWaits?.()
  }
}

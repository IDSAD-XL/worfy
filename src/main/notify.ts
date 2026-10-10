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
// Notifier holds the rules and takes its Electron parts as NotifyDeps, so tests pass their own
// (test/unit/notify.test.ts, test/unit/link-notify.test.ts). An unsigned build from `pnpm dev` may show "Electron" or nothing
// (spec, risk 9); the packaged .app shows "worfy".
import { basename } from 'node:path'
import { app, BrowserWindow, Notification } from 'electron'
import type { AgentEvent } from '../shared/agent/events'
import type { LiveSession } from '../shared/ipc/claude-home'
import { notifyOpen } from '../shared/ipc/notify'
import type { SessionRegistry } from './agent/session'
import { emit } from './ipc/index'
import { pendingOpens, type PendingOpens } from './notify-pending'
import { createMainWindow } from './window'

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

/** Where the notes of this Machine's Sessions go besides its own display (src/main/link/notes.ts). */
export interface NoteLink {
  /** Hands a note this Machine decided on to the Linked machines that may see it. */
  send(note: SharedNote): void
  /** Calls `handler` with each note a Linked machine sends; answers the function that stops it. */
  receive(handler: (machineId: string, note: SharedNote) => void): () => void
}

/** The Electron parts of notifications; tests pass their own. */
export interface NotifyDeps {
  /** Whether a worfy window has focus now. */
  focused(): boolean
  /** Shows a system notification; `onClick` runs when the user clicks it. */
  show(note: Note, onClick: () => void): void
  /** Raises the window and opens the Session of the note. */
  open(note: Note): void
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

/**
 * This Machine's rules for showing a note, whichever Machine decided on it: nothing while a worfy
 * window of this Machine has focus, and at most one notification per Session in
 * NOTIFY_INTERVAL_MS, counted by Machine and Session. A note held back by focus is not counted.
 */
export class NoteDisplay {
  /** When each Session last showed a notification here, by keyOf. */
  private readonly last = new Map<string, number>()

  constructor(private readonly deps: NotifyDeps) {}

  show(note: Note): void {
    if (this.deps.focused()) return
    const now = this.deps.now()
    const key = keyOf(note.machineId, note.sessionId)
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

/** Notifications shown and not yet closed: a notification nobody holds may lose its click handler. */
const shown = new Set<Notification>()

/** Webcontents whose notes are dropped when they go away. */
const watched = new Set<number>()

/** Keeps the note for a window whose renderer is not there yet; forgotten with the window. */
function holdFor(window: BrowserWindow, note: Note, pending: PendingOpens): void {
  const contents = window.webContents
  const id = contents.id
  pending.hold(id, { sessionId: note.sessionId, projectRoot: note.projectRoot, ...(note.machineId === undefined ? {} : { machineId: note.machineId }) })
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
 * machine's Session keeps its Machine: the window's renderer opens it on that Machine.
 */
export function openNote(note: Note, pending: PendingOpens = pendingOpens, createWindow: () => BrowserWindow = createMainWindow): void {
  const existing = BrowserWindow.getAllWindows().find((each) => !each.isDestroyed())
  // A new window shows itself once its page is ready (window.ts).
  const window = existing ?? createWindow()
  if (existing !== undefined) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
  app.focus({ steal: true })
  // The note always waits in PendingOpens, and `notify.open` only tells a mounted overlay to take
  // it now. An overlay that is not mounted yet (a page still loading, or loaded but before the
  // Canvas) misses the signal and takes the note when it mounts. So the outcome does not depend on
  // webContents.isLoading(), which is also true while a Card iframe loads.
  holdFor(window, note, pending)
  if (existing !== undefined) emit(window.webContents, notifyOpen, {})
}

/** Electron's notifications and windows. */
export const electronNotifyDeps: NotifyDeps = {
  focused: () => BrowserWindow.getFocusedWindow() !== null,
  show: (note, onClick) => {
    if (!Notification.isSupported()) return
    const notification = new Notification({ title: note.title, body: note.body })
    shown.add(notification)
    notification.on('click', () => {
      shown.delete(notification)
      onClick()
    })
    notification.on('close', () => shown.delete(notification))
    notification.show()
  },
  open: (note) => openNote(note),
  now: () => Date.now(),
}

/**
 * Starts notifications for the app: every Session of `registry`, and the registry watchers the
 * windows run; with `link`, the notes go to the Linked machines too and theirs are shown here.
 * Answers the function that stops them.
 */
export function installNotifications(
  registry: Pick<SessionRegistry, 'observe'>,
  liveSessions: Set<(projectRoot: string, live: readonly LiveSession[]) => void>,
  deps: NotifyDeps = electronNotifyDeps,
  link?: NoteLink,
): () => void {
  const notifier = new Notifier(deps, link)
  const stop = registry.observe((sessionId, event) => notifier.sessionEvent(sessionId, event))
  const onLive = (projectRoot: string, live: readonly LiveSession[]) => notifier.externalSessions(projectRoot, live)
  liveSessions.add(onLive)
  const stopReceiving = link?.receive((machineId, note) => notifier.received(machineId, note))
  return () => {
    stop()
    liveSessions.delete(onLive)
    stopReceiving?.()
  }
}

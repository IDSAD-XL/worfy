// macOS notifications (ticket 21). A notification goes out when a Session finished its turn or
// waits for a permission answer, and no worfy window has focus:
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
// Notifier holds the rules and takes its Electron parts as NotifyDeps, so tests pass their own
// (test/unit/notify.test.ts). An unsigned build from `pnpm dev` may show "Electron" or nothing
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

/** One notification: what it says and which Session a click opens. */
export interface Note {
  title: string
  body: string
  sessionId: string
  /** The Project root of a Session from the registry; null for a Session worfy runs. */
  projectRoot: string | null
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

export class Notifier {
  /** When each Session last notified, by its current id. */
  private readonly last = new Map<string, number>()
  /** The cwd of each Session worfy runs, from its system/init: the notification's title. */
  private readonly cwds = new Map<string, string>()
  /** The last status of each Session from the registry, by `<projectRoot>\0<sessionId>`. */
  private readonly external = new Map<string, LiveSession['status']>()

  constructor(private readonly deps: NotifyDeps) {}

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
          this.last.delete(sessionId)
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
    const last = this.last.get(from)
    if (last !== undefined) this.last.set(to, last)
    this.last.delete(from)
    const cwd = this.cwds.get(from)
    if (cwd !== undefined && !this.cwds.has(to)) this.cwds.set(to, cwd)
    this.cwds.delete(from)
  }

  private notify(note: Note): void {
    if (this.deps.focused()) return
    const now = this.deps.now()
    const last = this.last.get(note.sessionId)
    if (last !== undefined && now - last < NOTIFY_INTERVAL_MS) return
    this.last.set(note.sessionId, now)
    this.deps.show(note, () => this.deps.open(note))
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
  pending.hold(id, { sessionId: note.sessionId, projectRoot: note.projectRoot })
  if (watched.has(id)) return
  watched.add(id)
  contents.once('destroyed', () => {
    watched.delete(id)
    pending.drop(id)
  })
}

/**
 * Raises worfy and opens the Session of a clicked notification: in the open window, or in a new
 * one when none is open (macOS keeps the app running without windows).
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
 * windows run. Answers the function that stops them.
 */
export function installNotifications(
  registry: Pick<SessionRegistry, 'observe'>,
  liveSessions: Set<(projectRoot: string, live: readonly LiveSession[]) => void>,
  deps: NotifyDeps = electronNotifyDeps,
): () => void {
  const notifier = new Notifier(deps)
  const stop = registry.observe((sessionId, event) => notifier.sessionEvent(sessionId, event))
  const onLive = (projectRoot: string, live: readonly LiveSession[]) => notifier.externalSessions(projectRoot, live)
  liveSessions.add(onLive)
  return () => {
    stop()
    liveSessions.delete(onLive)
  }
}

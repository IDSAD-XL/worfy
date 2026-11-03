// Every live Session of the app (session.ts): starts them, finds them by id, and passes their
// events and a person's actions on to observers.
import { isMainOnlyEvent } from '../../../shared/agent/events'
import type { SessionSettings } from '../../../shared/agent/settings'
import type { VendorId } from '../../../shared/vendors/vendor'
import type { UserEffortReader, UserModelReader } from '../../claude-home/user-model'
import { claudeSessions, type UserDefaults } from '../../vendors/claude/session'
import type { SessionPart } from '../../vendors/session'
import { Session } from '../session'
import type { SessionLaunch } from '../session-settings'
import type { EventSink, InputListener, QueryFactory, SessionInfo } from './types'

/**
 * The session part of each Vendor's driver, asked for when a Session of that Vendor starts: the app's
 * is vendorDriver(id).session (app-registry.ts). Throws for a Vendor the registry runs no Sessions of.
 */
export interface VendorSessions {
  sessionsOf(vendor: VendorId): SessionPart
}

/** Every live Session of the app, by id; a Session is also found by its temporary id. */
export class SessionRegistry {
  private readonly sessions = new Map<string, Session>()
  private readonly observers = new Set<EventSink>()
  private readonly inputObservers = new Set<InputListener>()
  /** What starts the agent of each Session, by its Vendor. */
  private readonly starters: VendorSessions

  /**
   * `sessions` starts the agent of each Session: the app's gives each Vendor its driver's session
   * part (VendorSessions, app-registry.ts). A single SessionPart or QueryFactory starts Claude Code
   * only, and a Session of another Vendor is refused: a QueryFactory is Claude Code's, started
   * through the Claude driver, as the tests of the Session start the fake agent; `userModel` and
   * `userEffort` then read the user's own model and effort (user-model.ts), and tests give them
   * fixed answers.
   */
  constructor(sessions: VendorSessions | SessionPart | QueryFactory, userModel?: UserModelReader, userEffort?: UserEffortReader) {
    if (typeof sessions !== 'function' && 'sessionsOf' in sessions) {
      this.starters = sessions
      return
    }
    const user: Partial<UserDefaults> = { ...(userModel === undefined ? {} : { model: userModel }), ...(userEffort === undefined ? {} : { effort: userEffort }) }
    const claude = typeof sessions === 'function' ? claudeSessions(sessions, user) : sessions
    this.starters = {
      sessionsOf: (vendor) => {
        if (vendor !== 'claude') throw new Error(`This registry runs no Sessions of ${vendor}`)
        return claude
      },
    }
  }

  /**
   * Gets every action a person takes on a live Session through the UI (src/main/ipc/agent.ts):
   * Autopilot (worfy-daily ticket 04) journals those on the Session of its run. Answers the
   * unsubscribe.
   */
  observeInput(listener: InputListener): () => void {
    this.inputObservers.add(listener)
    return () => this.inputObservers.delete(listener)
  }

  /**
   * A person acts on the Session `sessionId` through the UI; told before the action runs, whether
   * the Session then takes it or refuses it. An id that is not live is ignored.
   */
  noteInput(sessionId: string, what: string): void {
    const session = this.sessions.get(sessionId)
    if (session === undefined) return
    for (const listener of this.inputObservers) {
      try {
        listener(session, what)
      } catch (error) {
        console.warn('[agent] an input observer failed', error)
      }
    }
  }

  /** Gets every event of every Session, besides the Session's own sink (notifications, src/main/notify.ts); answers the unsubscribe. */
  observe(listener: EventSink): () => void {
    this.observers.add(listener)
    return () => this.observers.delete(listener)
  }

  /**
   * Starts a Session whose events go to `sink` (the window that asked for it), main-only ones
   * (isMainOnlyEvent) left out: those go to the observers alone. Resuming a Vendor
   * session that a live Session already runs is refused: two processes of the agent would write
   * one transcript, and both Sessions would send events under one id. `launch` is attended unless
   * Autopilot starts the Session unattended (session-settings.ts). With `after`, the Session is live
   * at once but starts its agent's process only once `after` settles (Session.start). `vendor` names
   * whose agent runs the Session: Claude Code unless said (the Orchestrator's, in the first release);
   * a Vendor the registry runs no Sessions of throws, and nothing starts.
   */
  start(cwd: string, resume: string | undefined, sink: EventSink, settings?: SessionSettings, launch?: SessionLaunch, after?: Promise<void>, vendor: VendorId = 'claude'): Session {
    if (resume !== undefined && this.live().some((live) => live.id === resume || live.sdkId === resume)) {
      throw new Error(`Session ${resume} is already live`)
    }
    const starter = this.starters.sessionsOf(vendor)
    const session = new Session(
      cwd,
      starter,
      (sessionId, event) => {
        for (const observer of this.observers) {
          try {
            observer(sessionId, event)
          } catch (error) {
            console.warn('[agent] an event observer failed', error)
          }
        }
        try {
          // Events for the main process only (task_activity) reach the observers, not the windows.
          if (!isMainOnlyEvent(event)) sink(sessionId, event)
        } finally {
          // A sink that throws (a window already gone) must not keep a closed Session listed.
          if (event.type === 'state' && event.state === 'closed') this.forget(session)
        }
      },
      (_from, to) => this.sessions.set(to, session),
      resume,
      settings,
      launch,
    )
    this.sessions.set(session.id, session)
    session.start(after)
    return session
  }

  get(sessionId: string): Session {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`No live Session ${sessionId}`)
    return session
  }

  list(): SessionInfo[] {
    return this.live().map((session) => session.info())
  }

  closeAll(): void {
    for (const session of this.live()) session.close()
  }

  private live(): Session[] {
    return [...new Set(this.sessions.values())]
  }

  private forget(session: Session): void {
    for (const [id, value] of this.sessions) if (value === session) this.sessions.delete(id)
  }
}

// Every live Session of the app (session.ts): starts them, finds them by id, and passes their
// events and a person's actions on to observers.
import { isMainOnlyEvent } from '../../../shared/agent/events'
import type { SessionSettings } from '../../../shared/agent/settings'
import { readUserEffort, readUserModel, type UserEffortReader, type UserModelReader } from '../../claude-home/user-model'
import { Session } from '../session'
import type { SessionLaunch } from '../session-settings'
import type { EventSink, InputListener, QueryFactory, SessionInfo } from './types'

/** Every live Session of the app, by id; a Session is also found by its temporary id. */
export class SessionRegistry {
  private readonly sessions = new Map<string, Session>()
  private readonly observers = new Set<EventSink>()
  private readonly inputObservers = new Set<InputListener>()

  /** `userModel` and `userEffort` read the user's own model and effort (user-model.ts); tests give them fixed answers. */
  constructor(
    private readonly factory: QueryFactory,
    private readonly userModel: UserModelReader = () => readUserModel(),
    private readonly userEffort: UserEffortReader = () => readUserEffort(),
  ) {}

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
   * (isMainOnlyEvent) left out: those go to the observers alone. Resuming an SDK
   * session that a live Session already runs is refused: two Claude Code processes would write
   * one transcript, and both Sessions would send events under one id. `launch` is attended unless
   * Autopilot starts the Session unattended (session-settings.ts). With `after`, the Session is live
   * at once but starts its Claude Code process only once `after` settles (Session.start).
   */
  start(cwd: string, resume: string | undefined, sink: EventSink, settings?: SessionSettings, launch?: SessionLaunch, after?: Promise<void>): Session {
    if (resume !== undefined && this.live().some((live) => live.id === resume || live.sdkId === resume)) {
      throw new Error(`Session ${resume} is already live`)
    }
    const session = new Session(
      cwd,
      this.factory,
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
      this.userModel,
      this.userEffort,
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

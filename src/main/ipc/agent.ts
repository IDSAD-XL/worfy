// Handlers of the `agent` domain (src/shared/ipc/agent.ts). Events of a Session go to the window
// that started it, and the Session closes when that window is destroyed: on macOS the app outlives
// its windows, and a Session nobody can see would keep Claude Code running. The app's registry and
// how it starts Claude Code (or the fake agent) live in src/main/agent/app-registry.ts.
import { stat } from 'node:fs/promises'
import type { WebContents } from 'electron'
import { sharedRegistry } from '../agent/app-registry'
import type { EventSink, Session, SessionRegistry } from '../agent/session'
import { agentClose, agentEvent, agentInterrupt, agentList, agentSend, agentStart } from '../../shared/ipc/agent'
import { defineHandler, emit, type EventTarget, type HandlerModule } from './index'

/** Sends a Session's events to a window, as long as the window is alive. */
export function windowSink(target: EventTarget & Partial<Pick<WebContents, 'isDestroyed'>>): EventSink {
  return (sessionId, event) => {
    if (target.isDestroyed?.() === true) return
    emit(target, agentEvent, { sessionId, event })
  }
}

/** A window's webContents as far as Session ownership needs it. */
export interface SessionOwner {
  once(event: 'destroyed', listener: () => void): unknown
}

/** Closes each window's Sessions when the window is destroyed; one listener per window. */
function ownership(): (owner: SessionOwner, session: Session) => void {
  const owned = new WeakMap<SessionOwner, Set<Session>>()
  return (owner, session) => {
    let sessions = owned.get(owner)
    if (sessions === undefined) {
      const forOwner = new Set<Session>()
      owned.set(owner, forOwner)
      owner.once('destroyed', () => {
        owned.delete(owner)
        for (const each of forOwner) {
          try {
            each.close()
          } catch (error) {
            // One Session failing to report its close must not keep the others running.
            console.warn(`[agent] closing ${each.id} with its window failed`, error)
          }
        }
      })
      sessions = forOwner
    }
    // Sessions closed by agent.close are dropped here rather than kept until the window goes.
    for (const each of sessions) if (each.state === 'closed') sessions.delete(each)
    sessions.add(session)
  }
}

async function assertDirectory(path: string): Promise<void> {
  const info = await stat(path).catch(() => null)
  if (!info?.isDirectory()) throw new Error(`${path} is not a directory`)
}

/** The handlers over a registry; tests pass their own registry with the fake agent. */
export function agentHandlers(registry: () => SessionRegistry): HandlerModule {
  const own = ownership()
  return [
    defineHandler(agentStart, async ({ cwd, resume }, { event }) => {
      await assertDirectory(cwd)
      const session = registry().start(cwd, resume, windowSink(event.sender))
      own(event.sender, session)
      return { sessionId: session.id }
    }),
    defineHandler(agentSend, ({ sessionId, text }) => {
      registry().get(sessionId).send(text)
    }),
    defineHandler(agentInterrupt, async ({ sessionId }) => ({ interrupted: await registry().get(sessionId).interrupt() })),
    defineHandler(agentClose, ({ sessionId }) => {
      registry().get(sessionId).close()
    }),
    defineHandler(agentList, () => registry().list()),
  ]
}

export default agentHandlers(sharedRegistry) satisfies HandlerModule

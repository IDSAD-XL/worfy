// Handlers of the `agent` domain (src/shared/ipc/agent.ts). Events of a Session go to the window
// that started it, and the Session closes when that window is destroyed: on macOS the app outlives
// its windows, and a Session nobody can see would keep Claude Code running. The app's registry and
// how it starts Claude Code (or the fake agent) live in src/main/agent/app-registry.ts.
//
// Attachments (ticket 20) are checked here, before the message is sent: copies of files from
// outside the Project go into the Project's data folder (attachments.ts, ADR-0005).
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { sharedRegistry } from '../agent/app-registry'
import { attach, type AttachTarget } from '../agent/attachments'
import { closeRefusal } from '../agent/resume'
import type { EventSink, Session, SessionRegistry } from '../agent/session'
import { projectForCwd } from '../mcp/canvas-server'
import { projectStore } from '../projects/store'
import { dataRoot } from '../storage/paths'
import {
  agentAttach,
  agentAttachPick,
  agentClose,
  agentCommands,
  agentConfigure,
  agentControls,
  agentEvent,
  agentInterrupt,
  agentList,
  agentModels,
  agentQueueRemove,
  agentQueueSend,
  agentSend,
  agentStart,
} from '../../shared/ipc/agent'
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

/** What the attachment handlers need besides the registry; tests pass their own. */
export interface AttachDeps {
  /** Where the attachments of a Session in `cwd` come from and go to. */
  target(cwd: string): AttachTarget
  /** Asks the user for files to attach; the absolute paths picked, none when cancelled. */
  pickFiles(owner: WebContents): Promise<string[]>
}

/** The app's attachments: copies go to `<Project data folder>/attachments`, or `<data root>/attachments` outside every Project. */
export const appAttachDeps: AttachDeps = {
  target: (cwd) => {
    const project = projectForCwd(projectStore().list(), cwd)
    const dataDir = project ? projectStore().dataDir(project.id) : dataRoot()
    return { projectRoot: project?.path ?? null, cwd, attachmentsDir: join(dataDir, 'attachments') }
  },
  pickFiles: async (owner) => {
    // Read at call time: e2e runs replace dialog.showOpenDialog to answer without a real dialog.
    const { BrowserWindow, dialog } = await import('electron')
    const options: Electron.OpenDialogOptions = { title: 'Attach files', properties: ['openFile', 'multiSelections'] }
    const window = BrowserWindow.fromWebContents(owner)
    const result = await (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options))
    return result.canceled ? [] : result.filePaths
  },
}

/** The handlers over a registry; tests pass their own registry with the fake agent. */
export function agentHandlers(registry: () => SessionRegistry, attachments: AttachDeps = appAttachDeps): HandlerModule {
  const own = ownership()
  const attachAll = async (sessionId: string, sources: Parameters<typeof attach>[0][]) => {
    const target = attachments.target(registry().get(sessionId).cwd)
    // One at a time: a refused file must not hide what the others became.
    const results = []
    for (const source of sources) results.push(await attach(source, target))
    return { results }
  }
  return [
    defineHandler(agentStart, async ({ cwd, resume }, { event }) => {
      await assertDirectory(cwd)
      const session = registry().start(cwd, resume, windowSink(event.sender))
      own(event.sender, session)
      return { sessionId: session.id }
    }),
    defineHandler(agentSend, ({ sessionId, text, attachments: attached }) => {
      registry().get(sessionId).send(text, attached)
    }),
    defineHandler(agentAttach, ({ sessionId, sources }) => attachAll(sessionId, sources)),
    defineHandler(agentAttachPick, async ({ sessionId }, { event }) => {
      registry().get(sessionId)
      const paths = await attachments.pickFiles(event.sender)
      return attachAll(
        sessionId,
        paths.map((path) => ({ kind: 'path', path })),
      )
    }),
    defineHandler(agentCommands, async ({ sessionId }) => ({ commands: await registry().get(sessionId).commands() })),
    defineHandler(agentInterrupt, async ({ sessionId }) => ({ interrupted: await registry().get(sessionId).interrupt() })),
    defineHandler(agentClose, ({ sessionId }) => {
      const session = registry().get(sessionId)
      // A turn is interrupted first (ticket 18); closing with the window or the app is not refused.
      const refusal = closeRefusal(session.state)
      if (refusal !== null) throw new Error(refusal)
      session.close()
    }),
    defineHandler(agentList, () => registry().list()),
    defineHandler(agentControls, ({ sessionId }) => registry().get(sessionId).controls()),
    defineHandler(agentConfigure, ({ sessionId, change }) => registry().get(sessionId).configure(change)),
    defineHandler(agentModels, async ({ sessionId }) => ({ models: await registry().get(sessionId).models() })),
    defineHandler(agentQueueRemove, ({ sessionId, id }) => ({ removed: registry().get(sessionId).removeQueued(id) })),
    defineHandler(agentQueueSend, ({ sessionId }) => {
      registry().get(sessionId).sendQueued()
    }),
  ]
}

export default agentHandlers(sharedRegistry) satisfies HandlerModule

// Handlers of the `agent` domain (src/shared/ipc/agent.ts). A Session started by `agent.start`
// belongs to the app, not to the window that asked for it (ADR-0053, point 4), like the Sessions of
// Session Nodes and the Orchestrator: its events go to every client of the app (src/main/broadcast.ts),
// and closing a window or dropping a connection does not close it. It closes on `agent.close` or
// when worfy quits (closeAll on will-quit, src/main/agent/app-registry.ts). The app's registry and
// how it starts Claude Code (or the fake agent) live in src/main/agent/app-registry.ts.
//
// Attachments (ticket 20) are checked here: agent.attach and agent.attachPick make them (copies of
// files from outside the Project go into the Project's data folder, attachments.ts, ADR-0005), and
// agent.send checks again what the renderer hands back before the Session gets it (recheck), and
// keeps a copy of each image it sends (storeImages, worfy-ui ticket 28).
import { stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { WebContents } from 'electron'
import { sharedRegistry } from '../agent/app-registry'
import { attach, attachmentImagesDir, recheck, storeImages, type AttachTarget } from '../agent/attachments'
import { closeRefusal } from '../agent/resume'
import type { EventSink, Session, SessionRegistry } from '../agent/session'
import { toEveryWindow } from '../broadcast'
import { insideProjects } from '../link/caller'
import { projectForCwd } from '../mcp/canvas-server'
import { projectStore } from '../projects/store'
import { dataRoot } from '../storage/paths'
import {
  agentAnswerQuestion,
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
  agentPermission,
  agentQueueRemove,
  agentQueueSend,
  agentSend,
  agentStart,
} from '../../shared/ipc/agent'
import { MAX_ATTACHMENTS, tooManyAttachments, type Attachment } from '../../shared/agent/attachments'
import type { SettingsChange } from '../../shared/agent/settings'
import { defineHandler, emit, type EventTarget, type HandlerModule } from './index'

/** Sends one event to every client of the app; tests pass their own clients. */
export type Broadcast = (send: (target: EventTarget) => void) => void

/** A Session's events, each sent to every client `clients` reaches. */
export function everyClientSink(clients: Broadcast): EventSink {
  return (sessionId, event) => clients((target) => emit(target, agentEvent, { sessionId, event }))
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
  /** Where the copies of sent images go (attachmentImagesDir); the window shows them from there (worfy-image://). */
  imagesDir(): string
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
  imagesDir: () => attachmentImagesDir(dataRoot()),
}

/** What a settings change touches, for the journal: `model`, `effort and permission mode`, … */
function configured(change: SettingsChange): string {
  const names = [change.model !== undefined && 'model', change.effort !== undefined && 'effort', change.permissionMode !== undefined && 'permission mode'].filter(
    (name): name is string => typeof name === 'string',
  )
  if (names.length === 0) return 'settings'
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`
}

/**
 * The handlers over a registry; tests pass their own registry with the fake agent. Every action a
 * person takes on a live Session is told to the registry's input observers first (noteInput).
 */
export function agentHandlers(
  registry: () => SessionRegistry,
  attachments: AttachDeps = appAttachDeps,
  clients: Broadcast = toEveryWindow,
  projects: () => readonly { readonly path: string }[] = () => projectStore().list(),
): HandlerModule {
  const sink = everyClientSink(clients)
  // The messages of one Session reach it in the order they were sent, though checking the
  // attachments of one takes longer than checking another's.
  const lastSend = new WeakMap<Session, Promise<unknown>>()
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
      // A Linked machine starts Claude Code inside the Projects of this Machine only (src/main/link/caller.ts).
      const folder = insideProjects(event, cwd, projects, 'the folder')
      return { sessionId: registry().start(folder, resume, sink).id }
    }),
    defineHandler(agentSend, ({ sessionId, text, attachments: attached }) => {
      const session = registry().get(sessionId)
      registry().noteInput(sessionId, 'sent a message')
      const target = attachments.target(session.cwd)
      const checked = Promise.all(attached.map((each: Attachment) => recheck(each, target)))
      // Its refusal is answered below, once the messages before it are sent; not an unhandled rejection meanwhile.
      void checked.catch(() => undefined)
      const sent = (lastSend.get(session) ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => checked)
        .then(async (list) => {
          await storeImages(list, attachments.imagesDir())
          session.send(text, list)
        })
      lastSend.set(session, sent)
      return sent
    }),
    defineHandler(agentAttach, ({ sessionId, sources }, { event }) => {
      // A file named by its path is read on this Machine: from a Linked machine, only inside its Projects.
      const checked = sources.map((source) => (source.kind === 'path' ? { ...source, path: insideProjects(event, source.path, projects, 'the file') } : source))
      return attachAll(sessionId, checked)
    }),
    defineHandler(agentAttachPick, async ({ sessionId }, { event }) => {
      registry().get(sessionId)
      const paths = await attachments.pickFiles(event.sender)
      // One message takes MAX_ATTACHMENTS at most: the files past that are neither read nor copied.
      const { results } = await attachAll(
        sessionId,
        paths.slice(0, MAX_ATTACHMENTS).map((path) => ({ kind: 'path', path })),
      )
      const left = paths.slice(MAX_ATTACHMENTS).map((path) => basename(path))
      return { results: left.length === 0 ? results : [...results, { ok: false as const, name: left.join(', '), error: tooManyAttachments(left) }] }
    }),
    defineHandler(agentCommands, async ({ sessionId }) => ({ commands: await registry().get(sessionId).commands() })),
    defineHandler(agentInterrupt, async ({ sessionId }) => {
      const session = registry().get(sessionId)
      registry().noteInput(sessionId, 'interrupted the turn')
      return { interrupted: await session.interrupt() }
    }),
    defineHandler(agentClose, ({ sessionId }) => {
      const session = registry().get(sessionId)
      registry().noteInput(sessionId, 'closed the Session')
      // A turn is interrupted first (ticket 18); closing with the app is not refused.
      const refusal = closeRefusal(session.state)
      if (refusal !== null) throw new Error(refusal)
      session.close()
    }),
    defineHandler(agentList, () => registry().list()),
    defineHandler(agentControls, ({ sessionId }) => registry().get(sessionId).controls()),
    defineHandler(agentConfigure, ({ sessionId, change }) => {
      const session = registry().get(sessionId)
      // A refused change of mode is a person stepping in all the same (ADR-0022).
      registry().noteInput(sessionId, `changed the ${configured(change)}`)
      return session.configure(change)
    }),
    defineHandler(agentModels, async ({ sessionId }) => ({ models: await registry().get(sessionId).models() })),
    defineHandler(agentQueueRemove, ({ sessionId, id }) => {
      const session = registry().get(sessionId)
      registry().noteInput(sessionId, 'removed a queued message')
      return { removed: session.removeQueued(id) }
    }),
    defineHandler(agentQueueSend, ({ sessionId }) => {
      const session = registry().get(sessionId)
      registry().noteInput(sessionId, 'pressed Send queued')
      session.sendQueued()
    }),
    defineHandler(agentPermission, ({ sessionId, requestId, decision }) => {
      const session = registry().get(sessionId)
      registry().noteInput(sessionId, 'answered a permission request')
      return { answered: session.answerPermission(requestId, decision) }
    }),
    defineHandler(agentAnswerQuestion, ({ sessionId, requestId, answers }) => {
      const session = registry().get(sessionId)
      registry().noteInput(sessionId, answers === null ? 'declined a question' : 'answered a question')
      return { answered: session.answerQuestion(requestId, answers) }
    }),
  ]
}

export default agentHandlers(sharedRegistry) satisfies HandlerModule

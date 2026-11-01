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
//
// An Autopilot command typed in a chat (`/worfy:epic-wave …`, worfy-flight-recorder ticket 22,
// src/shared/autopilot/chat-command.ts) does not reach the agent: agent.send starts Autopilot through
// the app's one start from a chat (startFromChat, src/main/autopilot/chat-start.ts) and answers what
// became of it. No confirmation: the person typed it. It is not told to the input observers either,
// since nothing reached the Session (a running run would journal it as a person stepping in). Only
// agent.send is read so: the Waves Autopilot sends go to the Session directly (session.send).
import { readFile, stat } from 'node:fs/promises'
import * as nativePath from 'node:path'
import { basename, join } from 'node:path'
import type { WebContents } from 'electron'
import { sharedRegistry } from '../agent/app-registry'
import { attach, attachmentImagesDir, recheck, storeImages, type AttachTarget } from '../agent/attachments'
import { closeRefusal } from '../agent/resume'
import type { EventSink, Session, SessionRegistry } from '../agent/session'
import type { ChatStartAnswer, ChatStartRequest } from '../autopilot/chat-start'
import { toEveryWindow } from '../broadcast'
import { harnessScriptEnv } from '../harness/script-env'
import { insideProjects, isRemoteCall, localProjectOf, setSessionFolders } from '../link/caller'
import { projectForCwd } from '../mcp/canvas-server'
import { projectStore } from '../projects/store'
import { leadsToRemote } from '../remote-links'
import { claudeHome, dataRoot } from '../storage/paths'
import { projectLayouts } from '../workflow/folder'
import { readWorkflow } from '../workflow/reader'
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
  type ChatCommandAnswer,
} from '../../shared/ipc/agent'
import { MAX_ATTACHMENTS, tooManyAttachments, type Attachment } from '../../shared/agent/attachments'
import type { SettingsChange } from '../../shared/agent/settings'
import { chatStartedText, parseChatCommand, type ChatCommand } from '../../shared/autopilot/chat-command'
import type { WorkflowModel } from '../../shared/workflow/types'
import { waveTickets } from '../../shared/workflow/wave-plan'
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

/** What an Autopilot command typed in a chat needs besides the registry; tests pass their own. */
export interface ChatCommandDeps {
  /** The Project of a Session's folder; null outside every Project. */
  projectOf(cwd: string): string | null
  /** The app's one start from a chat (sharedChatStarts().startFromChat, src/main/ipc/autopilot.ts). */
  start(request: ChatStartRequest): Promise<ChatStartAnswer>
  /** A fresh read of the Project's workflow model. */
  workflow(projectId: string): Promise<WorkflowModel>
  /** The text of the Epic's spec.md; null when there is none or it cannot be read. */
  spec(projectId: string, epic: string): Promise<string | null>
}

/** The refusal of a command typed in a Session that is in no Project: Autopilot runs over a Project's Epic. */
export const OUTSIDE_PROJECTS = 'Autopilot starts only in a Session of a Project'

/**
 * The text of the Epic's spec.md, from the Tickets root of the Project's layout (src/main/workflow/folder.ts);
 * null when the layout is unknown, the file is missing, or a link on its way leads off this machine
 * (a link to a share in a checked-out repository; src/main/remote-links.ts).
 */
export async function readEpicSpec(root: string, epic: string): Promise<string | null> {
  const layout = await projectLayouts().get(root)
  if (layout.failed) return null
  const path = join(layout.ticketsRoot, epic, 'spec.md')
  if (await leadsToRemote(path, [root, layout.ticketsRoot], { paths: nativePath })) return null
  return readFile(path, 'utf8').catch(() => null)
}

/** The app's: its Projects, its one start from a chat, and the workflow as the Autopilot reads it. */
export const appChatCommands: ChatCommandDeps = {
  projectOf: (cwd) => projectForCwd(projectStore().list(), cwd)?.id ?? null,
  // Read at call time: src/main/ipc/autopilot.ts brings the whole Autopilot with it.
  start: async (request) => (await import('./autopilot')).sharedChatStarts().startFromChat(request),
  workflow: async (projectId) => (await readWorkflow({ root: projectStore().get(projectId).path, claudeHome: claudeHome(), env: harnessScriptEnv })).model,
  spec: (projectId, epic) => readEpicSpec(projectStore().get(projectId).path, epic),
}

const hasEpic = (model: WorkflowModel, epic: string): boolean => model.epics.some((each) => each.epic === epic) || model.tickets.some((each) => each.epic === epic)

/**
 * Starts Autopilot for a command typed in `session`, and says what became of it; null when the
 * command is an Epic named alone that the Project does not have (or whose workflow cannot be read):
 * that word was meant for the agent.
 */
async function startCommand(chat: ChatCommandDeps, command: ChatCommand, session: Session): Promise<ChatCommandAnswer | null> {
  const { epic } = command
  const bare = command.kind === 'epic' && command.bare
  const refused = (message: string): ChatCommandAnswer => ({ kind: 'refused', epic, message })
  const projectId = chat.projectOf(session.cwd)
  if (projectId === null) return bare ? null : refused(OUTSIDE_PROJECTS)
  let tickets: number[] | undefined
  if (bare) {
    const model = await chat.workflow(projectId).catch(() => null)
    if (model === null || model.error !== null || !hasEpic(model, epic)) return null
  } else if (command.kind === 'tickets') {
    tickets = command.tickets
  } else if (command.kind === 'wave') {
    const [spec, model] = await Promise.all([chat.spec(projectId, epic), chat.workflow(projectId)])
    if (model.error !== null) return refused(`Cannot read the workflow: ${model.error.message}`)
    const wave = waveTickets(spec, epic, command.wave, model.tickets)
    if (!wave.ok) return refused(wave.message)
    tickets = wave.tickets
  }
  const answer = await chat.start({ projectId, epic, ...(tickets === undefined ? {} : { tickets }), by: 'command', session: session.id })
  if (answer.kind === 'started') return { kind: 'started', epic, message: chatStartedText(epic) }
  return { kind: answer.kind, epic, message: answer.message }
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
 * person takes on a live Session is told to the registry's input observers first (noteInput); a
 * message, when its turn among the Session's messages comes, right before the Session gets it.
 */
export function agentHandlers(
  registry: () => SessionRegistry,
  attachments: AttachDeps = appAttachDeps,
  clients: Broadcast = toEveryWindow,
  projects: () => readonly { readonly path: string }[] = () => projectStore().list(),
  chat: ChatCommandDeps = appChatCommands,
): HandlerModule {
  const sink = everyClientSink(clients)
  // The link adapter refuses a call, and a link client an event, of a Session in a Project local to
  // this Machine (src/main/link/caller.ts): it learns the Session's folder here.
  setSessionFolders((sessionId) => {
    try {
      return registry().get(sessionId).cwd
    } catch {
      return null
    }
  })
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
      // A message with attachments is no command: the files would have nowhere to go.
      const command = attached.length === 0 ? parseChatCommand(text) : null
      if (command !== null) {
        // In turn with the messages around it: the ones before are sent first, the ones after wait for the answer.
        const answered = (lastSend.get(session) ?? Promise.resolve())
          .catch(() => undefined)
          .then(async () => {
            const answer = await startCommand(chat, command, session).catch((error: unknown): ChatCommandAnswer => ({
              kind: 'refused',
              epic: command.epic,
              message: error instanceof Error ? error.message : String(error),
            }))
            if (answer !== null) return { autopilot: answer }
            registry().noteInput(sessionId, 'sent a message')
            session.send(text, [])
            return undefined
          })
        lastSend.set(session, answered)
        return answered
      }
      const target = attachments.target(session.cwd)
      const checked = Promise.all(attached.map((each: Attachment) => recheck(each, target)))
      // Its refusal is answered below, once the messages before it are sent; not an unhandled rejection meanwhile.
      void checked.catch(() => undefined)
      const sent = (lastSend.get(session) ?? Promise.resolve())
        .catch(() => undefined)
        .then(async () => {
          let list: Attachment[]
          try {
            list = await checked
            await storeImages(list, attachments.imagesDir())
          } finally {
            // Told when the message reaches the Session, refused or not, not when it is typed: behind a
            // command the message reaches the run that command starts, and that run journals it.
            registry().noteInput(sessionId, 'sent a message')
          }
          session.send(text, list)
        })
      lastSend.set(session, sent)
      return sent.then(() => undefined)
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
    // A Linked machine does not see the Sessions of a Project local to this Machine.
    defineHandler(agentList, (_input, { event }) => registry().list().filter((session) => !isRemoteCall(event) || localProjectOf(session.cwd) === null)),
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
